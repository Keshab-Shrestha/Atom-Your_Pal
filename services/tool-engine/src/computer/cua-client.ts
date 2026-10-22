import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";

export interface CuaResult {
  text: string;
  data: Record<string, any>;
  isError: boolean;
  refusal: { code: string; message: string } | undefined;
}

export interface CuaReadiness {
  ready: boolean;
  reused: boolean;
  startupMs: number;
  probeMs: number;
  missingTools: string[];
  /** The driver offers `check_permissions`, a read-only TCC status (optional: older drivers lack it). */
  permissionCheck?: boolean;
}

export interface CuaTransport {
  /** Zero when stopped; snapshots belong to one generation only. Optional for alternate transports. */
  readonly generation?: number;
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal, expectedGeneration?: number): Promise<CuaResult>;
  /** Protocol-only check: no app/window/screenshot reads or input. */
  probe?(signal?: AbortSignal): Promise<CuaReadiness>;
  close(): Promise<void>;
}

export interface CuaTiming {
  stage: "initialize" | "probe" | "call";
  durationMs: number;
  ok: boolean;
  /** Method name only, never arguments or output. */
  tool?: string;
}

export interface CuaTransportOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  callTimeoutMs?: number;
  initializeTimeoutMs?: number;
  /** Stop after this long with no active call. Starts again on the next call. */
  idleMs?: number;
  onTiming?: (timing: CuaTiming) => void;
}

function refusalOf(data: Record<string, any>): { code: string; message: string } | undefined {
  if (data.refusal && typeof data.refusal.code === "string") return { code: data.refusal.code, message: String(data.refusal.message ?? "") };
  if (typeof data.code === "string" && data.effect === "refused") return { code: data.code, message: String(data.reason ?? data.escalation?.reason ?? "") };
  return undefined;
}

/** Standard mode, telemetry off; inherited settings cannot widen permissions (ADR-054). */
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

type Proc = ChildProcessByStdio<Writable, Readable, null>;
interface Pending { resolve: (r: any) => void; reject: (e: Error) => void }
interface Connection {
  proc: Proc;
  generation: number;
  ready: Promise<void>;
  startupMs: number;
  pending: Map<number, Pending>;
  stopped?: Promise<void>;
}

const REQUIRED_TOOLS = ["list_apps", "list_windows", "get_window_state", "launch_app", "click", "type_text", "press_key", "hotkey", "scroll", "set_value", "get_screen_size", "get_desktop_state"];
const elapsed = (start: number) => Math.max(0, Math.round(performance.now() - start));
class StaleSession extends Error {}

