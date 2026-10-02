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
    handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>,
  ): unknown;
  createSdkMcpServer(options: { name: string; version?: string; tools: unknown[] }): unknown;
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

export function createClaudePlanAdapter(options: ClaudePlanOptions): ProviderAdapter {
  const { claudePath, model, tools, maxTurns = DEFAULT_MAX_TURNS, onUsage } = options;
  let sdkPromise: Promise<ClaudeSdk> | undefined;

  return {
    name: "claude-plan",
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      if (signal.aborted) throw new ProviderError("cancelled", "Request cancelled");
      if (!claudePath) {
        throw new ProviderError("auth", "Claude Code was not found. Install it, then run `claude auth login` in a terminal.");
      }

      const sdk = options.sdk ?? (await (sdkPromise ??= loadSdk()));
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });

      // Offer ZENO's tools, if there are any to offer and a way to run them.
      const specs = tools && request.tools?.length ? request.tools : [];
      let acted = false;
      const sdkTools = specs.map((spec) =>
        sdk.tool(spec.name, spec.description, shapeOf(spec), async (input) => {
          acted = true;
          const result = await tools!.run({ id: randomUUID(), name: spec.name, input }, signal);
          return { content: [{ type: "text" as const, text: result.content }], ...(result.isError ? { isError: true } : {}) };
        }),
      );

      const queryOptions: Record<string, unknown> = {
        model,
        systemPrompt: request.system,
        pathToClaudeCodeExecutable: claudePath,
        // Nothing from Claude Code itself: no built-in tools, no user settings, and not the account's claude.ai connectors
        // (they would add tens of thousands of tokens to every request and let Claude reach into other services).
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        permissionMode: "default",
        maxTurns: specs.length ? maxTurns : 1,
        abortController: controller,
        env: scrubbedEnv(options.env ?? process.env),
        ...(specs.length
          ? {
              mcpServers: { [SERVER]: sdk.createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: sdkTools }) },
              allowedTools: specs.map((s) => `mcp__${SERVER}__${s.name}`),
            }
          : {}),
      };

      let lastError: string | undefined;
      let result: Record<string, any> | undefined;
      try {
        for await (const message of sdk.query({ prompt: promptFrom(request.messages), options: queryOptions })) {
          if (signal.aborted) break;

          if (message.type === "system" && message.subtype === "init") {
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
              const usage: PlanUsage = {
                ...(typeof windows.five_hour?.utilization === "number" ? { fiveHour: windows.five_hour.utilization } : {}),
                ...(typeof windows.seven_day?.utilization === "number" ? { sevenDay: windows.seven_day.utilization } : {}),
                ...(typeof info.isUsingOverage === "boolean" ? { overage: info.isUsingOverage } : {}),
              };
              onUsage(usage);
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
      } catch (error) {
        if (signal.aborted) throw new ProviderError("cancelled", "Request cancelled");
        if (error instanceof ProviderError) throw error;
        const text = error instanceof Error ? error.message : String(error);
        throw new ProviderError(acted ? "unknown" : "unavailable", redactSecrets(`Claude Code could not run: ${text}`));
      } finally {
        signal.removeEventListener("abort", onAbort);
        controller.abort(); // stops the claude program, whether the request finished, failed or was cancelled
      }

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
      const text = typeof result.result === "string" ? result.result.trim() : "";
      if (!text) throw new ProviderError("unknown", emptyReplyReason("claude-plan", "none"));
      return { text };
    },
  };
}
