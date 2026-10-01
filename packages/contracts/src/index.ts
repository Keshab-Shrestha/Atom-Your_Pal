// Shared types between ZENO modules. Types only: no behaviour lives here.

/** Where a request came from. More sources arrive in later phases (UI, API, events). */
export type InputSource = "voice" | "text";

/** Normalized input: every input source becomes one of these before reaching the Core. */
export interface ZenoInput {
  text: string;
  source: InputSource;
}

/** One turn in a conversation, as sent to a language model. */
export interface Message {
  role: "user" | "assistant";
  content: string;
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
}

export interface ModelResponse {
  text: string;
}

/**
 * The Core's only view of a language model. The LLM Gateway implements this;
 * the Core never talks to a provider directly (ADR: all model access goes through the gateway).
 */
export interface LanguageModel {
  /** `signal` cancels the request (e.g. the user started speaking again). */
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}
