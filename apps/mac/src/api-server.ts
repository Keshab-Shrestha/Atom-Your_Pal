// ADR-098 item 5: ATOM as a server. A local HTTP API (Node's http, no framework) that other tools (Hermes, Claude Code,
// the MCP entry in mcp-serve.ts) use to give ATOM goals, talk to ATOM, read tasks and reports, answer Needs you and
// start webhook routines. It listens on 127.0.0.1 only, and every request needs the token in data/api-token.
// Off until Settings → General → "Local API" is on. Logs method, route pattern, status and time: never bodies, goals,
// answers or the token.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { HelperError, type HelperStore, type Job, type JobState } from "@atom/helpers";
import type { Logger } from "@atom/shared";
import { answerNeed, needsYou, type TelegramBotOptions } from "./telegram-bot.ts";

export const DEFAULT_API_PORT = 4790;
/** Relative to the project folder, like data/helpers.db. */
export const API_TOKEN_FILE = "data/api-token";
const MAX_BODY_BYTES = 64 * 1024;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const NEED_KEY_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const STATES: readonly JobState[] = ["queued", "running", "done", "failed", "stopped"];

/** The API's state, for Settings. `tokenFile` is a path; the island reads the file only when Keshab clicks "Copy token". */
export interface ApiStatus {
  on: boolean;
  port: number;
  tokenFile: string;
  error?: string;
}

export interface ApiServer {
  /** Starts or stops listening. Resolves when the change is done (or has failed: `error`). */
  set(on: boolean): Promise<ApiStatus>;
  stop(): void;
}

/** The chat id of the API's goal turns; a goal made in them has this `source`. */
export const API_GOAL_SOURCE = "api";

export interface ApiServerOptions {
  log: Logger;
  /** ATOM_API_PORT, or DEFAULT_API_PORT. */
  port?: string | undefined;
  tokenFile?: string;
  /** One ATOM chat turn (the same Core setup as the window's) in an API chat; resolves to ATOM's answer. */
  ask(text: string, chatId?: string): Promise<string>;
  helpers?: HelperStore;
  held(job: Job): string | undefined;
  approvals: Pick<TelegramBotOptions["approvals"], "pending" | "answer">;
  describe(error: unknown): string;
}

/** Reads data/api-token, or makes it (32 random bytes as hex, mode 0600) when it is not there. */
export function readOrCreateToken(file: string): string {
  try {
    const token = readFileSync(file, "utf8").trim();
    if (!TOKEN_PATTERN.test(token)) throw new Error(`${file} does not hold a valid token. Delete it, and ATOM makes a new one.`);
    chmodSync(file, 0o600);
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(file), { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(file, `${token}\n`, { mode: 0o600, flag: "wx" });
  return token;
}

/** The port in ATOM_API_PORT, or the default. Throws for a value that is not a port. */
export function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_API_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`ATOM_API_PORT must be a port number (1 to 65535), not "${value.slice(0, 20)}".`);
  return port;
}

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Handler = (params: string[], body: Record<string, unknown>, query: URLSearchParams) => unknown;

interface Route {
  method: "GET" | "POST";
  /** For the log: the path with `:id` in place of each value. */
  pattern: string;
  match: RegExp;
  /** It reads a JSON body. */
  body?: boolean;
  run: Handler;
}

const digest = (text: string) => createHash("sha256").update(text).digest();

