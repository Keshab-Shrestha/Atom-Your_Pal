import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z, type ZodType } from "zod";
import type { Message, ToolRunner, ToolSpec } from "@atom/contracts";
import { ProviderError, type ErrorKind } from "../gateway.ts";

/**
 * What every run on the user's Claude plan shares (ADR-092, ADR-110): the money rule (`planGuard`), the environment
 * Claude Code starts with (`scrubbedEnv`), how its errors read (`classify`), the tokens of a result (`tokensOf`), ATOM's
 * tools as SDK tools (`sdkToolsFor`), and the small text helpers. The money rule: a run never falls back to per-token billing.
 */

/** The parts of the SDK ATOM uses (lets tests supply a fake). Loaded only when first needed. */
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
  resetAt?: number;
  limited?: boolean;
  fiveHour?: number;
  sevenDay?: number;
  /** True if Claude is charging extra usage beyond the plan (this adapter stops before that happens). */
  overage?: boolean;
}

/** ADR-091: the tokens one Claude Code run used, and its API-equivalent cost (the plan does not charge it). */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd?: number;
  /** How long the written cache lives ("1h" or "5m"), when the result says. */
  cacheTtl?: string;
}

/** Job 1 (token cost): which chat a call belongs to, and whether it was the background note. */
export interface TokenMeta {
  chatId?: string;
  background?: boolean;
}

/**
 * The tokens in a Claude Code result message; undefined when it names none. `usage` covers the main loop only;
 * with `allModels` (a worker's run, ADR-095) the per-model totals are used instead, which include its sub-agents.
 */
export function tokensOf(result: Record<string, any> | undefined, opts: { allModels?: boolean } = {}): TokenUsage | undefined {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const models = opts.allModels && result?.modelUsage && typeof result.modelUsage === "object" ? Object.values(result.modelUsage as Record<string, any>).filter((m) => m && typeof m === "object") : [];
  const u = result?.usage;
  if (!models.length && (!u || typeof u !== "object")) return undefined;
  const t: TokenUsage = models.length
    ? models.reduce<TokenUsage>(
        (s, m) => ({ input: s.input + n(m.inputTokens), output: s.output + n(m.outputTokens), cacheRead: s.cacheRead + n(m.cacheReadInputTokens), cacheWrite: s.cacheWrite + n(m.cacheCreationInputTokens) }),
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      )
    : { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
  if (t.input + t.output + t.cacheRead + t.cacheWrite === 0) return undefined;
  const cost = result?.total_cost_usd;
  const created = models.length ? undefined : u?.cache_creation;
  const cacheTtl = n(created?.ephemeral_1h_input_tokens) ? "1h" : n(created?.ephemeral_5m_input_tokens) ? "5m" : undefined;
  return { ...t, ...(typeof cost === "number" && cost > 0 ? { costUsd: cost } : {}), ...(cacheTtl ? { cacheTtl } : {}) };
}

/**
 * ADR-098 item 9: one Claude Code session per chat. Claude Code keeps the session on this Mac; ATOM stores only its
 * id, the model it ran on and a hash of its last answer (`tail`), so a chat that changed outside it starts afresh.
 */
export interface ChatSession {
  id: string;
  model: string;
  tail: string;
}

export interface ChatSessions {
  get(chatId: string): ChatSession | undefined;
  set(chatId: string, session: ChatSession): void;
}

/** A short hash of an answer, to see that a chat's last answer is the one its session gave. */
export const answerTail = (text: string) => createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);

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

/**
 * The installed Agent SDK's version, for the log: ATOM's safety gate depends on how Claude Code treats hook output, so
 * a changed version explains a changed behaviour. "unknown" when it cannot be read.
 */
