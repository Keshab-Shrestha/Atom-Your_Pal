// ADR-098 item 5: ATOM as a server. A local HTTP API (Node's http, no framework) that other tools (Hermes, Claude Code,
// the MCP entry in mcp-serve.ts) use to give ATOM goals, talk to ATOM, read tasks and reports, answer Needs you and
// start webhook routines. It listens on 127.0.0.1 only, and every request needs the token in data/api-token.
// Off until Settings → General → "Local API" is on. Logs method, route pattern, status and time: never bodies, goals,
// answers or the token.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { HelperError, isFinal, type GoalReport, type HelperStore, type Job, type JobState, type Routine } from "@atom/helpers";
import type { Logger } from "@atom/shared";
import { answerNeed, needsYou, type TelegramBotOptions } from "./telegram-bot.ts";
import { APP_CSS, APP_HTML, APP_ICON_PNG, APP_JS, APP_MANIFEST } from "./api-app-page.ts";

export const DEFAULT_API_PORT = 4790;
/** Relative to the project folder, like data/helpers.db. */
export const API_TOKEN_FILE = "data/api-token";
const MAX_BODY_BYTES = 64 * 1024;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
/** ADR-110 (N3): the chatIds of goal chats ("goal-<id>", saved as "api-goal-<id>"); /v1/chat refuses them. */
const GOAL_CHAT_ID = /^goal-/i;
const NEED_KEY_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
/**
 * The Needs you kinds (the first part of a button's data) the Local API may answer: a plan (`p`) and a retry (`r`). Risky-action
 * cards (`a`), soul changes (`s`), skill drafts, edits and hub installs (`d`, `e`, `h`) are answered in the ATOM window or on
 * Telegram only. A token that could answer them would let whoever holds it start a task and then approve that task's risky steps
 * (security review, 2026-10-16; Keshab chose "plans only").
 */
export const API_ANSWERABLE_KINDS: ReadonlySet<string> = new Set(["p", "r"]);
const kindOf = (data: string) => data.split(":")[0] ?? "";

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
  /**
   * 2026-10-15: makes a new token. The old one stops working at once, also while the server runs. The file is
   * data/api-token; the token itself is never logged or returned.
   */
  regenerate(): ApiStatus;
  stop(): void;
}

/** How long one API turn may take before the next request is served (ms). */
export const API_TURN_TIMEOUT_MS = 10 * 60_000;

export interface ApiServerOptions {
  log: Logger;
  /** Default API_TURN_TIMEOUT_MS. */
  turnTimeoutMs?: number;
  /** ATOM_API_PORT, or DEFAULT_API_PORT. */
  port?: string | undefined;
  /** ADR-121: ATOM_API_HOST, the one private name (the Tailscale `.ts.net` name) a request may use besides 127.0.0.1 and localhost. */
  host?: string | undefined;
  /** The clock, in ms; tests set it. */
  now?: () => number;
  tokenFile?: string;
  /** One ATOM chat turn (the same Core setup as the window's) in an API chat; resolves to ATOM's answer. */
  ask(text: string, chatId?: string, signal?: AbortSignal): Promise<string>;
  helpers?: HelperStore;
  approvals: Pick<TelegramBotOptions["approvals"], "pending" | "answer">;
  describe(error: unknown): string;
  /**
   * ADR-110 (N3): a goal is a main-agent turn in a chat of its own, "api-goal-<goalId>"; its status and report come from
   * the Board rows of that chat. `said`: the first thing said in a chat (the goal's text).
   */
  said(chatId: string): string | undefined;
  /** The start of a routine (a webhook call), as the clock's; false while its last run still goes. */
  startRoutine?(routine: Routine): boolean;
}

/** ADR-110 (N3): the chat of a native goal. */
export const nativeGoalChat = (id: number) => `api-goal-${id}`;

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

/** ADR-121: ten wrong tokens inside one minute lock the API for one minute. */
export const MAX_WRONG_TOKENS = 10;
export const LOCK_WINDOW_MS = 60_000;

