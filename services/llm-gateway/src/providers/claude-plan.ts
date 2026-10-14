import { randomUUID } from "node:crypto";
import type { Message, ModelRequest, ModelResponse, ProjectFiles, ToolRunner, ToolSpec } from "@atom/contracts";
import { readEnv } from "@atom/shared";
import { emptyReplyReason, ProviderError, redactSecrets, type ProviderAdapter } from "../gateway.ts";
import {
  answerTail,
  classify,
  isPlanMessage,
  loadSdk,
  MAX_PROJECT_FILE_CALLS,
  planGuard,
  promptFrom,
  scrubbedEnv,
  sdkToolsFor,
  sourcesFilter,
  tokensOf,
  withoutSources,
  type ChatSessions,
  type ClaudeSdk,
  type PlanUsage,
  type TokenMeta,
  type TokenUsage,
  type WarmQueryLike,
} from "./plan-support.ts";

/**
 * Claude on the user's own Claude plan (Pro or Max), through the Claude Agent SDK.
 *
 * The SDK starts the user's own, unmodified `claude` program, which is signed in with their claude.ai account. ATOM never
 * reads, stores or sends that login: it only runs the program. This is for one person on their own Mac; Anthropic does not
 * allow an app to offer plan sign-in to other people.
 *
 * Money rule: this provider must never fall back to per-token billing. The program is started with no ANTHROPIC_* variables
 * (see scrubbedEnv), and each run is stopped at once if it reports an API key as its credential or if it starts charging
 * "extra usage" beyond the plan.
 *
 * Unlike the other providers, Claude Code runs the whole tool loop here: ATOM's tools are given to it as an in-process
 * server whose calls go straight back to ATOM's own tool engine, so approvals and safety rules are unchanged. The Core
 * therefore gets back plain text and no tool calls.
 */


export interface ClaudePlanOptions {
  /** Full path of the signed-in `claude` program. */
  claudePath: string;
  model: string;
  /** Runs ATOM's tools when Claude Code asks for one. Without it Claude gets no tools. */
  tools?: ToolRunner;
  /** Most Claude Code turns in one request; each tool call takes one. */
  maxTurns?: number;
  onUsage?: (usage: PlanUsage) => void;
  /** ADR-091: told the tokens each answer used. */
  onTokens?: (tokens: TokenUsage, model: string, meta?: TokenMeta) => void;
  sdk?: ClaudeSdk;
  /** The environment to start from. Default: this process's. */
  env?: Record<string, string | undefined>;
  /**
   * How long after an answer the next process is pre-started (default 3 s). Starting it costs about a second of CPU,
   * which would otherwise slow the synthesis of the answer's first spoken sentence.
   */
  prewarmDelayMs?: number;
  /** ADR-098 item 9: where each chat's Claude Code session is kept. Without it every request starts a fresh session. */
  chatSessions?: ChatSessions;
}


const SERVER = "atom";
const DEFAULT_MAX_TURNS = 12;



/** What a pre-started Claude Code process was started for: requests must match it exactly to use it. */
function keyOf(system: string, specs: ToolSpec[]): string {
  return JSON.stringify([system, specs.map((s) => [s.name, s.description, s.inputSchema])]);
}

/** The newest message, with this request's additions (memory, the time) in front, marked as not said by the user. */
function promptWith(extra: string | undefined, messages: Message[]): string {
  const prompt = promptFrom(messages);
  if (!extra?.trim()) return prompt;
  return `Context for this request, from ATOM (not said by the user):\n${extra.trim()}\n\n${prompt}`;
}

/** One request's link to the tools: set when a pre-started process is put to use. */
interface RunState {
  signal?: AbortSignal;
  acted: boolean;
  /** ADR-107: a project chat's file-tool calls in this request, counted once each by call id. */
  fileCalls?: Map<string, string | undefined>;
}

