import { createHash } from "node:crypto";
import type { ToolRunner } from "@atom/contracts";
import { ProviderError, emptyReplyReason, redactSecrets } from "../gateway.ts";
import {
  classify,
  isPlanMessage,
  loadSdk,
  planGuard,
  scrubbedEnv,
  sdkToolsFor,
  sdkVersion,
  sourcesFilter,
  tokensOf,
  withoutSources,
  type ClaudeSdk,
  type PlanUsage,
  type TokenMeta,
  type TokenUsage,
} from "./plan-support.ts";

/**
 * ADR-110 (Phase N1): one long-lived Claude Code session per open chat. The SDK `query` gets an input stream; each
 * turn is pushed into it, so the process, the system prompt and the tool list stay the same for the whole session
 * and later turns read them from the cache. The session closes after `idleMs` without a turn, but only while no
 * background task runs. It reopens with `resume` and the session id that the caller keeps.
 */

/** The SDK parts a session uses (lets tests supply a fake). */
export interface SessionSdk extends Pick<ClaudeSdk, "tool" | "createSdkMcpServer"> {
  query(args: { prompt: AsyncIterable<Record<string, unknown>>; options: Record<string, unknown> }): AsyncIterable<Record<string, any>> & {
    interrupt?(): Promise<unknown>;
    setModel?(model?: string): Promise<void>;
    stopTask?(taskId: string): Promise<void>;
    close?(): void;
  };
}

/** The main-thread agent of every session. Its tool list limits what the model sees. */
export const MAIN_AGENT = "atom";
/** The one in-process MCP server that holds every ATOM tool. */
export const TOOL_SERVER = "atom";
/** Claude Code's tool search: loads a deferred tool's schema when the model asks for it. */
export const TOOL_SEARCH = "ToolSearch";
export const DEFAULT_SESSION_IDLE_MS = 10 * 60_000;
/** After Stop, how long the session waits for Claude Code to end the turn before it closes the process. */
const INTERRUPT_GRACE_MS = 3000;
const DEFAULT_MAX_TURNS = 12;

/** ADR-110: environment flags for every session, on top of the scrubbed environment. */
export const SESSION_ENV: Record<string, string> = {
  ENABLE_TOOL_SEARCH: "force",
  ENABLE_PROMPT_CACHING_1H: "1",
  CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: "5m",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: "1",
  CLAUDE_CODE_DISABLE_CRON: "1",
};

/** The permission gate of the main thread (see apps/mac native-safety.ts). */
export interface SessionGate {
  canUseTool: (name: string, input: Record<string, unknown>, extra?: { toolUseID?: string; agentID?: string }) => Promise<Record<string, unknown>>;
  hooks: Record<string, unknown>;
}

export interface ChatSessionOptions {
  chatId: string;
  claudePath: string;
  model: string;
  /** Byte-stable for the session: who ATOM is and how it works. Dynamic context goes in the user message. */
  systemPrompt: string;
  /** Claude Code's own tools for the main thread (e.g. WebSearch, or Read, Glob, Grep in a project chat). */
  tools: readonly string[];
  gate: SessionGate;
  /** ATOM's tools, all in the one `atom` server, deferred behind tool search. */
  atomTools?: ToolRunner;
  /**
   * Phase N2: the chat's sub-agents (Claude Code AgentDefinitions by name). Claude Code lists them to the model in an
   * agent_listing_delta message, not in the system prompt, so they do not change the cached prefix.
   */
  agents?: Record<string, unknown>;
  /** Phase N2: deny rules, e.g. `Agent(general-purpose)`: Claude Code's built-in agents leave the agent listing. */
  disallowedTools?: string[];
  /** Phase N2: Claude Code's Bash sandbox (a project chat's sub-agents). */
  sandbox?: Record<string, unknown>;
  /** Phase N2: local plugins (the sub-agents' skills). The main thread loads no skill. */
  plugins?: { type: "local"; path: string }[];
  cwd?: string;
  /** A Claude Code session id to continue. */
  resume?: string;
  env?: Record<string, string | undefined>;
  idleMs?: number;
  maxTurns?: number;
  sdk?: SessionSdk;
  onUsage?: (usage: PlanUsage) => void;
  onTokens?: (tokens: TokenUsage, model: string, meta?: TokenMeta) => void;
  /** A reply Claude Code gave with no turn of ATOM's waiting: it woke itself, e.g. when a background agent finished. */
  onUnprompted?: (text: string) => void;
  /** Called once when the session has closed (idle, error or `close`). */
  onClose?: (reason: string) => void;
  /** Names and numbers only, never text. */
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface SendOptions {
  /** Deliver the text as written: no `@path` expansion, no slash commands. */
  clientComposed?: boolean;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}

export interface ChatSessionHandle {
  readonly chatId: string;
  readonly model: string;
  readonly closed: boolean;
  /** Claude Code's session id, once known. */
  readonly sessionId: string | undefined;
  /** Short hash of the system prompt and the tool names: the same value means the same cached prefix. */
  readonly prefix: string;
  /** Background tasks (sub-agents, commands) that run now. */
  readonly background: number;
  /** Stops one background task (a sub-agent) by Claude Code's task id. */
  stopTask(taskId: string): Promise<void>;
  send(text: string, options?: SendOptions): Promise<{ text: string; sessionId?: string }>;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  close(reason?: string): void;
  /** Every SDK message of the session. Returns a function that stops listening. */
  onEvent(listener: (message: Record<string, any>) => void): () => void;
}

/** A short hash of what the session's prefix is made of. Logged at each open: a changed value explains a cache write. */
export function prefixHash(systemPrompt: string, toolNames: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([systemPrompt, toolNames])).digest("hex").slice(0, 12);
}

