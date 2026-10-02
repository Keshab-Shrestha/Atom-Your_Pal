// Shared types between ZENO modules. Types only: no behaviour lives here.

/** Where a request came from. More sources arrive in later phases (UI, API, events). */
export type InputSource = "voice" | "text";

/** Normalized input: every input source becomes one of these before reaching the Core. */
export interface ZenoInput {
  text: string;
  source: InputSource;
}

/** A tool the model may ask ZENO to run. `inputSchema` is JSON Schema for an object. */
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
}

/** What running a tool produced, in words for the model. Failures are results too (`isError`). */
export interface ToolResult {
  callId: string;
  content: string;
  isError?: boolean;
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
}

export interface ZenoResponse {
  requestId: string;
  text: string;
}

/** What the Core asks of a language model. */
export interface ModelRequest {
  system: string;
  messages: Message[];
  context: RequestContext;
  /** Tools the model may call. Providers that cannot call tools ignore this and just answer. */
  tools?: ToolSpec[];
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
}
