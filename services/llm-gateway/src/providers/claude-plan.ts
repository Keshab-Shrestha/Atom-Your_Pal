import { randomUUID } from "node:crypto";
import { z, type ZodType } from "zod";
import type { Message, ModelRequest, ModelResponse, ToolRunner, ToolSpec } from "@zeno/contracts";
import { emptyReplyReason, ProviderError, redactSecrets, type ErrorKind, type ProviderAdapter } from "../gateway.ts";

/**
 * Claude on the user's own Claude plan (Pro or Max), through the Claude Agent SDK.
 *
 * The SDK starts the user's own, unmodified `claude` program, which is signed in with their claude.ai account. ZENO never
 * reads, stores or sends that login: it only runs the program. This is for one person on their own Mac; Anthropic does not
 * allow an app to offer plan sign-in to other people.
 *
 * Money rule: this provider must never fall back to per-token billing. The program is started with no ANTHROPIC_* variables
 * (see scrubbedEnv), and each run is stopped at once if it reports an API key as its credential or if it starts charging
 * "extra usage" beyond the plan.
 *
 * Unlike the other providers, Claude Code runs the whole tool loop here: ZENO's tools are given to it as an in-process
 * server whose calls go straight back to ZENO's own tool engine, so approvals and safety rules are unchanged. The Core
 * therefore gets back plain text and no tool calls.
 */

/** The parts of the SDK this adapter uses (lets tests supply a fake). Loaded only when first needed. */
export interface ClaudeSdk {
  query(args: { prompt: string; options: Record<string, unknown> }): AsyncIterable<Record<string, any>>;
  tool(
    name: string,
    description: string,
    shape: Record<string, ZodType>,
    handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError?: boolean }>,
  ): unknown;
  createSdkMcpServer(options: { name: string; version?: string; tools: unknown[] }): unknown;
  /** Pre-starts a Claude Code process (ADR-064). Older SDKs and test fakes may not have it. */
  startup?(params: { options: Record<string, unknown>; initializeTimeoutMs?: number }): Promise<WarmQueryLike>;
}

/** A pre-started Claude Code process: one prompt, then it is used up. */
export interface WarmQueryLike {
  query(prompt: string): AsyncIterable<Record<string, any>>;
  close(): void;
}

/** How much of the plan is used, as fractions (0.66 = 66%). For the log: shows plan use, never a key. */
export interface PlanUsage {
  fiveHour?: number;
  sevenDay?: number;
  /** True if Claude is charging extra usage beyond the plan (this adapter stops before that happens). */
  overage?: boolean;
}

export interface ClaudePlanOptions {
  /** Full path of the signed-in `claude` program. */
  claudePath: string;
  model: string;
  /** Runs ZENO's tools when Claude Code asks for one. Without it Claude gets no tools. */
  tools?: ToolRunner;
  /** Most Claude Code turns in one request; each tool call takes one. */
  maxTurns?: number;
  onUsage?: (usage: PlanUsage) => void;
  sdk?: ClaudeSdk;
  /** The environment to start from. Default: this process's. */
  env?: Record<string, string | undefined>;
  /**
   * How long after an answer the next process is pre-started (default 3 s). Starting it costs about a second of CPU,
   * which would otherwise slow the synthesis of the answer's first spoken sentence.
   */
  prewarmDelayMs?: number;
}

const SERVER = "zeno";
const DEFAULT_MAX_TURNS = 12;
/** The only credentials that mean "the user's plan". Anything else could be billed per token. */
const PLAN_CREDENTIALS = new Set(["none", "oauth"]);

/**
 * The environment for Claude Code: everything except variables that could switch it to an API key, another login
 * or a cloud provider, and except other providers' keys (it has no use for them).
 */
export function scrubbedEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (/^ANTHROPIC_/.test(key)) continue;
    if (/^CLAUDE_CODE_(OAUTH|USE_|SKIP_)/.test(key) || key === "CLAUDE_CODE_API_KEY_HELPER_TTL_MS") continue;
    if (/^(GEMINI|GOOGLE|OPENAI|AWS)_/.test(key)) continue;
    out[key] = value;
  }
  return out;
}

