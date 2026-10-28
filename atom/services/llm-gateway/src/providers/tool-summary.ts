
/**
 * Activity timeline (TASK.md B3.1): a run's tool calls, as short redacted summaries for the task's thread. A summary is
 * made here, in the run's loop, so no raw tool input or output leaves it and no secret reaches the store.
 */

export const TOOL_INPUT_CHARS = 160;
export const TOOL_RESULT_CHARS = 200;
const TOOL_NAME_CHARS = 80;
export const HIDDEN = "[hidden]";
export const SECRET_FILE = "(secret file, hidden)";
export const TEXT_HIDDEN = "(text hidden)";

export type ToolCallState = "started" | "ok" | "error";

/** One start or end of a tool call. `id` is Claude Code's tool_use id; `agent` is the sub-agent's name (absent: the run). */
export interface ToolCallEvent {
  id: string;
  agent?: string;
  tool: string;
  input: string;
  state: ToolCallState;
  result?: string;
  /** ISO 8601. */
  at: string;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, HIDDEN],
  [/((?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1"], // URL userinfo; starts only at the start of a word run (a \b here was retried at every dot of a long dotted run: quadratic)
  [/\bsk-[A-Za-z0-9_-]{16,}/g, HIDDEN],
  [/(\s(?:-u|--user)[\s=]+)\S+/g, `$1${HIDDEN}`], // curl -u user:pass
  [/\bBearer\s+\S+/gi, `Bearer ${HIDDEN}`],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, HIDDEN],
  [/\bxox[bp]-[A-Za-z0-9-]{8,}/g, HIDDEN],
  [/\bAKIA[0-9A-Z]{16}\b/g, HIDDEN],
  [/\b(token|key|secret|password|authorization)(\s*[=:]\s*)(?!\[hidden\])\S+/gi, `$1$2${HIDDEN}`],
  [/([?&][^=&\s#]+=)[A-Za-z0-9_\-.~%+/]{20,}/g, `$1${HIDDEN}`], // token-like query values
];

/** Masks what looks like a secret. Pure; runs before any cut, so a cut never leaves half a token. */
export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((t, [pattern, to]) => t.replace(pattern, to), text);
}

/** Collapses white space and cuts at `max` characters, ending with "…". */
export function cutText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const SECRET_FILE_PATH = /(^|[\s/="'])\.env(\.[\w.-]+)?(?=$|[\s"'])|data\/api-token/;
/** Does this path or command touch .env or data/api-token? */
export const touchesSecretFile = (text: string) => SECRET_FILE_PATH.test(text);

const FILE_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep"]);
const TYPING_ACTIONS = new Set(["type", "fill_form", "select_option", "press_key"]);

const str = (value: unknown) => (typeof value === "string" ? value : "");
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};
const withoutQuery = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? "";
  }
};

/** What a call is about, in a few words, never a write payload; `secret` when it touches a secret file. */
export function summarizeToolInput(tool: string, rawInput: unknown): { text: string; secret: boolean } {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const done = (text: string) => ({ text: cutText(redact(text), TOOL_INPUT_CHARS), secret: false });
  const secret = { text: SECRET_FILE, secret: true };
  if (tool === "Bash") {
    const first = str(input.command).split("\n")[0] ?? "";
    return touchesSecretFile(str(input.command)) ? secret : done(first);
  }
  if (FILE_TOOLS.has(tool)) {
    const target = str(input.file_path) || str(input.notebook_path) || str(input.pattern) || str(input.path);
    return touchesSecretFile(target) ? secret : done(target);
  }
  if (tool === "WebFetch") return done(withoutQuery(str(input.url)));
  if (tool === "WebSearch") return done(str(input.query));
  if (tool === "Agent" || tool === "Task") return done(str(input.description));
  const browser = /^mcp__[^_]*browser[^_]*__(.+)$/i.exec(tool);
  if (browser) {
    const action = browser[1]!.replace(/^browser_/, "");
    const site = host(str(input.url));
    return done([action, site, TYPING_ACTIONS.has(action) ? TEXT_HIDDEN : ""].filter(Boolean).join(" "));
  }
  return done("");
}

/** A tool's answer, masked and cut. */
export const summarizeToolResult = (text: string) => cutText(redact(text.slice(0, REDACT_LIMIT)), TOOL_RESULT_CHARS);
/** Only this much of a tool answer is looked at: the rest is cut anyway, and a huge text would block the event loop. */
const REDACT_LIMIT = 200_000;

/**
 * Turns the tool_use and tool_result blocks of a run's messages into summarized events for `emit`. A throw from `emit`
 * never reaches the run. `agentOf` names the sub-agent a message's `parent_tool_use_id` belongs to.
 */
export function toolCallRecorder(emit: ((event: ToolCallEvent) => void) | undefined, agentOf?: (parentToolUseId: string) => string | undefined) {
  const secrets = new Set<string>();
  const typed = new Set<string>(); // browser typing calls: Playwright's result repeats the typed text
  const tell = (event: ToolCallEvent) => {
    try {
      emit?.(event);
    } catch {
      // the timeline is a help, never a reason to fail the run
    }
  };
  const agentFor = (parent: unknown) => (typeof parent === "string" ? agentOf?.(parent) : undefined);
  return {
    started(block: { id?: unknown; name?: unknown; input?: unknown }, parent?: unknown) {
      if (!emit || typeof block.id !== "string" || typeof block.name !== "string") return;
      const { text, secret } = summarizeToolInput(block.name, block.input);
      if (secret) secrets.add(block.id);
      if (/^mcp__[^_]*browser[^_]*__browser_(type|fill_form)$/i.test(block.name)) typed.add(block.id);
      const agent = agentFor(parent);
      tell({ id: block.id, ...(agent ? { agent } : {}), tool: block.name.slice(0, TOOL_NAME_CHARS), input: text, state: "started", at: new Date().toISOString() });
    },
    /** Matched to its call by `tool_use_id` only. */
    ended(block: { tool_use_id?: unknown; is_error?: unknown; content?: unknown }, parent?: unknown) {
      if (!emit || typeof block.tool_use_id !== "string") return;
      const result = secrets.has(block.tool_use_id) ? SECRET_FILE : typed.has(block.tool_use_id) ? TEXT_HIDDEN : summarizeToolResult(resultText(block.content));
      const agent = agentFor(parent);
      tell({
        id: block.tool_use_id,
        ...(agent ? { agent } : {}),
        tool: "",
        input: "",
        state: block.is_error === true ? "error" : "ok",
        ...(result ? { result } : {}),
        at: new Date().toISOString(),
      });
    },
  };
}

/** Plain text from a tool result's content (a string, or text blocks), or from the Agent tool's own output. */
export function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" ? String((b as { text?: unknown }).text ?? "") : "")).join(" ");
  if (value && typeof value === "object" && "content" in value) return resultText((value as { content: unknown }).content);
  return "";
}