/** The files of the phone page. They hold no data, so they need no token (the Host check and the headers still apply). */
const PUBLIC_FILES: Readonly<Record<string, { type: string; body: string | Buffer }>> = {
  "/app": { type: "text/html; charset=utf-8", body: APP_HTML },
  "/app.js": { type: "text/javascript; charset=utf-8", body: APP_JS },
  "/app.css": { type: "text/css; charset=utf-8", body: APP_CSS },
  "/app.webmanifest": { type: "application/manifest+json; charset=utf-8", body: APP_MANIFEST },
  "/app-icon.png": { type: "image/png", body: APP_ICON_PNG },
};
const PAGE_HEADERS = {
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const digest = (text: string) => createHash("sha256").update(text).digest();

export function createApiServer(options: ApiServerOptions): ApiServer {
  const { log, helpers: store, approvals, describe } = options;
  const tokenFile = resolve(options.tokenFile ?? API_TOKEN_FILE);
  let server: Server | undefined;
  let port = DEFAULT_API_PORT;
  let tokenDigest: Buffer | undefined;
  let refused = 0;
  const now = options.now ?? Date.now;
  let wrongAt: number[] = [];
  const allowedHosts = new Set(["127.0.0.1", "localhost", ...(options.host?.trim() ? [options.host.trim().toLowerCase()] : [])]);
  /** The name in the Host header without its port, in lower case; "" when it is missing or not a plain name. */
  const hostName = (req: IncomingMessage) => {
    const header = String(req.headers.host ?? "").trim().toLowerCase();
    const m = /^([a-z0-9.-]+)(?::\d{1,5})?$/.exec(header);
    return m?.[1] ?? "";
  };
  const locked = () => {
    const from = now() - LOCK_WINDOW_MS;
    wrongAt = wrongAt.filter((t) => t > from);
    return wrongAt.length >= MAX_WRONG_TOKENS;
  };
  // The runtime serializes API turns around its singleton Core and rejects a duplicate chat before it waits.
  // A timeout aborts the underlying request so the singleton can safely serve the next queued chat.
  const turnLimitMs = options.turnTimeoutMs ?? API_TURN_TIMEOUT_MS;
  const withinLimit = <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ApiError(504, "ATOM did not answer in time. Ask again."));
      }, turnLimitMs);
      timer.unref();
    });
    return Promise.race([work(controller.signal), limit]).finally(() => clearTimeout(timer));
  };
  const turn = <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => withinLimit(work);

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
    ...(job.goalId ? { goalId: job.goalId } : {}),
    ...(job.labels ? { labels: job.labels } : {}),
    createdAt: job.createdAt.toISOString(),
    ...(job.endedAt ? { endedAt: job.endedAt.toISOString() } : {}),
  });
  // ADR-110 (N3): goals. ponytail: the id is the time in ms (one goal turn at a time, so it is unique); /v1/chat
  // refuses a chatId "goal-…", so no chat of its own is a goal's.
  let lastGoal = 0;
  const nativeJobs = (id: number) =>
    store ? store.list().flatMap((owner) => owner.jobs).filter((j) => j.chatId === nativeGoalChat(id)).sort((a, b) => a.id - b.id) : [];
  const giveNative = (goal: string) =>
    turn(async (signal) => {
      const id = (lastGoal = Math.max(Date.now(), lastGoal + 1));
      const answer = await atom(goal, `goal-${id}`, signal); // the chat "api-goal-<id>" (runtime.ts)
      return { goalId: nativeJobs(id).length ? id : null, answer };
    });
  const nativeGoal = (id: number) => {
    const s = team();
    const tasks = nativeJobs(id);
    if (!tasks.length) throw new ApiError(404, "There is no such goal.");
    const ended = tasks.every((t) => isFinal(t.state));
    const reports = ended ? tasks.flatMap((t) => s.report(t.id) ?? []) : [];
    const goal = options.said(nativeGoalChat(id)) ?? tasks[0]!.task;
    const ends = tasks.flatMap((t) => (t.endedAt ? [t.endedAt.getTime()] : []));
    const report: GoalReport | undefined = reports.length
      ? {
          title: reports.length === 1 ? reports[0]!.title : goal.slice(0, 80),
          summary: reports.map((r) => r.summary).filter(Boolean).join(" "),
          body: reports.map((r) => (reports.length === 1 ? r.body : `${r.title}\n\n${r.body}`)).join("\n\n"),
          sources: [...new Map(reports.flatMap((r) => r.sources).map((x) => [x.url, x])).values()],
        }
      : undefined;
    return {
      id,
      goal,
      status: ended ? "ended" : "running",
      createdAt: tasks[0]!.createdAt.toISOString(),
      ...(ended && ends.length ? { endedAt: new Date(Math.max(...ends)).toISOString() } : {}),
      ...(report ? { summary: report.summary, report } : {}),
      tasks: tasks.map(jobOut),
    };
  };
  const needs = () =>
    needsYou(store, approvals.pending()).map((need) => ({
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
      // The same path as a spoken or typed goal: ATOM reads it and hands it to one of its agents.
      run: (_p, body) => giveNative(text(body, "goal")),
    },
    {
      method: "GET",
      pattern: "/v1/goals/:id",
      match: /^\/v1\/goals\/([^/]+)$/,
      run: ([id]) => nativeGoal(wholeId(id)),
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
        // "api-goal-<id>" is a native goal's chat: a /v1/chat chatId never reaches it.
        if (typeof chatId === "string" && GOAL_CHAT_ID.test(chatId)) throw new ApiError(400, '"chatId" must not start with "goal-": goals have those chats.');
        return turn(async (signal) => ({ answer: await atom(said, chatId as string | undefined, signal) }));
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
        const jobs = s.list().flatMap((owner) => owner.jobs).filter((j) => state === null || j.state === state);
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
      pattern: "/v1/audit",
      match: /^\/v1\/audit$/,
      // The newest changes ATOM made (ids and states only, never task text), newest first.
      run: (_p, _b, query) => {
        const limit = Number(query.get("limit") ?? 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ApiError(400, '"limit" must be a whole number from 1 to 500.');
        return { entries: team().audit(limit).map((e) => ({ id: e.id, at: e.at.toISOString(), action: e.action, detail: e.detail })) };
      },
    },
    {
      method: "GET",
      pattern: "/v1/needs",
      match: /^\/v1\/needs$/,
      // A need the API may not answer shows with `answerable: false` and no actions, so a client does not offer a button it cannot press.
      run: () => ({
        needs: needs().map(({ actions, ...need }) => {
          const canAnswer = actions.every((a) => API_ANSWERABLE_KINDS.has(kindOf(a.data)));
          return { ...need, answerable: canAnswer, actions: canAnswer ? actions.map(({ data: _data, ...a }) => a) : [] };
        }),
      }),
    },
    {
      method: "POST",
      pattern: "/v1/needs/:key",
      match: /^\/v1\/needs\/([^/]+)$/,
      body: true,
      // The same actions as the Telegram buttons, by the button's word: allow, decline, approve, reject, accept, retry.
      run: ([raw], body) => {
        let key: string;
        try {
          key = decodeURIComponent(raw ?? "");
        } catch {
          throw new ApiError(400, "That is not a Needs you key."); // a broken percent-encoding is the client's mistake, not a 500
        }
        if (!NEED_KEY_PATTERN.test(key)) throw new ApiError(400, "That is not a Needs you key.");
        const action = text(body, "action").toLowerCase();
        const need = needs().find((n) => n.key === key);
        if (!need) throw new ApiError(404, "Nothing waits under that key now.");
        const button = need.actions.find((a) => a.action === action);
        if (!button) throw new ApiError(400, `"action" must be one of: ${need.actions.map((a) => a.action).join(", ") || "none (it has no actions)"}.`);
        if (!API_ANSWERABLE_KINDS.has(kindOf(button.data))) {
          throw new ApiError(403, "The Local API cannot answer this. Answer it in the ATOM window or on Telegram.");
        }
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
        // ADR-110 (N3): a main-agent turn in the routine's chat: no task (taskId null).
        if (!options.startRoutine) throw new ApiError(503, "Routines cannot be started now.");
        s.startRoutine(routineId, options.startRoutine);
        return { taskId: null };
      },
    },
  ];

  async function atom(said: string, chatId?: string, signal?: AbortSignal): Promise<string> {
    try {
      return await options.ask(said, chatId, signal);
    } catch (error) {
      if (error instanceof Error && error.name === "ChatBusy") throw new ApiError(409, error.message); // the window is answering in this chat
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
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify({ ok: error === null, data: error === null ? data : null, error }));
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now();
    // An address the URL parser rejects (a path of "//" does) used to throw here, before the token check and outside any try: the rejection
    // reached the app's crash handler and ended ATOM, with no token and from any web page that could reach 127.0.0.1 (code check, 2026-10-16).
    let url: URL | undefined;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      url = undefined;
    }
    const route = url ? routes.find((r) => r.method === req.method && r.match.test(url.pathname)) : undefined;
    let status = 200;
    try {
      // ADR-121: only this machine's names and the one private name in ATOM_API_HOST. A web page that makes a victim's browser reach
      // 127.0.0.1 under its own name (DNS rebinding) sends that name as Host, and is refused before anything else happens.
      if (!allowedHosts.has(hostName(req))) {
        status = 403;
        req.resume();
        return reply(res, status, null, "This address is not allowed. Use 127.0.0.1, or the name in ATOM_API_HOST.");
      }
      const file = req.method === "GET" && url ? PUBLIC_FILES[url.pathname] : undefined;
      if (file) {
        req.resume();
        res.writeHead(200, { "content-type": file.type, ...PAGE_HEADERS });
        return void res.end(file.body);
      }
      if (locked()) {
        status = 429;
        req.resume();
        return reply(res, status, null, "Too many wrong tokens. Wait a minute.");
      }
      if (!authorized(req)) {
        refused++;
        // Only a request that carries an Authorization header is a guess at the token. A page in the user's browser can send a plain GET to
        // 127.0.0.1 but cannot set that header without a preflight (which is refused), so such a page cannot lock the owner out.
        if (req.headers.authorization !== undefined) wrongAt.push(now());
        log.warn("api.unauthorized", { count: refused });
        status = 401;
        req.resume();
        return reply(res, status, null, "A valid token is needed: Authorization: Bearer <the token in data/api-token>.");
      }
      if (!url) {
        req.resume();
        status = 400;
        return reply(res, status, null, "That is not a valid address.");
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
      const next = createServer((req, res) => {
        // Whatever happens inside handle(), nothing may escape as an unhandled rejection: that ends the whole app.
        handle(req, res).catch(() => {
          try {
            res.destroy();
          } catch {
            // already gone
          }
        });
      });
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
    regenerate() {
      try {
        try {
          unlinkSync(tokenFile);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const token = readOrCreateToken(tokenFile);
        if (server) tokenDigest = digest(token); // a running server takes the new token on its next request
        log.info("api.token_regenerated", { running: Boolean(server) });
        return status(Boolean(server));
      } catch (error) {
        log.warn("api.regenerate_failed", { reason: "file" });
        return status(Boolean(server), describe(error));
      }
    },
    stop() {
      void this.set(false);
    },
  };
}