async function loadSdk(): Promise<ClaudeSdk> {
  return (await import("@anthropic-ai/claude-agent-sdk")) as unknown as ClaudeSdk;
}

/** One tool input property as a Zod type, so Claude sees the same argument names and types as the other providers do. */
function zodFor(property: { type: string; description?: string }, required: boolean): ZodType {
  let type: ZodType;
  switch (property.type) {
    case "string":
      type = z.string();
      break;
    case "number":
    case "integer":
      type = z.number();
      break;
    case "boolean":
      type = z.boolean();
      break;
    case "array":
      type = z.array(z.unknown());
      break;
    case "object":
      type = z.record(z.string(), z.unknown());
      break;
    default:
      type = z.unknown();
  }
  if (property.description) type = type.describe(property.description);
  return required ? type : type.optional();
}

function shapeOf(spec: ToolSpec): Record<string, ZodType> {
  const required = new Set(spec.inputSchema.required ?? []);
  return Object.fromEntries(Object.entries(spec.inputSchema.properties ?? {}).map(([name, p]) => [name, zodFor(p, required.has(name))]));
}

/** The conversation as one prompt: earlier turns as a transcript, then the newest message as the question. */
function promptFrom(messages: Message[]): string {
  const turns = messages.filter((m) => m.content.trim());
  const last = turns.at(-1)?.content.trim() ?? "";
  if (turns.length <= 1) return last;
  const earlier = turns
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "ZENO"}: ${m.content.trim()}`)
    .join("\n");
  return `Conversation so far:\n${earlier}\n\nThe user now says:\n${last}`;
}

const resetTime = (seconds?: number) =>
  seconds ? ` It resets at ${new Date(seconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : "";

/** What Claude Code said went wrong, in provider-independent terms. `acted` = a tool has already changed something. */
function classify(code: string | undefined, acted: boolean): { kind: ErrorKind; message: string } {
  const retryable = (kind: ErrorKind): ErrorKind => (acted && (kind === "unavailable" || kind === "rate_limit") ? "unknown" : kind);
  switch (code) {
    case "authentication_failed":
      return { kind: "auth", message: "Claude Code is not signed in. Run `claude auth login` in a terminal, then try again." };
    case "oauth_org_not_allowed":
    case "account_on_hold":
    case "verification_required":
    case "cloud_credential_error":
      return { kind: "auth", message: `Claude Code could not use this account (${code}). Check claude.ai, then try again.` };
    case "billing_error":
      return { kind: "bad_request", message: "Claude could not use your plan (billing error). Check your Claude plan on claude.ai." };
    case "rate_limit":
      return { kind: retryable("rate_limit"), message: "Your Claude plan is being rate limited. Try again in a moment." };
    case "overloaded":
    case "server_error":
      return { kind: retryable("unavailable"), message: "Claude is busy or had a server error. Try again in a moment." };
    case "invalid_request":
    case "model_not_found":
      return { kind: "bad_request", message: `Claude rejected the request (${code}).` };
    case "max_output_tokens":
      return { kind: "bad_request", message: "The reply was cut off. Try asking for a shorter answer." };
    default:
      return { kind: "unknown", message: `Claude Code stopped with an error${code ? ` (${code})` : ""}.` };
  }
}

const SOURCES = /\n\s*(?:\*\*)?sources:?(?:\*\*)?\s*(?:\n|$)/i;

/** Claude Code's web search ends replies with a "Sources:" list of links: never spoken, never shown (ADR-069). */
export function withoutSources(text: string): string {
  const at = `\n${text}`.search(SOURCES);
  return at < 0 ? text : text.slice(0, Math.max(0, at - 1)).trimEnd();
}

/**
 * Passes streamed text on, but stops at a "Sources:" list. Text after the last line break is held back while it
 * could still turn out to be "Sources:". `flush` passes on what was held, at the end.
 */
export function sourcesFilter(onText: (delta: string) => void) {
  let all = "";
  let sent = 0;
  let stopped = false;
  const forward = (upTo: number) => {
    if (upTo > sent) onText(all.slice(sent, upTo));
    sent = Math.max(sent, upTo);
  };
  return {
    push(delta: string) {
      if (stopped) return;
      all += delta;
      const found = `\n${all}`.search(SOURCES);
      if (found >= 0) {
        stopped = true;
        forward(Math.max(0, found - 1));
        return;
      }
      const lastBreak = all.lastIndexOf("\n");
      if (lastBreak >= 0) {
        const tail = all.slice(lastBreak + 1).trim().replace(/\*/g, "").toLowerCase();
        if (tail.length < 9 && "sources:".startsWith(tail)) return forward(lastBreak);
      }
      forward(all.length);
    },
    flush() {
      if (!stopped) forward(all.length);
    },
  };
}

/** What a pre-started Claude Code process was started for: requests must match it exactly to use it. */
function keyOf(system: string, specs: ToolSpec[]): string {
  return JSON.stringify([system, specs.map((s) => [s.name, s.description, s.inputSchema])]);
}

/** The newest message, with this request's additions (memory, the time) in front, marked as not said by the user. */
function promptWith(extra: string | undefined, messages: Message[]): string {
  const prompt = promptFrom(messages);
  if (!extra?.trim()) return prompt;
  return `Context for this request, from ZENO (not said by the user):\n${extra.trim()}\n\n${prompt}`;
}

/** One request's link to the tools: set when a pre-started process is put to use. */
interface RunState {
  signal?: AbortSignal;
  acted: boolean;
}

interface Prepared {
  key: string;
  state: RunState;
  controller: AbortController;
  warm: Promise<WarmQueryLike>;
  /** Set if starting failed: the slot is unusable. */
  failed: boolean;
}

export function createClaudePlanAdapter(options: ClaudePlanOptions): ProviderAdapter {
  const { claudePath, model, tools, maxTurns = DEFAULT_MAX_TURNS, onUsage } = options;
  const env = options.env ?? process.env;
  let sdkPromise: Promise<ClaudeSdk> | undefined;
  let prepared: Prepared | undefined;
  /** What ZENO asked to keep ready (its main instructions and tools). Other requests, like conversation notes, never replace it. */
  let primary: { system: string; specs: ToolSpec[] } | undefined;
  let closed = false;
  let later: ReturnType<typeof setTimeout> | undefined;
  const prewarmDelayMs = options.prewarmDelayMs ?? 3000;
  const getSdk = async () => options.sdk ?? (await (sdkPromise ??= loadSdk()));

  /** Claude Code's options for one process. Tool calls go to whichever request `state` belongs to at the time. */
  // ADR-069: Claude Code's own web search, for news, scores, prices and anything else current. ZENO_WEB=0 turns it off.
  const webAllowed = env.ZENO_WEB !== "0";
  function queryOptions(sdk: ClaudeSdk, system: string, specs: ToolSpec[], state: RunState, controller: AbortController) {
    // Only with ZENO's tools: requests without them (the out-of-steps wrap-up, conversation notes) get nothing.
    const web = webAllowed && specs.length > 0;
    const sdkTools = specs.map((spec) =>
      sdk.tool(spec.name, spec.description, shapeOf(spec), async (input) => {
        state.acted = true;
        const result = await tools!.run({ id: randomUUID(), name: spec.name, input }, state.signal ?? controller.signal);
        // ADR-080: a screenshot goes after the words as MCP image content, which Claude Code shows the model.
        const images = (result.images ?? []).map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }));
        return { content: [{ type: "text" as const, text: result.content }, ...images], ...(result.isError ? { isError: true } : {}) };
      }),
    );
    return {
      model,
      systemPrompt: system,
      pathToClaudeCodeExecutable: claudePath,
      // Nothing from Claude Code itself: no built-in tools, no user settings, and not the account's claude.ai connectors
      // (they would add tens of thousands of tokens to every request and let Claude reach into other services).
      tools: web ? ["WebSearch"] : [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      permissionMode: "default",
      maxTurns: specs.length ? maxTurns : 1,
      // Spoken answers to everyday questions: thinking adds ~1 s per model turn for nothing a listener notices.
      // ZENO_THINKING=1 turns it back on (Claude decides how much).
      thinking: env.ZENO_THINKING === "1" ? { type: "adaptive" } : { type: "disabled" },
      abortController: controller,
      env: scrubbedEnv(env),
      includePartialMessages: true, // text as it is written, so ZENO can start speaking (ADR-065)
      ...(specs.length
        ? {
            mcpServers: { [SERVER]: sdk.createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: sdkTools }) },
            allowedTools: [...specs.map((s) => `mcp__${SERVER}__${s.name}`), ...(web ? ["WebSearch"] : [])],
          }
        : {}),
    } as Record<string, unknown>;
  }

  /** ADR-064: start the next Claude Code process now, so the next request skips its ~1 s start. */
  function prepare(system: string, specs: ToolSpec[]) {
    if (closed || !claudePath || env.ZENO_PREWARM === "0") return;
    const key = keyOf(system, specs);
    if (prepared && prepared.key === key && !prepared.failed) return;
    discard();
    const slot: Prepared = { key, state: { acted: false }, controller: new AbortController(), failed: false, warm: undefined as never };
    slot.warm = getSdk().then((sdk) => {
      if (!sdk.startup) throw new Error("this Claude Agent SDK cannot pre-start");
      return sdk.startup({ options: queryOptions(sdk, system, specs, slot.state, slot.controller), initializeTimeoutMs: 20_000 });
    });
    slot.warm.catch(() => {
      slot.failed = true;
    });
    prepared = slot;
  }

  function discard() {
    const old = prepared;
    prepared = undefined;
    if (!old) return;
    old.controller.abort();
    old.warm.then((w) => w.close(), () => {});
  }

  /** The prepared process, if it was started for exactly this request. A different request leaves it for the next one. */
  function take(key: string): Prepared | undefined {
    const slot = prepared;
    if (!slot || slot.failed || slot.key !== key) return undefined;
    prepared = undefined;
    return slot;
  }

  async function run(
    messages: AsyncIterable<Record<string, any>>,
    state: RunState,
    signal: AbortSignal,
    onText?: (delta: string) => void,
  ): Promise<{ result?: Record<string, any>; lastError?: string }> {
    let lastError: string | undefined;
    let result: Record<string, any> | undefined;
    let wrote = false;
    const filter = onText ? sourcesFilter(onText) : undefined;
    try {
    for await (const message of messages) {
      if (signal.aborted) break;
      if (message.type === "stream_event") {
        const event = message.event ?? {};
        if (message.parent_tool_use_id) continue;
        try {
          if (event.type === "message_start" && wrote) filter?.push("\n"); // a new turn starts a new sentence
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
            wrote = true;
            filter?.push(event.delta.text);
          }
        } catch {
          // speaking early is a help, never a reason to fail the request
        }
      } else if (message.type === "system" && message.subtype === "init") {
        const source = String(message.apiKeySource ?? "");
        if (!PLAN_CREDENTIALS.has(source)) {
          throw new ProviderError(
            "auth",
            `Claude Code is using an API key (${source || "unknown"}), which bills per token, so ZENO stopped. Remove the key from Claude Code or use the Claude (API) provider on purpose.`,
          );
        }
      } else if (message.type === "rate_limit_event") {
        const info = message.rate_limit_info ?? {};
        if (onUsage) {
          const windows = info.unifiedWindows ?? {};
          onUsage({
            ...(typeof windows.five_hour?.utilization === "number" ? { fiveHour: windows.five_hour.utilization } : {}),
            ...(typeof windows.seven_day?.utilization === "number" ? { sevenDay: windows.seven_day.utilization } : {}),
            ...(typeof info.isUsingOverage === "boolean" ? { overage: info.isUsingOverage } : {}),
          });
        }
        if (info.isUsingOverage === true) {
          throw new ProviderError("rate_limit", "Your Claude plan is used up and Claude would charge extra usage, so ZENO stopped. Switch model or wait for the plan to reset.");
        }
        if (info.status === "rejected") {
          throw new ProviderError("rate_limit", `Your Claude plan limit is reached.${resetTime(info.resetsAt)}`);
        }
      } else if (message.type === "assistant" && typeof message.error === "string") {
        lastError = message.error;
      } else if (message.type === "result") {
        result = message;
      }
    }
    } finally {
      try {
        filter?.flush();
      } catch {
        // as above
      }
    }
    void state;
    return { result, lastError };
  }

  return {
    name: "claude-plan",
    prepare(request) {
      primary = { system: request.system, specs: tools && request.tools?.length ? request.tools : [] };
      prepare(primary.system, primary.specs);
    },
    close() {
      closed = true;
      clearTimeout(later);
      discard();
    },
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      if (signal.aborted) throw new ProviderError("cancelled", "Request cancelled");
      if (!claudePath) {
        throw new ProviderError("auth", "Claude Code was not found. Install it, then run `claude auth login` in a terminal.");
      }
      const sdk = await getSdk();
      // Offer ZENO's tools, if there are any to offer and a way to run them.
      const specs = tools && request.tools?.length ? request.tools : [];
      const prompt = promptWith(request.systemExtra, request.messages);
      const key = keyOf(request.system, specs);
      let streamed = false;
      const listener = request.onText;
      if (listener) request = { ...request, onText: (d) => ((streamed = true), listener(d)) };

      const attempt = async (slot: Prepared | undefined) => {
        const state: RunState = slot?.state ?? { acted: false };
        const controller = slot?.controller ?? new AbortController();
        state.signal = signal;
        const onAbort = () => controller.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          const messages = slot
            ? (await slot.warm).query(prompt)
            : sdk.query({ prompt, options: queryOptions(sdk, request.system, specs, state, controller) });
          return { ...(await run(messages, state, signal, request.onText)), acted: state.acted };
        } catch (error) {
          if (signal.aborted) throw new ProviderError("cancelled", "Request cancelled");
          if (error instanceof ProviderError) throw error;
          const text = error instanceof Error ? error.message : String(error);
          throw new ProviderError(state.acted ? "unknown" : "unavailable", redactSecrets(`Claude Code could not run: ${text}`));
        } finally {
          signal.removeEventListener("abort", onAbort);
          controller.abort(); // stops the claude program, whether the request finished, failed or was cancelled
        }
      };

      let outcome: Awaited<ReturnType<typeof attempt>>;
      try {
        const slot = take(key);
        try {
          outcome = await attempt(slot);
        } catch (error) {
          // A pre-started process that broke before doing anything: try once more the ordinary way.
          if (!slot || signal.aborted || streamed || !(error instanceof ProviderError) || error.kind !== "unavailable") throw error;
          outcome = await attempt(undefined);
        }
        if (slot && !outcome.result && !outcome.acted && !streamed && !signal.aborted) outcome = await attempt(undefined);
      } finally {
        // Ready for ZENO's next request, once the answer has started being spoken.
        const next = primary ?? { system: request.system, specs };
        clearTimeout(later);
        later = setTimeout(() => prepare(next.system, next.specs), prewarmDelayMs);
        later.unref?.();
      }

      const { result, lastError, acted } = outcome;
      if (signal.aborted) throw new ProviderError("cancelled", "Request cancelled");
      if (!result) {
        const { kind, message } = classify(lastError, acted);
        throw new ProviderError(kind, lastError ? message : "Claude Code ended without an answer.");
      }
      if (result.subtype === "error_max_turns") {
        throw new ProviderError("bad_request", "Claude used too many steps on this request and stopped.");
      }
      if (result.is_error || result.subtype !== "success") {
        const { kind, message } = classify(lastError, acted);
        throw new ProviderError(kind, message);
      }
      const text = typeof result.result === "string" ? withoutSources(result.result.trim()) : "";
      if (!text) throw new ProviderError("unknown", emptyReplyReason("claude-plan", "none"));
      return { text };
    },
  };
}
