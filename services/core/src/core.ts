import { randomUUID } from "node:crypto";
import type { LanguageModel, Message, RequestContext, ZenoInput, ZenoResponse } from "@zeno/contracts";

export const DEFAULT_SYSTEM_PROMPT =
  "You are ZENO, a voice assistant. Your replies are spoken aloud, so answer in short, " +
  "natural sentences. Do not use markdown, lists, headings or emoji.";

export class CoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreError";
  }
}

export interface CoreOptions {
  model: LanguageModel;
  systemPrompt?: string;
  /** Maximum user+assistant turn pairs kept in session history (bounds prompt size). */
  maxTurns?: number;
  newId?: () => string;
  now?: () => Date;
}

export interface Core {
  readonly sessionId: string;
  /** Receives one input, establishes context, routes it and returns the response. */
  handle(input: ZenoInput): Promise<ZenoResponse>;
  /** The current session's conversation, oldest first. */
  history(): readonly Message[];
  /** Forgets the conversation and starts a new session. */
  reset(): void;
}

/**
 * ZENO Core: the central request/response boundary.
 * Phase 0 has a single route (the language model) and session-only history (ADR-030).
 */
export function createCore(options: CoreOptions): Core {
  const { model, systemPrompt = DEFAULT_SYSTEM_PROMPT, maxTurns = 20, newId = randomUUID, now = () => new Date() } = options;
  let sessionId = newId();
  let turns: Message[] = [];
  let busy = false;

  return {
    get sessionId() {
      return sessionId;
    },

    async handle(input) {
      const text = input.text.trim();
      if (!text) throw new CoreError("Empty request");
      if (busy) throw new CoreError("Still answering the previous request");

      const context: RequestContext = { requestId: newId(), sessionId, source: input.source, receivedAt: now() };
      const userTurn: Message = { role: "user", content: text };
      const sessionAtStart = sessionId;

      busy = true;
      try {
        const reply = await model.complete({ system: systemPrompt, messages: [...turns, userTurn], context });
        const replyText = reply.text.trim();
        if (!replyText) throw new CoreError("The model returned an empty reply");

        // Only record the exchange if it succeeded and the session was not reset meanwhile.
        if (sessionId === sessionAtStart) {
          const assistantTurn: Message = { role: "assistant", content: replyText };
          turns = [...turns, userTurn, assistantTurn].slice(-maxTurns * 2);
        }
        return { requestId: context.requestId, text: replyText };
      } finally {
        busy = false;
      }
    },

    history() {
      return turns;
    },

    reset() {
      turns = [];
      sessionId = newId();
    },
  };
}