const PROJECT_TOOLS = ["Read", "Glob", "Grep"];

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
  /** What ATOM asked to keep ready (its main instructions and tools). Other requests, like conversation notes, never replace it. */
  let primary: { system: string; specs: ToolSpec[] } | undefined;
  let closed = false;
  let later: ReturnType<typeof setTimeout> | undefined;
  const prewarmDelayMs = options.prewarmDelayMs ?? 3000;
  const getSdk = async () => options.sdk ?? (await (sdkPromise ??= loadSdk()));

  /** Claude Code's options for one process. Tool calls go to whichever request `state` belongs to at the time. */
  // ADR-069: Claude Code's own web search, for news, scores, prices and anything else current. ATOM_WEB=0 turns it off.
  const webAllowed = readEnv(env, "ATOM_WEB") !== "0";
  /** `chat`: a chat's own session (ADR-098 item 9), kept on disk and resumed when `resume` is given. */
  function queryOptions(sdk: ClaudeSdk, system: string, specs: ToolSpec[], state: RunState, controller: AbortController, chat?: { resume?: string }, files?: ProjectFiles) {
    // Only with ATOM's tools: requests without them (the out-of-steps wrap-up, conversation notes) get nothing.
    // ADR-107: a project chat has web search only when its project turned it on.
    const web = webAllowed && specs.length > 0 && (!files || files.web === true);
    // ADR-107: a project chat's reads. Not in allowedTools, so every call is decided here; at most 8 per answer.
    const decide = async (name: string, input: Record<string, unknown>, id: string): Promise<{ allow: true; input: Record<string, unknown> } | { allow: false; message: string }> => {
      if (!files || !PROJECT_TOOLS.includes(name)) return { allow: false, message: "A project chat only reads files and answers. Writes go through the project's Agent." };
      const calls = (state.fileCalls ??= new Map());
      if (!calls.has(id) && calls.size >= MAX_PROJECT_FILE_CALLS) {
        return { allow: false, message: `That is the limit of ${MAX_PROJECT_FILE_CALLS} file reads for one answer. Answer now with what you have, and say what you did not read.` };
      }
      if (!calls.has(id)) calls.set(id, await files.check(name, input));
      const problem = calls.get(id);
      return problem ? { allow: false, message: problem } : { allow: true, input: files.prepare?.(name, input) ?? input };
    };
    const gate = files
      ? {
          canUseTool: async (name: string, input: Record<string, unknown>, call?: { toolUseID?: string }) => {
            const verdict = await decide(name, input, call?.toolUseID ?? randomUUID());
            return verdict.allow ? { behavior: "allow", updatedInput: verdict.input } : { behavior: "deny", message: verdict.message };
          },
          // Decided before Claude Code's own permission rules, so no read can skip the check.
          hooks: {
            PreToolUse: [
              {
                matcher: "Read|Glob|Grep|Bash|Write|Edit|MultiEdit|NotebookEdit",
                hooks: [
                  async (hook: Record<string, any>, toolUseID: string | undefined) => {
                    const input = hook.tool_input && typeof hook.tool_input === "object" ? (hook.tool_input as Record<string, unknown>) : {};
                    const verdict = await decide(String(hook.tool_name), input, toolUseID ?? hook.tool_use_id ?? randomUUID());
                    return verdict.allow
                      ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: verdict.input } }
                      : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.message } };
                  },
                ],
              },
            ],
          },
        }
      : {};
    const sdkTools = specs.length ? sdkToolsFor(sdk, specs, tools!, () => state.signal ?? controller.signal, () => (state.acted = true)) : [];
    return {
      model,
      // A chat's session renders its system prompt each time (snapshot off), so a changed team list still arrives;
      // an unchanged one is still read from the cache.
      systemPrompt: chat ? { type: "custom", prompt: system, snapshot: false } : system,
      pathToClaudeCodeExecutable: claudePath,
      // Nothing from Claude Code itself: no built-in tools, no user settings, and not the account's claude.ai connectors
      // (they would add tens of thousands of tokens to every request and let Claude reach into other services).
      tools: [...(web ? ["WebSearch"] : []), ...(files ? PROJECT_TOOLS : [])],
      ...(files ? { cwd: files.cwd } : {}),
      ...gate,
      settingSources: [],
      strictMcpConfig: true,
      persistSession: Boolean(chat),
      ...(chat?.resume ? { resume: chat.resume } : {}),
      permissionMode: "default",
      maxTurns: specs.length ? maxTurns : 1,
      // Spoken answers to everyday questions: thinking adds ~1 s per model turn for nothing a listener notices.
      // ATOM_THINKING=1 turns it back on (Claude decides how much).
      thinking: readEnv(env, "ATOM_THINKING") === "1" ? { type: "adaptive" } : { type: "disabled" },
      abortController: controller,
      env: scrubbedEnv(env),
      includePartialMessages: true, // text as it is written, so ATOM can start speaking (ADR-065)
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
    if (closed || !claudePath || readEnv(env, "ATOM_PREWARM") === "0") return;
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
      } else if (isPlanMessage(message)) {
        planGuard(message, onUsage);
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
      // Offer ATOM's tools, if there are any to offer and a way to run them.
      const specs = tools && request.tools?.length ? request.tools : [];
      const prompt = promptWith(request.systemExtra, request.messages);
      // ADR-098 item 9: a typed turn in a chat goes on in the chat's own session and sends only the new turn. The saved
      // session is used only if it ran on this model and gave the chat's last answer; otherwise a fresh one starts.
      const chatId = options.chatSessions && request.context.source === "text" && !request.context.background ? request.context.sessionId : undefined;
      const saved = chatId ? options.chatSessions!.get(chatId) : undefined;
      const said = request.messages.filter((m) => m.content.trim());
      const before = said.at(-2);
      const resume = saved && saved.model === model && before?.role === "assistant" && answerTail(before.content) === saved.tail ? saved.id : undefined;
      const key = keyOf(request.system, specs);
      let streamed = false;
      const listener = request.onText;
      if (listener) request = { ...request, onText: (d) => ((streamed = true), listener(d)) };

      const attempt = async (slot: Prepared | undefined, chat?: { resume?: string }) => {
        const state: RunState = slot?.state ?? { acted: false };
        const controller = slot?.controller ?? new AbortController();
        state.signal = signal;
        const onAbort = () => controller.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          const messages = slot
            ? (await slot.warm).query(prompt)
            : sdk.query({
                prompt: chat?.resume ? promptWith(request.systemExtra, said.slice(-1)) : prompt,
                options: queryOptions(sdk, request.system, specs, state, controller, chat, request.files),
              });
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
        const chat = chatId ? (resume ? { resume } : {}) : undefined;
        // A chat's turn never uses the pre-started process: that one keeps no session (it stays for the next voice turn).
        const slot = chat || request.files ? undefined : take(key);
        // A pre-started process, or a chat's saved session (gone or expired), that broke before doing anything is tried
        // once more the ordinary way: for a chat, a fresh session with the whole conversation.
        const retryable = Boolean(slot || chat?.resume);
        const again = () => attempt(undefined, chat ? {} : undefined);
        try {
          outcome = await attempt(slot, chat);
        } catch (error) {
          if (!retryable || signal.aborted || streamed || !(error instanceof ProviderError) || error.kind !== "unavailable") throw error;
          outcome = await again();
        }
        const broken = !outcome.result || (Boolean(chat?.resume) && outcome.result.subtype === "error_during_execution");
        if (retryable && broken && !outcome.acted && !streamed && !signal.aborted) outcome = await again();
      } finally {
        // Ready for ATOM's next request, once the answer has started being spoken. A request with tools is a main
        // one: its instructions (with the team, which may have changed) are the ones to keep ready.
        if (specs.length) primary = { system: request.system, specs };
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
      const tokens = tokensOf(result);
      if (tokens) options.onTokens?.(tokens, model, { chatId: request.context.sessionId, ...(request.context.background ? { background: true } : {}) });
      const text = typeof result.result === "string" ? withoutSources(result.result.trim()) : "";
      // ADR-093: the SDK's stop reason ("refusal", "max_tokens", …) lets the message say declined or cut off.
      if (!text) throw new ProviderError("unknown", emptyReplyReason(result.stop_reason));
      if (chatId && typeof result.session_id === "string") {
        try {
          options.chatSessions!.set(chatId, { id: result.session_id, model, tail: answerTail(text) });
        } catch {
          // a saved session only saves tokens: the next turn then starts afresh
        }
      }
      return { text };
    },
  };
}
