// Runs the ATOM runtime as a child process and carries its JSON-line protocol (docs/island-protocol.md): starts it, forwards its events,
// writes commands to its stdin, restarts it when it fails and stops it cleanly. A port of RuntimeSupervisor.swift (ADR-201).
// Events are opaque here: this is a transport. The runtime validates every command; this code only frames lines.

import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";
import { RestartPolicy } from "./restart-policy.ts";

export interface RuntimeLaunch {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export type SupervisorStatus =
  | { state: "stopped" }
  | { state: "running"; pid: number }
  | { state: "restarting"; afterSeconds: number }
  /** Configuration is invalid: not restarted until the user fixes it and starts again. */
  | { state: "configError"; message: string }
  /** It failed repeatedly: not restarted until the user starts it again. */
  | { state: "failed"; message: string };

export type RuntimeEvent = { type: string } & Record<string, unknown>;

export interface SupervisorOptions {
  launch: RuntimeLaunch;
  onEvent: (event: RuntimeEvent) => void;
  onStatus: (status: SupervisorStatus) => void;
  /** Human-readable diagnostics from the runtime's stderr, one line each. Never forwarded to the page. */
  onDiagnostic?: (line: string) => void;
  policy?: RestartPolicy;
  /** How long a stop waits for a clean exit before SIGTERM, and again before SIGKILL. */
  stopTimeoutMs?: number;
  /** For tests. */
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { cancel(): void };
}

export interface Supervisor {
  start(): void;
  /** Writes one command line. False when no runtime is running: the command is dropped, never queued for a later runtime. */
  send(command: object): boolean;
  /** Asks for a clean quit and resolves once the runtime has exited. */
  stop(): Promise<void>;
  status(): SupervisorStatus;
}

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const spawn = options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, { ...spawnOptions, stdio: "pipe" }) as ChildProcessWithoutNullStreams);
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ??
    ((fn, ms) => {
      const handle = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(handle) };
    });
  const policy = options.policy ?? new RestartPolicy();
  const stopTimeoutMs = options.stopTimeoutMs ?? 3000;

  let child: ChildProcessWithoutNullStreams | undefined;
  let startedAt = 0;
  let stopRequested = false;
  let restartTimer: { cancel(): void } | undefined;
  let current: SupervisorStatus = { state: "stopped" };
  let lastError = "";
  let exited: Promise<void> = Promise.resolve();

  function setStatus(status: SupervisorStatus) {
    current = status;
    options.onStatus(status);
  }

  function launch() {
    restartTimer = undefined;
    stopRequested = false;
    lastError = "";
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(options.launch.command, options.launch.args, { cwd: options.launch.cwd, env: options.launch.env ?? process.env });
    } catch (error) {
      setStatus({ state: "failed", message: `The runtime could not be started: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    child = proc;
    startedAt = now();
    let resolveExit!: () => void;
    exited = new Promise<void>((resolve) => (resolveExit = resolve));

    createInterface({ input: proc.stdout, crlfDelay: Infinity }).on("line", (line) => {
      if (!line.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        options.onDiagnostic?.(`bad event line (not JSON): ${line.slice(0, 120)}`);
        return;
      }
      if (typeof parsed !== "object" || parsed === null || typeof (parsed as { type?: unknown }).type !== "string") {
        options.onDiagnostic?.("bad event line (no type)");
        return;
      }
      const event = parsed as RuntimeEvent;
      if (event.type === "error" && typeof event.message === "string") lastError = event.message;
      options.onEvent(event);
    });
    createInterface({ input: proc.stderr, crlfDelay: Infinity }).on("line", (line) => options.onDiagnostic?.(line));
    // A broken pipe on stdin means the runtime is going away; its exit is handled below.
    proc.stdin.on("error", () => {});

    let handled = false;
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (handled) return;
      handled = true;
      child = undefined;
      const exitCode = code ?? (signal ? 128 + signalNumber(signal) : 1);
      const uptimeSeconds = (now() - startedAt) / 1000;
      const decision = policy.decide(exitCode, uptimeSeconds, stopRequested);
      switch (decision.kind) {
        case "stay":
          setStatus({ state: "stopped" });
          break;
        case "configError":
          setStatus({ state: "configError", message: lastError || "The configuration is invalid. Check .env, then start again." });
          break;
        case "giveUp":
          setStatus({ state: "failed", message: lastError || `The runtime keeps stopping (last exit code ${exitCode}). Fix the cause, then start again.` });
          break;
        case "restart":
          setStatus({ state: "restarting", afterSeconds: decision.afterSeconds });
          restartTimer = setTimer(launch, decision.afterSeconds * 1000);
          break;
      }
      resolveExit();
    };
    proc.once("exit", onExit);
    proc.once("error", (error) => {
      lastError = `The runtime could not be started: ${error.message}`;
      onExit(1, null);
    });
    if (proc.pid !== undefined) setStatus({ state: "running", pid: proc.pid });
  }

  return {
    start() {
      if (child || restartTimer) return;
      policy.reset();
      launch();
    },
    send(command) {
      if (!child || child.stdin.destroyed || !child.stdin.writable) return false;
      // JSON.stringify escapes line breaks inside strings, so a command is always one line.
      child.stdin.write(`${JSON.stringify(command)}\n`);
      return true;
    },
    async stop() {
      stopRequested = true;
      restartTimer?.cancel();
      restartTimer = undefined;
      const proc = child;
      if (!proc) {
        if (current.state !== "stopped") setStatus({ state: "stopped" });
        return;
      }
      try {
        proc.stdin.write(`${JSON.stringify({ type: "quit" })}\n`);
      } catch {
        // already gone
      }
      const wait = (ms: number) =>
        new Promise<boolean>((resolve) => {
          const timer = setTimer(() => resolve(false), ms);
          void exited.then(() => {
            timer.cancel();
            resolve(true);
          });
        });
      if (await wait(stopTimeoutMs)) return;
      proc.kill("SIGTERM");
      if (await wait(stopTimeoutMs)) return;
      proc.kill("SIGKILL");
      await exited;
    },
    status: () => current,
  };
}

const SIGNALS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
function signalNumber(signal: NodeJS.Signals): number {
  return SIGNALS[signal] ?? 0;
}