/** Lazy serialized stdio MCP client. Never replays failed actions; only retires its own child. */
export function createCuaTransport(options: CuaTransportOptions = {}): CuaTransport {
  const { command = `${process.env.HOME}/.local/bin/cua-driver`, args = ["mcp"], callTimeoutMs = 30_000,
    initializeTimeoutMs = 15_000, idleMs = 120_000, onTiming } = options;
  const env = cuaEnvironment(options.env ?? process.env);
  let active: Connection | undefined;
  let nextId = 0, generation = 0;
  let idleTimer: NodeJS.Timeout | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const stopping = new Set<Promise<void>>();

  function send(c: Connection, message: object) { c.proc.stdin.write(`${JSON.stringify(message)}\n`); }
  function fail(c: Connection, error: Error) {
    for (const p of c.pending.values()) p.reject(error);
    c.pending.clear();
  }

  /** Bound SIGTERM with SIGKILL of this exact child, never a competing app's helper. */
  function retire(c: Connection, error: Error): Promise<void> {
    if (c.stopped) return c.stopped;
    if (active === c) { active = undefined; clearTimeout(idleTimer); }
    fail(c, error);
    c.stopped = new Promise<void>((resolve) => {
      if (c.proc.exitCode !== null || c.proc.signalCode !== null || c.proc.pid === undefined) { resolve(); return; }
      const killTimer = setTimeout(() => c.proc.kill("SIGKILL"), 500);
      killTimer.unref();
      c.proc.once("close", () => { clearTimeout(killTimer); resolve(); });
      c.proc.stdin.end();
      c.proc.kill("SIGTERM");
    });
    const stopped = c.stopped;
    stopping.add(stopped);
    void stopped.then(() => stopping.delete(stopped));
    return stopped;
  }

  function request(c: Connection, method: string, params: object, timeoutMs = callTimeoutMs): Promise<any> {
    if (c.stopped) return Promise.reject(new Error("Cua Driver closed; look again before continuing."));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        c.pending.delete(id);
        reject(new Error(`Cua Driver did not answer within ${Math.round(timeoutMs / 1000)} s. The outcome may be unknown; do not repeat an action automatically.`));
      }, timeoutMs);
      c.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      send(c, { jsonrpc: "2.0", id, method, params });
    });
  }

  function connection(): Connection {
    if (active) return active;
    const started = performance.now();
    const proc = spawn(command, args, { env, stdio: ["pipe", "pipe", "ignore"] });
    const c: Connection = { proc, generation: ++generation, ready: Promise.resolve(), startupMs: 0, pending: new Map() };
    active = c;
    // Pending replies belong to one connection: a late old exit cannot reject a replacement's calls.
    proc.on("error", (error) => void retire(c, new Error(`Could not start Cua Driver (${error.message}). Is it installed?`)));
    proc.stdin.on("error", () => void retire(c, new Error("Cua Driver connection failed. The action outcome may be unknown.")));
    proc.on("exit", () => void retire(c, new Error("Cua Driver stopped unexpectedly. The action outcome may be unknown; look again before continuing.")));
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let message: any;
      try { message = JSON.parse(line); } catch { return; }
      if (!message || typeof message !== "object") return;
      const p = c.pending.get(message.id);
      if (!p) return;
      c.pending.delete(message.id);
      message.error ? p.reject(new Error(String(message.error.message ?? "Cua Driver error"))) : p.resolve(message.result);
    });
    c.ready = request(c, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "atom", version: "0" } }, initializeTimeoutMs)
      .then(() => { send(c, { jsonrpc: "2.0", method: "notifications/initialized" }); })
      .then(() => { c.startupMs = elapsed(started); onTiming?.({ stage: "initialize", durationMs: c.startupMs, ok: true }); })
      .catch((error) => {
        onTiming?.({ stage: "initialize", durationMs: elapsed(started), ok: false });
        void retire(c, error);
        throw error;
      });
    return c;
  }

  function touch(c: Connection) {
    clearTimeout(idleTimer);
    if (active !== c) return;
    idleTimer = setTimeout(() => void retire(c, new Error("Cua Driver stopped after being idle.")), idleMs);
    idleTimer.unref();
  }

  async function using<T>(work: (c: Connection, reused: boolean) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error("Cancelled before it ran.");
    // A replacement must not act while a cancelled or hung owned helper is still stopping.
    await Promise.all(stopping);
    if (signal?.aborted) throw new Error("Cancelled before it ran.");
    clearTimeout(idleTimer); // idle lifetime begins after work, never during an active call
    const reused = Boolean(active);
    const c = connection();
    const abort = () => {
      for (const requestId of c.pending.keys()) send(c, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId, reason: "ATOM cancelled" } });
      void retire(c, new Error("Cancelled. The action outcome may be unknown; look again before continuing."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await c.ready;
      if (signal?.aborted) throw new Error("Cancelled.");
      if (c.stopped) throw new Error("Cua Driver closed; look again before continuing.");
      return await work(c, reused);
    } catch (error) {
      // Rejecting an old token is a successful guard, not a reason to discard a healthy warm replacement.
      if (!(error instanceof StaleSession)) void retire(c, error instanceof Error ? error : new Error("Cua Driver failed."));
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      touch(c);
    }
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work);
    queue = run.catch(() => {});
    return run;
  }

  return {
    get generation() { return active?.generation ?? 0; },
    call(name, callArgs, signal, expectedGeneration) {
      return enqueue(() => using(async (c) => {
        if (expectedGeneration !== undefined && expectedGeneration !== c.generation) throw new StaleSession("The computer session changed. Look at the app again before acting; no input was sent.");
        const started = performance.now();
        let ok = false;
        try {
          const result = await request(c, "tools/call", { name, arguments: callArgs });
          const structured = (result?.structuredContent ?? {}) as Record<string, any>;
          ok = !result?.isError;
          return {
            text: (result?.content ?? []).filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n"),
            data: structured, isError: Boolean(result?.isError), refusal: refusalOf(structured),
          };
        } finally { onTiming?.({ stage: "call", tool: name, durationMs: elapsed(started), ok }); }
      }, signal));
    },
    probe(signal) {
      return enqueue(() => using(async (c, reused) => {
        const started = performance.now();
        let ok = false;
        try {
          const names = new Set<string>();
          let cursor: string | undefined;
          for (let page = 0; page < 20; page++) {
            const result = await request(c, "tools/list", cursor ? { cursor } : {});
            if (!Array.isArray(result?.tools)) throw new Error("Cua Driver returned an invalid capability list. Check the driver installation.");
            for (const tool of result.tools) if (typeof tool?.name === "string") names.add(tool.name);
            cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
            if (!cursor) break;
            if (page === 19) throw new Error("Cua Driver capability listing did not finish. Check the driver installation.");
          }
          const missingTools = REQUIRED_TOOLS.filter((name) => !names.has(name));
          ok = missingTools.length === 0;
          return { ready: ok, reused, startupMs: c.startupMs, probeMs: elapsed(started), missingTools, permissionCheck: names.has("check_permissions") };
        } finally { onTiming?.({ stage: "probe", durationMs: elapsed(started), ok }); }
      }, signal));
    },
    async close() {
      clearTimeout(idleTimer);
      if (active) await retire(active, new Error("Cua Driver closed."));
      await Promise.all(stopping);
    },
  };
}
