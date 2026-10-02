import { randomUUID } from "node:crypto";
import type { LanguageModel, Message, RequestContext, ToolRunner, ZenoInput, ZenoResponse } from "@zeno/contracts";

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
  /** Tools the model may use. Without it, ZENO only talks. */
  tools?: ToolRunner;
  /** Most tool rounds in one request, so a confused model cannot loop forever. */
  maxToolRounds?: number;
  systemPrompt?: string;
  /** Maximum user+assistant turn pairs kept in session history (bounds prompt size). */
  maxTurns?: number;
  newId?: () => string;
  now?: () => Date;
}

export interface Core {
  readonly sessionId: string;
  /**
   * Receives one input, establishes context, routes it and returns the response.
   * Aborting `signal` cancels the request; a cancelled exchange is not added to history.
   */
  handle(input: ZenoInput, signal?: AbortSignal): Promise<ZenoResponse>;
  /** The current session's conversation, oldest first. */
  history(): readonly Message[];
  /** Forgets the conversation and starts a new session. */
  reset(): void;
}

/**
 * ZENO Core: the central request/response boundary.
 * Phase 0 has a single route (the language model) and session-only history (ADR-030).
 */
const OUT_OF_STEPS =
  "You have run out of steps for this request, so you cannot use any more tools. In one or two short spoken sentences, " +
  "tell the user what you did and what stopped you, and what they could do. Do not say you will try again.";

export function createCore(options: CoreOptions): Core {
  const {
    model,
    tools,
    maxToolRounds = 8,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    maxTurns = 20,
    newId = randomUUID,
    now = () => new Date(),
  } = options;
  let sessionId = newId();
  let turns: Message[] = [];
  let busy = false;

  return {
    get sessionId() {
      return sessionId;
    },

    async handle(input, signal) {
      const text = input.text.trim();
      if (!text) throw new CoreError("Empty request");
      if (busy) throw new CoreError("Still answering the previous request");

      const context: RequestContext = { requestId: newId(), sessionId, source: input.source, receivedAt: now() };
      const userTurn: Message = { role: "user", content: text };
      const sessionAtStart = sessionId;

      busy = true;
      try {
        // Tool rounds live only in this request's `messages`; session history keeps just the user turn and
        // the final answer, so a trimmed history can never hold half a tool exchange.
        const messages: Message[] = [...turns, userTurn];
        const specs = tools?.specs() ?? [];
        let reply = await model.complete({ system: systemPrompt, messages, context, ...(specs.length ? { tools: specs } : {}) }, signal);
        for (let round = 0; tools && reply.toolCalls?.length; round++) {
          if (signal?.aborted) throw new CoreError("Request cancelled");
          if (round >= maxToolRounds) {
            // Out of steps. Do not just fail: ask once, with no tools, for a short account of where it got stuck,
            // so the user hears why ("Brave has two windows open") and not a bare error.
            const wrapUp = await model.complete({ system: `${systemPrompt}\n\n${OUT_OF_STEPS}`, messages, context }, signal);
            if (signal?.aborted) throw new CoreError("Request cancelled");
            if (!wrapUp.text.trim() || wrapUp.toolCalls?.length) throw new CoreError("ZENO used too many steps on this request and stopped");
            reply = { text: wrapUp.text };
            break;
          }
          const calls = reply.toolCalls;
          const results = [];
          for (const call of calls) results.push(await tools.run(call, signal)); // one at a time, in order
          if (signal?.aborted) throw new CoreError("Request cancelled");
          messages.push({ role: "assistant", content: reply.text, toolCalls: calls }, { role: "user", content: "", toolResults: results });
          reply = await model.complete({ system: systemPrompt, messages, context, tools: specs }, signal);
        }
        if (signal?.aborted) throw new CoreError("Request cancelled");
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
