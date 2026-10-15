import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";

export interface CuaResult {
  text: string;
  data: Record<string, any>;
  isError: boolean;
  refusal: { code: string; message: string } | undefined;
}

export interface CuaTransport {
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CuaResult>;
  close(): Promise<void>;
}

export interface CuaTransportOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  /** Longest wait for one call. */
  callTimeoutMs?: number;
  /** Stop Cua after this long with no calls (it starts again on the next call). */
  idleMs?: number;
}

/**
 * The environment Cua is started with (ADR-054): standard mode, telemetry off. The caller's own settings for
 * these are overwritten, and the unrestricted-mode and capability-manifest overrides are removed, so nothing
 * that is set around ATOM can widen what Cua may do.
 */
/** The driver reports a refusal in one of two shapes: a `refusal` object, or `code` + `reason` at the top level (what it really sends). */
function refusalOf(data: Record<string, any>): { code: string; message: string } | undefined {
  if (data.refusal && typeof data.refusal.code === "string") return { code: data.refusal.code, message: String(data.refusal.message ?? "") };
  if (typeof data.code === "string" && data.effect === "refused") return { code: data.code, message: String(data.reason ?? data.escalation?.reason ?? "") };
  return undefined;
}

export function cuaEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS;
  delete env.CUA_DRIVER_CAPABILITY_MANIFEST_FILE;
  delete env.CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED;
  env.CUA_DRIVER_PERMISSION_MODE = "standard";
  env.CUA_TELEMETRY_ENABLED = "false";
  env.CUA_DRIVER_RS_TELEMETRY_ENABLED = "0";
  return env;
}

/** Cua's stderr is ignored (it prints update notices), so only stdin and stdout are pipes. */
type Proc = ChildProcessByStdio<Writable, Readable, null>;

interface Pending {
  resolve: (r: any) => void;
  reject: (e: Error) => void;
}

/**
 * Talks to `cua-driver mcp` over stdio, one JSON object per line. Starts it on the first call, restarts it after a
 * crash, and stops it when idle or closed. Calls are serialised: Cua drives one desktop, so two at once would collide.
 */
export function createCuaTransport(options: CuaTransportOptions = {}): CuaTransport {
  const {
    command = `${process.env.HOME}/.local/bin/cua-driver`,
    args = ["mcp"],
    callTimeoutMs = 30_000,
    idleMs = 120_000,
  } = options;
  const env = cuaEnvironment(options.env ?? process.env);

  let child: Proc | undefined;
  /** The newest process started. An older one that exits late must not clear what belongs to this one (code check, 2026-10-16). */
  let newest: Proc | undefined;
  let ready: Promise<Proc> | undefined;
  let nextId = 0;
  const pending = new Map<number, Pending>();
  let idleTimer: NodeJS.Timeout | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  function failAll(message: string) {
    for (const p of pending.values()) p.reject(new Error(message));
    pending.clear();
  }

  function send(proc: Proc, message: object) {
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(proc: Proc, method: string, params: object, timeoutMs: number): Promise<any> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Cua Driver did not answer within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      send(proc, { jsonrpc: "2.0", id, method, params });
    });
  }

  function start(): Promise<Proc> {
    if (ready) return ready;
    ready = new Promise<Proc>((resolve, reject) => {
      const proc = spawn(command, args, { env, stdio: ["pipe", "pipe", "ignore"] });
      newest = proc;
      let started = false;
      proc.on("error", (error) => {
        if (newest !== proc) return; // an older process: its failure is not this one's
        child = undefined;
        ready = undefined;
        const e = new Error(`Could not start Cua Driver (${error.message}). Is it installed?`);
        if (!started) reject(e);
        failAll(e.message); // also clears the pending initialize request's timer, which would otherwise hold the process open
      });
      proc.on("exit", () => {
        // The exit of a process that a newer one has replaced (the idle timer stopped it, a new call started another) changes nothing: it used to
        // clear `ready` and reject the newer process's pending request, and the next call then spawned a third process.
        if (newest !== proc) return;
        if (child === proc) child = undefined;
        ready = undefined;
        failAll("Cua Driver stopped unexpectedly.");
      });
      createInterface({ input: proc.stdout }).on("line", (line) => {
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          return; // not a protocol line
        }
        const p = pending.get(message.id);
        if (!p) return;
        pending.delete(message.id);
        message.error ? p.reject(new Error(String(message.error.message ?? "Cua Driver error"))) : p.resolve(message.result);
      });
      request(proc, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "atom", version: "0" } }, 15_000)
        .then(() => {
          started = true;
          child = proc;
          send(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
          resolve(proc);
        })
        .catch((error) => {
          proc.kill();
          ready = undefined;
          reject(error);
        });
    });
    return ready;
  }

  async function stopNow(): Promise<void> {
    // Cua may still be starting: wait for it, so a process that is about to appear is stopped too.
    if (!child && ready) await ready.catch(() => undefined);
    const proc = child;
    child = undefined;
    ready = undefined;
    if (!proc || proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      proc.stdin.end();
      proc.kill("SIGTERM");
    });
  }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void stopNow(), idleMs);
    idleTimer.unref();
  }

  async function callOnce(name: string, callArgs: Record<string, unknown>, signal?: AbortSignal): Promise<CuaResult> {
    if (signal?.aborted) throw new Error("Cancelled before it ran.");
    // Listen for the cancel from the start, so one that arrives while Cua is still starting is not missed.
    let proc: Proc | undefined;
    let requestId: number | undefined;
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => {
        if (proc && requestId !== undefined) {
          send(proc, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId, reason: "ATOM cancelled" } });
          pending.get(requestId)?.reject(new Error("Cancelled.")); // also clears the call's timeout timer
          pending.delete(requestId);
        }
        reject(new Error("Cancelled."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    cancelled.catch(() => {}); // it is raced below; a cancel after the call ended has no one waiting
    let work: Promise<any> | undefined;
    try {
      proc = await Promise.race([start(), cancelled]);
      touch();
      requestId = nextId + 1;
      work = request(proc, "tools/call", { name, arguments: callArgs }, callTimeoutMs);
      work.catch(() => {}); // a late answer or timeout after cancelling is not an error to report
      const result = await Promise.race([work, cancelled]);
      const structured = (result?.structuredContent ?? {}) as Record<string, any>;
      return {
        text: (result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n"),
        data: structured,
        isError: Boolean(result?.isError),
        refusal: refusalOf(structured),
      };
    } finally {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      touch();
    }
  }

  return {
    call(name, callArgs, signal) {
      const run = queue.then(() => callOnce(name, callArgs, signal));
      queue = run.catch(() => {});
      return run;
    },
    async close() {
      clearTimeout(idleTimer);
      await stopNow();
    },
  };
}