/** The input stream of a session: messages wait in a queue until Claude Code reads them. */
function inputQueue() {
  const queue: Record<string, unknown>[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  async function* messages() {
    for (;;) {
      for (let next = queue.shift(); next; next = queue.shift()) yield next;
      if (ended) return;
      await new Promise<void>((resolve) => (wake = resolve));
      wake = undefined;
    }
  }
  return {
    messages: messages(),
    push(message: Record<string, unknown>) {
      queue.push(message);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
  };
}

/** ADR-110: Claude Code's options for one chat session. Exported for the options test. */
export function sessionOptions(sdk: SessionSdk, o: ChatSessionOptions, controller: AbortController, toolSignal: () => AbortSignal): Record<string, unknown> {
  const specs = o.atomTools?.specs() ?? [];
  const atomNames = specs.map((s) => `mcp__${TOOL_SERVER}__${s.name}`);
  return {
    model: o.model,
    pathToClaudeCodeExecutable: o.claudePath,
    ...(o.cwd ? { cwd: o.cwd } : {}),
    systemPrompt: o.systemPrompt,
    // The main thread runs as the `atom` agent: only its tools reach the model.
    agent: MAIN_AGENT,
    // ToolSearch must be listed: without it Claude Code cannot defer the ATOM tools and sends every schema.
    agents: { ...(o.agents ?? {}), [MAIN_AGENT]: { description: "ATOM, the user's assistant.", prompt: o.systemPrompt, tools: [...o.tools, TOOL_SEARCH, ...atomNames] } },
    tools: [...o.tools, TOOL_SEARCH],
    ...(specs.length
      ? { mcpServers: { [TOOL_SERVER]: sdk.createSdkMcpServer({ name: TOOL_SERVER, version: "1.0.0", tools: sdkToolsFor(sdk, specs, o.atomTools!, toolSignal) }) } }
      : {}),
    // Nothing is allowed without the gate: every call goes through canUseTool and the PreToolUse hook.
    ...(o.sandbox ? { sandbox: o.sandbox } : {}),
    ...(o.plugins?.length ? { plugins: o.plugins, skills: [] } : {}),
    allowedTools: [],
    ...(o.disallowedTools?.length ? { disallowedTools: o.disallowedTools } : {}),
    canUseTool: o.gate.canUseTool,
    hooks: o.gate.hooks,
    settingSources: [],
    strictMcpConfig: true,
    // Explicit: when it is left out, Claude Code's 'auto' classifier approves tool calls.
    permissionMode: "default",
    persistSession: true,
    // A fixed title: otherwise a new session spends an extra model call (~1.2k tokens) to name itself.
    title: `ATOM chat ${o.chatId}`,
    ...(o.resume ? { resume: o.resume } : {}),
    maxTurns: o.maxTurns ?? DEFAULT_MAX_TURNS,
    thinking: { type: "disabled" },
    abortController: controller,
    env: { ...scrubbedEnv(o.env ?? process.env), ...SESSION_ENV },
    includePartialMessages: true,
  };
}

interface Turn {
  resolve: (value: { text: string; sessionId?: string }) => void;
  reject: (error: unknown) => void;
  filter?: ReturnType<typeof sourcesFilter>;
  wrote: boolean;
  acted: boolean;
  lastError?: string;
  cancelled: boolean;
  grace?: ReturnType<typeof setTimeout>;
  /** Results that belong to a turn Claude Code started by itself before this one was sent. */
  skip: number;
}

export async function openChatSession(o: ChatSessionOptions): Promise<ChatSessionHandle> {
  if (!o.claudePath) throw new ProviderError("auth", "Claude Code was not found. Install it, then run `claude auth login` in a terminal.");
  const sdk = o.sdk ?? ((await loadSdk()) as unknown as SessionSdk);
  const controller = new AbortController();
  const input = inputQueue();
  const listeners = new Set<(message: Record<string, any>) => void>();
  const idleMs = o.idleMs ?? DEFAULT_SESSION_IDLE_MS;
  let model = o.model;
  let turn: Turn | undefined;
  let turnSignal: AbortSignal | undefined;
  let sessionId = o.resume;
  let background = 0;
  /** Claude Code runs a turn of its own (a background task woke it). */
  let selfTurn = false;
  let costSoFar = 0;
  let closed = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const log = (event: string, fields: Record<string, unknown>) => {
    try {
      o.log?.(event, { chatId: o.chatId, ...fields });
    } catch {
      // the log is a help, never a reason to fail a turn
    }
  };

  const options = sessionOptions(sdk, o, controller, () => turnSignal ?? controller.signal);
  const toolNames = [...o.tools, ...(o.atomTools?.specs() ?? []).map((s) => s.name)];
  const prefix = prefixHash(o.systemPrompt, toolNames);
  log("session.open", { sdk: sdkVersion(), prefix, model, resume: Boolean(o.resume), tools: toolNames.length });
  const q = sdk.query({ prompt: input.messages, options });

  const end = (t: Turn, outcome: { text: string; sessionId?: string } | { error: unknown }) => {
    clearTimeout(t.grace);
    if (turn === t) turn = undefined;
    turnSignal = undefined;
    try {
      t.filter?.flush();
    } catch {
      // as in the plan adapter: early speech never fails a turn
    }
    if ("error" in outcome) t.reject(outcome.error);
    else t.resolve(outcome);
    armIdle();
  };

  const armIdle = () => {
    clearTimeout(idle);
    if (closed || turn) return;
    idle = setTimeout(() => {
      // Background work holds the session open; the next change of the task list starts the wait again.
      if (background === 0 && !turn && !selfTurn) close("idle");
    }, idleMs);
    idle.unref?.();
  };

  const count = (result: Record<string, any>) => {
    if (typeof result.session_id === "string") sessionId = result.session_id;
    // `usage` is this turn's; `total_cost_usd` counts from the process start, so the turn's cost is the difference.
    const tokens = tokensOf(result);
    const total = typeof result.total_cost_usd === "number" ? result.total_cost_usd : undefined;
    const cost = total !== undefined ? total - costSoFar : undefined;
    if (total !== undefined) costSoFar = total;
    if (tokens) {
      const { costUsd: _, ...rest } = tokens;
      o.onTokens?.(cost && cost > 0 ? { ...rest, costUsd: cost } : rest, model, { chatId: o.chatId });
    }
  };

  /** A turn Claude Code ran by itself: its reply goes to `onUnprompted`. */
  const unprompted = (result: Record<string, any>) => {
    selfTurn = false;
    count(result);
    const text = result.subtype === "success" && !result.is_error && typeof result.result === "string" ? withoutSources(result.result.trim()) : "";
    log("session.unprompted", { ok: Boolean(text) });
    if (text) {
      try {
        o.onUnprompted?.(text);
      } catch {
        // the owner's bookkeeping never stops the session
      }
    }
    armIdle();
  };

  const finish = (t: Turn, result: Record<string, any>) => {
    count(result);
    if (t.cancelled) return end(t, { error: new ProviderError("cancelled", "Request cancelled") });
    if (result.subtype === "error_max_turns") return end(t, { error: new ProviderError("bad_request", "Claude used too many steps on this request and stopped.") });
    if (result.is_error || result.subtype !== "success") {
      const { kind, message } = classify(t.lastError, t.acted);
      return end(t, { error: new ProviderError(kind, message) });
    }
    const text = typeof result.result === "string" ? withoutSources(result.result.trim()) : "";
    if (!text) return end(t, { error: new ProviderError("unknown", emptyReplyReason(result.stop_reason)) });
    end(t, { text, ...(sessionId ? { sessionId } : {}) });
  };

  function close(reason = "closed") {
    if (closed) return;
    closed = true;
    clearTimeout(idle);
    input.end();
    controller.abort();
    try {
      q.close?.();
    } catch {
      // already ended
    }
    if (turn) end(turn, { error: turn.cancelled ? new ProviderError("cancelled", "Request cancelled") : new ProviderError("unavailable", "Claude Code ended the session.") });
    log("session.close", { reason });
    try {
      o.onClose?.(reason);
    } catch {
      // the owner's bookkeeping never blocks a close
    }
  }

  void (async () => {
    try {
      for await (const message of q) {
        for (const listener of listeners) {
          try {
            listener(message);
          } catch {
            // a listener never stops the session
          }
        }
        const t = turn;
        if (isPlanMessage(message)) {
          if (message.type === "system" && typeof message.session_id === "string") sessionId = message.session_id;
          planGuard(message, o.onUsage);
        } else if (message.type === "system" && message.subtype === "background_tasks_changed") {
          background = Array.isArray(message.tasks) ? message.tasks.filter((x: Record<string, unknown>) => !x?.ambient).length : 0;
          armIdle();
        } else if (!t || t.skip > 0) {
          if (message.type === "result") {
            if (t) t.skip -= 1;
            unprompted(message);
          } else if (!message.parent_tool_use_id && (message.type === "assistant" || message.type === "stream_event")) {
            selfTurn = true;
            clearTimeout(idle);
          }
          continue;
        } else if (message.type === "stream_event") {
          if (message.parent_tool_use_id) continue;
          const event = message.event ?? {};
          try {
            if (event.type === "message_start" && t.wrote) t.filter?.push("\n"); // a new model turn starts a new sentence
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
              t.wrote = true;
              t.filter?.push(event.delta.text);
            }
          } catch {
            // speaking early is a help, never a reason to fail the turn
          }
        } else if (message.type === "assistant") {
          if (typeof message.error === "string") t.lastError = message.error;
          if (!message.parent_tool_use_id && Array.isArray(message.message?.content) && message.message.content.some((b: Record<string, unknown>) => b?.type === "tool_use")) t.acted = true;
        } else if (message.type === "result") {
          finish(t, message);
        }
      }
      close("ended");
    } catch (error) {
      if (turn && !(error instanceof ProviderError)) {
        const text = error instanceof Error ? error.message : String(error);
        end(turn, { error: new ProviderError(turn.acted ? "unknown" : "unavailable", redactSecrets(`Claude Code could not run: ${text}`)) });
      } else if (turn) {
        end(turn, { error });
      }
      close(error instanceof ProviderError ? error.kind : "error");
    }
  })();

  return {
    chatId: o.chatId,
    get model() {
      return model;
    },
    get closed() {
      return closed;
    },
    get sessionId() {
      return sessionId;
    },
    prefix,
    get background() {
      return background;
    },
    async stopTask(taskId) {
      await q.stopTask?.(taskId);
    },
    send(text, so = {}) {
      if (closed) return Promise.reject(new ProviderError("unavailable", "The chat session is closed."));
      if (turn) return Promise.reject(new ProviderError("bad_request", "Still answering the previous request"));
      if (so.signal?.aborted) return Promise.reject(new ProviderError("cancelled", "Request cancelled"));
      clearTimeout(idle);
      return new Promise((resolve, reject) => {
        // Claude Code is in a turn of its own: its result comes first, then this one's.
        const t: Turn = { resolve, reject, wrote: false, acted: false, cancelled: false, skip: selfTurn ? 1 : 0, ...(so.onText ? { filter: sourcesFilter(so.onText) } : {}) };
        turn = t;
        turnSignal = so.signal;
        // Stop = interrupt: the process stays; the turn ends when Claude Code reports it, or the session closes.
        so.signal?.addEventListener(
          "abort",
          () => {
            if (turn !== t) return;
            t.cancelled = true;
            q.interrupt?.().catch(() => {});
            t.grace = setTimeout(() => close("interrupt_timeout"), INTERRUPT_GRACE_MS);
            t.grace.unref?.();
          },
          { once: true },
        );
        input.push({
          type: "user",
          message: { role: "user", content: text },
          parent_tool_use_id: null,
          ...(so.clientComposed ? { client_composed: true } : {}),
        });
      });
    },
    async interrupt() {
      await q.interrupt?.();
    },
    async setModel(next) {
      if (next === model) return;
      await q.setModel?.(next);
      model = next;
    },
    close,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
