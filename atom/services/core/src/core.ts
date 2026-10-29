import type { Message, ZenoInput, ZenoResponse } from "@atom/contracts";

export class CoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreError";
  }
}

export interface HandleHooks {
  /** The reply's text as the model writes it (ADR-065). Not called by models that cannot stream. */
  onText?: (delta: string) => void;
}

export interface Core {
  readonly sessionId: string;
  /** True while a request is being answered. A Core that does not say is treated as idle. */
  readonly busy?: boolean;
  /**
   * Receives one input, establishes context, routes it and returns the response.
   * Aborting `signal` cancels the request; a cancelled exchange is not added to history.
   */
  handle(input: ZenoInput, signal?: AbortSignal, hooks?: HandleHooks): Promise<ZenoResponse>;
  /** The current session's conversation, oldest first. */
  history(): readonly Message[];
  /** Forgets the conversation and starts a new session. */
  reset(): void;
  /** Continues a saved session with its full archive. Provider replay is bounded separately. */
  resume(sessionId: string, turns: readonly Message[]): void;
  /** Lets the model start up ahead of the next request (ADR-064). Safe to call any time. */
  prepare(): void;
}