export function sdkVersion(): string {
  try {
    // The package does not export its package.json: read the file beside the entry point.
    const entry = createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk");
    const manifest = JSON.parse(readFileSync(join(dirname(entry), "package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

export async function loadSdk(): Promise<ClaudeSdk> {
  return (await import("@anthropic-ai/claude-agent-sdk")) as unknown as ClaudeSdk;
}

/** ADR-097: how long the model list may take (Claude Code starts, answers, and is closed). */
export const PLAN_MODELS_TIMEOUT_MS = 30_000;

/**
 * ADR-097: the models the signed-in `claude` program offers on this plan, from the Agent SDK's `supportedModels()`.
 * No prompt is sent: the process gets an empty input stream, answers the request and is closed. It runs with the same
 * safe options as a chat: no tools, no settings, no claude.ai connectors, no API key. Rejects on any failure.
 */
export async function listPlanModels(
  claudePath: string,
  options: { env?: Record<string, string | undefined>; timeoutMs?: number } = {},
): Promise<import("@atom/contracts").ReasoningModel[]> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const controller = new AbortController();
  const stopped = new Promise<never>((_, reject) =>
    controller.signal.addEventListener("abort", () => reject(new Error("Claude Code did not list its models in time.")), { once: true }),
  );
  stopped.catch(() => {}); // only awaited in the race below
  // An input stream that sends nothing until the run is closed.
  async function* nothing(): AsyncGenerator<never> {
    await new Promise((resolve) => controller.signal.addEventListener("abort", resolve, { once: true }));
  }
  const run = sdk.query({
    prompt: nothing(),
    options: {
      pathToClaudeCodeExecutable: claudePath,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      abortController: controller,
      env: scrubbedEnv(options.env ?? process.env),
    },
  });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PLAN_MODELS_TIMEOUT_MS);
  try {
    const found = await Promise.race([run.supportedModels(), stopped]);
    const models: import("@atom/contracts").ReasoningModel[] = [];
    for (const m of found) {
      // "default" is an alias for one of the others; an alias row is kept under the model id it resolves to.
      const id = (m.resolvedModel || m.value || "").trim();
      if (!id || m.value === "default" || models.some((x) => x.id === id)) continue;
      models.push({ id, name: m.displayName?.trim() || id,
        reasoningLevels: ["off", ...(m.supportsAdaptiveThinking && m.supportsEffort ? m.supportedEffortLevels ?? [] : [])], defaultReasoning: "off" });
    }
    return models;
  } finally {
    clearTimeout(timer);
    controller.abort();
    run.close();
  }
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

/**
 * ATOM's tools as SDK tools of an in-process MCP server: each call goes straight to ATOM's own tool engine, so
 * approvals and safety rules are unchanged. `onCall` is told before a tool runs.
 */
export function sdkToolsFor(sdk: Pick<ClaudeSdk, "tool">, specs: ToolSpec[], runner: ToolRunner, signal: () => AbortSignal, onCall?: () => void): unknown[] {
  return specs.map((spec) =>
    sdk.tool(spec.name, spec.description, shapeOf(spec), async (input) => {
      onCall?.();
      const result = await runner.run({ id: randomUUID(), name: spec.name, input }, signal());
      // ADR-080: a screenshot goes after the words as MCP image content, which Claude Code shows the model.
      const images = (result.images ?? []).map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }));
      return { content: [{ type: "text" as const, text: result.content }, ...images], ...(result.isError ? { isError: true } : {}) };
    }),
  );
}

/** The conversation as one prompt: earlier turns as a transcript, then the newest message as the question. */
export function promptFrom(messages: Message[]): string {
  const turns = messages.filter((m) => m.content.trim());
  const last = turns.at(-1)?.content.trim() ?? "";
  if (turns.length <= 1) return last;
  const earlier = turns
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "ATOM"}: ${m.content.trim()}`)
    .join("\n");
  return `Conversation so far:\n${earlier}\n\nThe user now says:\n${last}`;
}

const resetTime = (seconds?: number) =>
  seconds ? ` It resets at ${new Date(seconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : "";

/** What Claude Code said went wrong, in provider-independent terms. `acted` = a tool has already changed something. */
export function classify(code: string | undefined, acted: boolean): { kind: ErrorKind; message: string } {
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

/** The stream messages `planGuard` checks: the start (which credential) and plan usage. */
export const isPlanMessage = (message: Record<string, any>) =>
  (message.type === "system" && message.subtype === "init") || message.type === "rate_limit_event";

/**
 * The money rule for every run on the plan: throws if Claude Code started with an API key (billed per token), if it
 * would charge extra usage, or if the plan limit is reached. Reports plan usage to `onUsage`.
 */
export function planGuard(message: Record<string, any>, onUsage?: (usage: PlanUsage) => void): void {
  if (message.type === "system") {
    const source = String(message.apiKeySource ?? "");
    if (!PLAN_CREDENTIALS.has(source)) {
      throw new ProviderError(
        "auth",
        `Claude Code is using an API key (${source || "unknown"}), which bills per token, so ATOM stopped. Remove the key from Claude Code or use the Claude (API) provider on purpose.`,
      );
    }
    return;
  }
  const info = message.rate_limit_info ?? {};
  if (onUsage) {
    const windows = info.unifiedWindows ?? {};
    try {
      onUsage({
        ...(typeof info.resetsAt === "number" && Number.isFinite(info.resetsAt) && info.resetsAt > 0 && info.resetsAt < 4_102_444_800 ? { resetAt: info.resetsAt } : {}),
        ...(["allowed", "allowed_warning", "rejected"].includes(info.status) ? { limited: info.status === "rejected" } : {}),
        ...(typeof windows.five_hour?.utilization === "number" ? { fiveHour: windows.five_hour.utilization } : {}),
        ...(typeof windows.seven_day?.utilization === "number" ? { sevenDay: windows.seven_day.utilization } : {}),
        ...(typeof info.isUsingOverage === "boolean" ? { overage: info.isUsingOverage } : {}),
      });
    } catch {
      // The owner's bookkeeping never ends a turn (it used to close the chat session). The plan checks below still run.
    }
  }
  if (info.isUsingOverage === true) {
    throw new ProviderError("rate_limit", "Your Claude plan is used up and Claude would charge extra usage, so ATOM stopped. Switch model or wait for the plan to reset.");
  }
  if (info.status === "rejected") {
    throw new ProviderError("rate_limit", `Your Claude plan limit is reached.${resetTime(info.resetsAt)}`);
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

/** ADR-107: most file-tool calls (Read, Glob, Grep) in one answer of a project chat; then it must answer. */
export const MAX_PROJECT_FILE_CALLS = 8;