export function createApiServer(options: ApiServerOptions): ApiServer {
  const { log, helpers: store, held, approvals, describe } = options;
  const tokenFile = resolve(options.tokenFile ?? API_TOKEN_FILE);
  let server: Server | undefined;
  let port = DEFAULT_API_PORT;
  let tokenDigest: Buffer | undefined;
  let refused = 0;
  // One ATOM turn at a time: the API chat's Core answers one request at a time.
  let turns: Promise<unknown> = Promise.resolve();
  const turn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = turns.then(work, work);
    turns = next.catch(() => undefined);
    return next;
  };

  const team = () => {
    if (!store) throw new ApiError(503, "The team is not available.");
    return store;
  };
  const wholeId = (text: string | undefined) => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "The id must be a whole number.");
    return n;
  };
  const text = (body: Record<string, unknown>, field: string) => {
    const value = body[field];
    if (typeof value !== "string" || !value.trim()) throw new ApiError(400, `"${field}" must be text that is not empty.`);
    return value.trim();
  };
  const nameOf = (helper: string) => {
    try {
      return team().soul(helper).name;
    } catch {
      return helper;
    }
  };
  const jobOut = (job: Job) => ({
    id: job.id,
    worker: nameOf(job.helper),
    state: job.state,
    task: job.task,
    ...(job.title ? { title: job.title } : {}),
    ...(job.summary ? { summary: job.summary } : {}),
    ...(job.step ? { step: job.step } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.state === "queued" && held(job) ? { held: held(job) } : {}),
    ...(job.goalId ? { goalId: job.goalId } : {}),
    ...(job.labels ? { labels: job.labels } : {}),
    createdAt: job.createdAt.toISOString(),
    ...(job.endedAt ? { endedAt: job.endedAt.toISOString() } : {}),
  });
  const needs = () =>
    needsYou(store, held, approvals.pending()).map((need) => ({
      key: need.key,
      text: need.text,
      actions: (need.buttons ?? []).flat().map((b) => ({ action: b.text.toLowerCase(), label: b.text, data: b.data })),
    }));

  const routes: Route[] = [
    {
      method: "POST",
      pattern: "/v1/goals",
      match: /^\/v1\/goals$/,
      body: true,
      // The same path as a spoken or typed goal: ATOM reads it and hands it to the team with its delegate tool.
      run: (_p, body) => {
        const goal = text(body, "goal");
        return turn(async () => {
          const made: number[] = [];
          const stop = store?.onChange((change) => {
            // Only a goal this surface made: its Core's chat is "api" (runtime.ts), other surfaces have other sources.
            if (change.action === "goal" && !change.ended && change.source === API_GOAL_SOURCE) made.push(change.goal);
          });
          try {
            const answer = await atom(goal);
            return { goalId: made[0] ?? null, answer };
          } finally {
            stop?.();
          }
        });
      },
    },
    {
      method: "GET",
      pattern: "/v1/goals/:id",
      match: /^\/v1\/goals\/([^/]+)$/,
      run: ([id]) => {
        const goal = team().goal(wholeId(id));
        if (!goal) throw new ApiError(404, "There is no such goal.");
        return {
          id: goal.id,
          goal: goal.text,
          status: goal.endedAt ? "ended" : "running",
          createdAt: goal.createdAt.toISOString(),
          ...(goal.endedAt ? { endedAt: goal.endedAt.toISOString() } : {}),
          ...(goal.report ? { summary: goal.report.summary, report: goal.report } : {}),
          tasks: goal.tasks.map(jobOut),
        };
      },
    },
    {
      method: "POST",
      pattern: "/v1/chat",
      match: /^\/v1\/chat$/,
      body: true,
      run: (_p, body) => {
        const said = text(body, "text");
        const chatId = body.chatId;
        if (chatId !== undefined && (typeof chatId !== "string" || !CHAT_ID_PATTERN.test(chatId))) {
          throw new ApiError(400, '"chatId" must be 1 to 40 letters, digits, "-" or "_".');
        }
        return turn(async () => ({ answer: await atom(said, chatId as string | undefined) }));
      },
    },
    {
      method: "GET",
      pattern: "/v1/tasks",
      match: /^\/v1\/tasks$/,
      run: (_p, _b, query) => {
        const state = query.get("state");
        if (state !== null && !STATES.includes(state as JobState)) throw new ApiError(400, `"state" must be one of: ${STATES.join(", ")}.`);
        const s = team();
        const jobs = [...s.list(), ...s.managers()].flatMap((owner) => owner.jobs).filter((j) => state === null || j.state === state);
        return { tasks: jobs.sort((a, b) => b.id - a.id).map(jobOut) };
      },
    },
    {
      method: "GET",
      pattern: "/v1/tasks/:id",
      match: /^\/v1\/tasks\/([^/]+)$/,
      run: ([id]) => {
        const s = team();
        const job = s.get(wholeId(id));
        if (!job) throw new ApiError(404, "There is no such task.");
        const report = s.report(job.id);
        return { task: jobOut(job), ...(report ? { report: { title: report.title, summary: report.summary, body: report.body, sources: report.sources } } : {}) };
      },
    },
    {
      method: "GET",
      pattern: "/v1/needs",
      match: /^\/v1\/needs$/,
      run: () => ({ needs: needs().map(({ actions, ...need }) => ({ ...need, actions: actions.map(({ data: _data, ...a }) => a) })) }),
    },
    {
      method: "POST",
      pattern: "/v1/needs/:key",
      match: /^\/v1\/needs\/([^/]+)$/,
      body: true,
      // The same actions as the Telegram buttons, by the button's word: allow, decline, approve, reject, accept, retry.
      run: ([raw], body) => {
        const key = decodeURIComponent(raw ?? "");
        if (!NEED_KEY_PATTERN.test(key)) throw new ApiError(400, "That is not a Needs you key.");
        const action = text(body, "action").toLowerCase();
        const need = needs().find((n) => n.key === key);
        if (!need) throw new ApiError(404, "Nothing waits under that key now.");
        const button = need.actions.find((a) => a.action === action);
        if (!button) throw new ApiError(400, `"action" must be one of: ${need.actions.map((a) => a.action).join(", ") || "none (it has no actions)"}.`);
        return { said: answerNeed(button.data, store, approvals) };
      },
    },
    {
      method: "POST",
      pattern: "/v1/hooks/:routineId",
      match: /^\/v1\/hooks\/([^/]+)$/,
      run: ([id]) => {
        const s = team();
        const routineId = wholeId(id);
        const routine = s.list().flatMap((h) => h.routines).find((r) => r.id === routineId);
        if (!routine) throw new ApiError(404, "There is no such routine.");
        if (!routine.webhook) throw new ApiError(403, 'This routine cannot be started by webhook. Turn on "Can be started by webhook" on the Scheduled page.');
        return { taskId: s.startRoutine(routineId).id };
      },
    },
  ];

  async function atom(said: string, chatId?: string): Promise<string> {
    try {
      return await options.ask(said, chatId);
    } catch (error) {
      throw new ApiError(502, `ATOM could not answer: ${describe(error)}`);
    }
  }

  function authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    return Boolean(tokenDigest) && timingSafeEqual(digest(given), tokenDigest!);
  }

  function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((done, fail) => {
      if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return fail(new ApiError(413, "The body is larger than 64 KB."));
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          fail(new ApiError(413, "The body is larger than 64 KB."));
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on("error", fail);
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        if (!raw) return done({});
        try {
          const value: unknown = JSON.parse(raw);
          if (!value || typeof value !== "object" || Array.isArray(value)) return fail(new ApiError(400, "The body must be a JSON object."));
          done(value as Record<string, unknown>);
        } catch {
          fail(new ApiError(400, "The body is not valid JSON."));
        }
      });
    });
  }

  function reply(res: ServerResponse, status: number, data: unknown, error: string | null) {
    if (res.headersSent || res.destroyed) return;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: error === null, data: error === null ? data : null, error }));
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = routes.find((r) => r.method === req.method && r.match.test(url.pathname));
    let status = 200;
    try {
      if (!authorized(req)) {
        refused++;
        log.warn("api.unauthorized", { count: refused });
        status = 401;
        req.resume();
        return reply(res, status, null, "A valid token is needed: Authorization: Bearer <the token in data/api-token>.");
      }
      if (!route) {
        req.resume();
        status = 404;
        return reply(res, status, null, "There is no such endpoint.");
      }
      const body = route.body ? await readBody(req) : (req.resume(), {});
      const params = route.match.exec(url.pathname)!.slice(1);
      const data = await route.run(params, body, url.searchParams);
      reply(res, status, data, null);
    } catch (error) {
      if (error instanceof ApiError) status = error.status;
      else if (error instanceof HelperError) status = 409;
      else {
        status = 500;
        log.error("api.failed", { route: route?.pattern ?? "unknown", name: error instanceof Error ? error.name : "unknown" });
      }
      reply(res, status, null, status === 500 ? "ATOM could not do that. The details are in the log." : (error as Error).message);
    } finally {
      log.info("api.request", { method: req.method, route: route?.pattern ?? "unknown", status, ms: Date.now() - started });
    }
  }

  const status = (on: boolean, error?: string): ApiStatus => ({ on, port, tokenFile, ...(error ? { error } : {}) });

  return {
    async set(on) {
      if (!on) {
        if (server) {
          server.close();
          server.closeAllConnections();
          server = undefined;
          log.info("api.stop");
        }
        return status(false);
      }
      if (server) return status(true);
      try {
        port = parsePort(options.port);
        tokenDigest = digest(readOrCreateToken(tokenFile));
      } catch (error) {
        log.warn("api.start_failed", { reason: "setup" });
        return status(false, describe(error));
      }
      const next = createServer((req, res) => void handle(req, res));
      next.requestTimeout = 30_000; // receiving the request; an ATOM turn after that may take longer
      return new Promise<ApiStatus>((done) => {
        next.once("error", (error: NodeJS.ErrnoException) => {
          log.warn("api.start_failed", { code: error.code ?? "unknown", port });
          done(status(false, error.code === "EADDRINUSE" ? `Port ${port} is in use. Set ATOM_API_PORT in .env to another port, then restart ATOM.` : describe(error)));
        });
        next.listen(port, "127.0.0.1", () => {
          server = next;
          log.info("api.start", { port });
          done(status(true));
        });
      });
    },
    stop() {
      void this.set(false);
    },
  };
}
