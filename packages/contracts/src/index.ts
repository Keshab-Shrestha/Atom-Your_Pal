// Shared types between ATOM modules. Types only: no behaviour lives here.

/** Where a request came from. More sources arrive in later phases (UI, API, events). */
export type InputSource = "voice" | "text";

/** Normalized input: every input source becomes one of these before reaching the Core. */
export interface ZenoInput {
  text: string;
  source: InputSource;
  /** Host delivery identity, never a permission or a provider-side exactly-once guarantee. */
  deliveryId?: string;
  deliveryChat?: string;
}

/** A tool the model may ask ATOM to run. `inputSchema` is JSON Schema for an object. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, { type: string; description?: string }>; required?: string[] };
}

/** The model asking for a tool to be run. `id` ties the result back to the call. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** A provider's own token for this call (Gemini's thought signature). Passed back unchanged, never read. */
  signature?: string;
}

/** An image a tool hands to the model (ADR-080: a screenshot), base64. Lives only in one request; never logged or stored. */
export interface ToolImage {
  mimeType: string;
  data: string;
}

/** What running a tool produced, in words for the model, plus any images. Failures are results too (`isError`). */
export interface ToolResult {
  callId: string;
  content: string;
  isError?: boolean;
  images?: ToolImage[];
}

/** The Core's only view of the tool engine (services/tool-engine implements it). */
export interface ToolRunner {
  specs(): ToolSpec[];
  /** Never throws for a failing tool: the failure comes back as a result with `isError`. */
  run(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
}

/**
 * One turn in a conversation, as sent to a language model. An assistant turn may carry the tool calls
 * it made (`toolCalls`); the next user turn then carries their `toolResults`. Tool turns exist only
 * within one request: the Core does not keep them in session history.
 */
export interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

/** Context the Core establishes for each request. */
export interface RequestContext {
  requestId: string;
  sessionId: string;
  source: InputSource;
  receivedAt: Date;
  /** A request ATOM makes by itself about a conversation (e.g. its summary): it never joins the chat's own session. */
  background?: boolean;
}

export interface ZenoResponse {
  requestId: string;
  text: string;
}

/** What the Core asks of a language model. */
export interface ModelRequest {
  /** The standing instructions: the same from request to request (lets a provider prepare ahead, ADR-064). */
  system: string;
  /** Per-request additions (memory, the time). Providers add them to the instructions or send them with the message. */
  systemExtra?: string;
  messages: Message[];
  context: RequestContext;
  /** Tools the model may call. Providers that cannot call tools ignore this and just answer. */
  tools?: ToolSpec[];
  /** Host-only, read-only own-chat archive tools. Never serialize into provider input or pass to workers. */
  historyTools?: ToolRunner;
  /** Host-only foreground interaction tools, separate from read-only history. Never serialize or pass to workers. */
  interactionTools?: ToolRunner;
  /** Host-only web admission for this request. An absent value grants no host web access. */
  web?: boolean;
  /** Host-only: files belong to a project, rather than attachment copies. Absent means false. */
  project?: boolean;
  /**
   * Receives the reply's text as it is written, for speaking early (ADR-065). Providers that cannot stream ignore it.
   * Text written before a tool call ("Let me check.") is included; turns are separated by a newline.
   */
  onText?: (delta: string) => void;
  /**
   * ADR-107: set for a project chat: direct read-only file tools (Read, Glob, Grep) confined to `cwd`. Every call goes
   * through `check` (a reason it is refused, or undefined). Providers that cannot run file tools refuse the request.
   */
  files?: ProjectFiles;
}

/** ADR-107: a project chat's read-only file access. */
export interface ProjectFiles {
  cwd: string;
  check(name: string, input: Record<string, unknown>): Promise<string | undefined>;
  /** The input the tool runs with (e.g. a search that skips secrets); unchanged when absent. */
  prepare?(name: string, input: Record<string, unknown>): Record<string, unknown>;
  /** Web search in this chat. Off unless true. */
  web?: boolean;
}

export interface ModelResponse {
  text: string;
  /** Present when the model wants tools run before it answers. `text` may then be empty. */
  toolCalls?: ToolCall[];
}

/**
 * The Core's only view of a language model. The LLM Gateway implements this;
 * the Core never talks to a provider directly (ADR: all model access goes through the gateway).
 */
export interface LanguageModel {
  /** `signal` cancels the request (e.g. the user started speaking again). */
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
  /** A hint that a request with these instructions and tools is coming, so a provider can start up ahead. Optional. */
  prepare?(request: PrepareRequest): void;
  /** Releases anything prepared (e.g. a pre-started process). Optional. */
  close?(): void;
}

export type PrepareRequest = Pick<ModelRequest, "system" | "tools">;
