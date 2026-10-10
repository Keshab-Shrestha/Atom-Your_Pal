import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Logger } from "@zeno/shared";
import { DEFAULT_TIER, DIFFICULTY_RUNGS, tierFromScore, type DecisionEngine, type TierChoice } from "./engine.ts";

// ADR-083: Laya (local, MCP server over stdio) rates each job's difficulty in one forward pass. The server starts on
// the first job and stays warm; a call that takes over 5 s, fails, or finds Laya missing falls back, so a job never
// waits on Laya. The task text goes to the local server only: it is never logged here.

export const LAYA_TIMEOUT_MS = 5000;

/** The difficulty question, checked on 2026-10-10 (ADR-083). The task goes in `state.request`. */
export const DIFFICULTY_QUESTION = {
  difficulty: {
    type: "score",
    instructions: "How hard is the task in `request` for an AI assistant?",
    criteria: [
      `${DIFFICULTY_RUNGS[0]}: one fact or a quick lookup`,
      `${DIFFICULTY_RUNGS[1]}: a short summary or short piece of writing`,
      `${DIFFICULTY_RUNGS[2]}: multi-step research, comparison, or a few pages of writing`,
      `${DIFFICULTY_RUNGS[3]}: complex code changes, design work, or careful analysis with numbers`,
    ],
  },
};

/** One live session with Laya's server. */
export interface LayaClient {
  /** Calls `laya_predict`; resolves to the raw MCP tool result. Rejects when `signal` aborts. */
  predict(state: Record<string, string>, questions: object, signal: AbortSignal): Promise<unknown>;
  /** Ends the session and stops the server process. */
  close(): Promise<void>;
}

/** Starts a session. `onCrash` is called if the server goes away by itself (not after `close`). */
export type LayaConnect = (onCrash: () => void) => Promise<LayaClient>;

/** Thrown by a connect when the server program is not there: Laya is then off until ZENO restarts. */
export class LayaMissingError extends Error {
  constructor(path: string) {
    super(`Laya's server was not found at ${path}.`);
    this.name = "LayaMissingError";
  }
}

type Env = Record<string, string | undefined>;

export function layaServerPath(env: Env = process.env): string {
  return env.ZENO_LAYA_SERVER?.trim() || join(homedir(), "laya", ".venv", "bin", "laya-mcp-server");
}

/** The real connect: spawns the server over stdio with the settings checked for ADR-083. */
export function stdioLaya(path: string): LayaConnect {
  return async (onCrash) => {
    if (!existsSync(path)) throw new LayaMissingError(path);
    // The SDK adds only safe variables (HOME, PATH, USER…) to these. Laya's own output is not ours to show.
    const transport = new StdioClientTransport({
      command: path,
      env: { LAYA_DEVICE: "mps", LAYA_PRELOAD: "1", LAYA_MODELS: "english" },
      stderr: "ignore",
    });
    const client = new Client({ name: "zeno", version: "1.0.0" });
    try {
      await client.connect(transport);
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
    let closing = false;
    client.onclose = () => {
      if (!closing) onCrash();
    };
    return {
      predict: (state, questions, signal) => client.callTool({ name: "laya_predict", arguments: { state, questions } }, undefined, { signal }),
      async close() {
        closing = true;
        await client.close();
      },
    };
  };
}

/** The score from a `laya_predict` result (`content[0].text` is JSON). Throws for anything else. */
export function readScore(result: unknown): number {
  const r = result as { isError?: boolean; content?: { text?: unknown }[] } | null;
  if (r?.isError) throw new Error("Laya answered with an error.");
  const text = r?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("Laya's answer has no text.");
  const score = (JSON.parse(text) as { answers?: { difficulty?: { score?: unknown } } }).answers?.difficulty?.score;
  if (typeof score !== "number" || !Number.isFinite(score)) throw new Error("Laya's answer has no difficulty score.");
  return score;
}

export interface LayaEngineOptions {
  /** Default: the real server at layaServerPath(env). */
  connect?: LayaConnect;
  timeoutMs?: number;
  /** ZENO_LAYA=0 turns Laya off; ZENO_LAYA_SERVER moves the server. Default: process.env. */
  env?: Env;
  log?: Pick<Logger, "info" | "warn">;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createLayaEngine(options: LayaEngineOptions = {}): DecisionEngine {
  const { env = process.env, timeoutMs = LAYA_TIMEOUT_MS, log } = options;
  const connect = options.connect ?? stdioLaya(layaServerPath(env));
  /** Why Laya is off for good (until ZENO restarts); undefined while it may be used. */
  let off: string | undefined = env.ZENO_LAYA === "0" ? "turned off" : undefined;
  let session: Promise<LayaClient> | undefined;
  /** Crashes and failed starts so far: the first gets one restart, the second turns Laya off. */
  let failures = 0;
  let closed = false;

  function lost(which: Promise<LayaClient>, why: string) {
    if (session !== which) return; // an older session, already replaced
    session = undefined;
    failures += 1;
    if (failures > 1) off = "failed twice";
    log?.warn("laya.lost", { reason: why, restart: !off });
  }

  /** The warm session, starting the server on first use. A start that outlives a job's limit keeps going. */
  function ensure(): Promise<LayaClient> {
    if (session) return session;
    const started = Date.now();
    log?.info("laya.start");
    const current: Promise<LayaClient> = connect(() => lost(current, "crashed")).then(
      (client) => {
        if (closed || session !== current) {
          void client.close().catch(() => {});
          throw new Error("Laya was closed while it started.");
        }
        log?.info("laya.ready", { ms: Date.now() - started });
        return client;
      },
      (error: unknown) => {
        if (error instanceof LayaMissingError) {
          off = "missing";
          session = undefined;
          log?.warn("laya.unavailable", { reason: reason(error) });
        } else lost(current, `could not start: ${reason(error)}`);
        throw error;
      },
    );
    current.catch(() => {}); // a start nobody is waiting for any more must not be an unhandled rejection
    session = current;
    return current;
  }

  return {
    async chooseTier(task) {
      const fallback: TierChoice = { tier: DEFAULT_TIER, source: "fallback" };
      if (off || closed) return fallback;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), timeoutMs)));
      const work = ensure().then((client) => client.predict({ request: task }, DIFFICULTY_QUESTION, controller.signal));
      work.catch(() => {}); // after a timeout its rejection is nobody's
      try {
        const result = await Promise.race([work, late]);
        if (result === "late") {
          controller.abort();
          log?.warn("laya.slow", { ms: timeoutMs });
          return fallback;
        }
        const score = readScore(result);
        return { ...tierFromScore(score), score, source: "laya" };
      } catch {
        // Never the error text: it could carry what was sent. Start failures are logged by ensure().
        log?.warn("laya.failed");
        return fallback;
      } finally {
        clearTimeout(timer);
      }
    },

    warm() {
      if (!off && !closed) void ensure().catch(() => {});
    },

    async close() {
      closed = true;
      const current = session;
      session = undefined;
      if (current) await current.then((client) => client.close(), () => {});
    },
  };
}
