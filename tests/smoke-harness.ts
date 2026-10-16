// A real ATOM runtime for smoke tests. It starts `node apps/mac/src/main.ts --island` in a temp folder with a clean environment, so it never touches
// the user's data, token or settings: the data files, the Local API token and the settings all live under that folder (they are cwd-relative).
// The harness drives it as the Swift app does: JSON lines on stdin and stdout. Tests built on it say what they check; nothing here asserts.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAIN = join(ROOT, "apps/mac/src/main.ts");

export interface SmokeRuntime {
  dir: string;
  port: number;
  /** Every protocol event the runtime has sent, in order. */
  events: Record<string, any>[];
  send(command: Record<string, unknown>): void;
  /** Resolves with the first event (already seen or still to come) that matches, or rejects after `ms`. */
  waitFor(match: (event: Record<string, any>) => boolean, ms: number, what: string): Promise<Record<string, any>>;
  /** The Local API token this runtime made in its own folder. */
  token(): string;
  /** A request to the Local API. `host` overrides the Host header. */
  api(method: string, path: string, options?: { body?: unknown; token?: string | null; host?: string }): Promise<{ status: number; json: any; headers: Record<string, string | string[] | undefined>; text: string }>;
  stop(): Promise<void>;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });

/**
 * The user-session variables the signed-in `claude` program needs to reach its credentials (the keychain and its config folder). A list of names, never a
 * copy of the whole environment: API keys and tokens (ANTHROPIC_*, CLAUDE_CODE_*, the Telegram token) must not reach the child.
 */
const SESSION_VARIABLES = ["USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "__CF_USER_TEXT_ENCODING", "XPC_SERVICE_NAME", "XPC_FLAGS", "CLAUDE_CONFIG_DIR"];
function sessionEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of SESSION_VARIABLES) {
    const value = process.env[name];
    if (value) out[name] = value;
  }
  return out;
}

/** The environment of the child: only what it needs to run, never the user's .env (no Telegram, no keys). */
function cleanEnv(dir: string, port: number, model: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "", // the signed-in `claude` program finds its credentials through the real home
    ...sessionEnv(),
    ATOM_API_PORT: String(port),
    ATOM_LLM_PROVIDER: "claude-plan",
    ATOM_LLM_MODEL: model,
    ATOM_ISLAND_SETTINGS: join(dir, "config", "island.json"),
    ATOM_LOG_FILE: join(dir, "logs", "atom.log"),
    // Everything that touches the user's Mac or needs a model download is off.
    ATOM_COMPUTER: "0", ATOM_APPS: "0", ATOM_MEDIA: "0", ATOM_NOTES: "0", ATOM_WEATHER: "0", ATOM_FRONT_WINDOW: "0", ATOM_SHORTCUTS: "0", ATOM_PREWARM: "0", ATOM_CALENDAR: "0",
  };
}

export async function startRuntime(options: { model?: string; readyMs?: number; prepare?: (dir: string) => void } = {}): Promise<SmokeRuntime> {
  const dir = mkdtempSync(join(tmpdir(), "atom-smoke-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });
  options.prepare?.(dir); // files the test needs in the temp folder before the runtime starts (a skill, a settings file)
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN, "--island"], {
    cwd: dir,
    env: cleanEnv(dir, port, options.model ?? "claude-haiku-5-5"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events: Record<string, any>[] = [];
  const waiters: { match: (e: Record<string, any>) => boolean; resolve: (e: Record<string, any>) => void }[] = [];
  let buffer = "";
  let stderr = "";
  let exited: number | null | undefined;
  child.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let event: Record<string, any>;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // not a protocol line
      }
      events.push(event);
      for (const w of [...waiters]) if (w.match(event)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(event));
    }
  });
  child.stderr!.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf8")).slice(-4000)));
  child.on("exit", (code) => (exited = code));

  const runtime: SmokeRuntime = {
    dir,
    port,
    events,
    send: (command) => void child.stdin!.write(`${JSON.stringify(command)}\n`),
    waitFor(match, ms, what) {
      const seen = events.find(match);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const at = waiters.findIndex((w) => w.resolve === done);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error(`Timed out after ${ms} ms waiting for ${what}. Exit: ${exited ?? "running"}. Last stderr: ${stderr.slice(-600)}. Events: ${events.slice(-6).map((e) => e.type).join(", ")}`));
        }, ms);
        const done = (e: Record<string, any>) => (clearTimeout(timer), resolve(e));
        waiters.push({ match, resolve: done });
      });
    },
    token: () => readFileSync(join(dir, "data", "api-token"), "utf8").trim(),
    api: (method, path, opts = {}) =>
      new Promise((resolve, reject) => {
        const headers: Record<string, string> = {};
        const token = opts.token === undefined ? runtime.token() : opts.token;
        if (token) headers.authorization = `Bearer ${token}`;
        if (opts.host) headers.host = opts.host;
        const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
        if (body !== undefined) headers["content-type"] = "application/json";
        const req = request({ host: "127.0.0.1", port, method, path, headers, setHost: !opts.host }, (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => {
            let json: any = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              // a page, not JSON
            }
            resolve({ status: res.statusCode ?? 0, json, headers: res.headers, text });
          });
        });
        req.on("error", reject);
        req.end(body);
      }),
    async stop() {
      try {
        child.stdin!.end();
      } catch {
        // already closed
      }
      if (exited === undefined) {
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const force = setTimeout(() => (child.kill("SIGKILL"), resolve()), 8_000);
          child.once("exit", () => (clearTimeout(force), resolve()));
        });
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };

  try {
    await runtime.waitFor((e) => e.type === "ready", options.readyMs ?? 60_000, "the runtime's ready event");
  } catch (error) {
    await runtime.stop();
    throw error;
  }
  return runtime;
}

/** Turns the Local API on in the runtime and waits until it listens. */
export async function enableApi(runtime: SmokeRuntime): Promise<void> {
  runtime.send({ type: "api.set", on: true });
  const status = await runtime.waitFor((e) => e.type === "api" && e.on === true, 20_000, "the Local API to start");
  if (status.error) throw new Error(`The Local API did not start: ${status.error}`);
}

/** Polls `read` until `done` says so, or rejects after `ms`. */
export async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number, what: string, everyMs = 1_500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms waiting for ${what}. Last value: ${JSON.stringify(value).slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export const writeText = (path: string, text: string) => writeFileSync(path, text);
