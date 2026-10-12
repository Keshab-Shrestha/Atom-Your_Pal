import { randomUUID } from "node:crypto";
import type { LanguageModel, Message, RequestContext, ToolRunner, ZenoInput, ZenoResponse } from "@zeno/contracts";

export const DEFAULT_SYSTEM_PROMPT =
  "You are ATOM, a voice assistant. Your replies are spoken aloud, so answer in short, " +
  "natural sentences. Do not use markdown, lists, headings or emoji. Keep most replies to one to three sentences, " +
  "like a person talking; give more only when the user asks for detail or steps, and then still keep it brief. " +
  "Ask at most one question per reply. " +
  // ADR-095: the character on screen is ATOM (it was called Pal); the user may call you by either name.
  "On screen you appear as ATOM, the user's team lead; the user may call you ATOM, or Pal (its old name). " +
  // ADR-077: replies for the ear.
  "End with the answer, not with an offer such as \"do you want to know more?\". " +
  "Describe code or long text in a sentence instead of reading it out. " +
  "Say web addresses and file paths by name, such as \"the BBC News site\", never character by character. " +
  "You run on the user's Mac. When a tool can do what the user asks (opening an app or website, music, volume, notes, timers, weather, searching the web for news or anything current, " +
  "calendar, reminders, memory), use it instead of explaining how they could do it themselves. " +
  "Before a web search, first say a few words such as \"Let me look that up.\" so the user hears you straight away; " +
  "then give the answer in one to three sentences, without mentioning search results.";

export class CoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreError";
  }
}

export interface CoreOptions {
  model: LanguageModel;
  /** Tools the model may use. Without it, ATOM only talks. */
  tools?: ToolRunner;
  /** Most tool rounds in one request, so a confused model cannot loop forever. */
  maxToolRounds?: number;
  systemPrompt?: string;
  /**
   * Extra context for one request (ADR-058: what ATOM remembers that may matter). Its text is added to the system
   * prompt for this request only. A failing provider is ignored: the request goes on without it.
   */
  context?: (input: ZenoInput, context: RequestContext) => string | undefined | Promise<string | undefined>;
  /**
   * ADR-098 item 9: context that rarely changes (the team, how to use memory). It goes after the system prompt, so a
   * provider can cache it with the instructions. A failing provider is ignored.
   */
  standing?: () => string | undefined;
  /**
   * Called after every exchange that is kept in history, with the whole session so far (ADR-059: conversation
   * summaries). Must not throw or block; errors are ignored.
   */
  onExchange?: (sessionId: string, turns: readonly Message[]) => void;
  /**
   * ADR-071: plain commands settled in code. Tried before the model; a reply string means it was handled (the exchange
   * joins the conversation and no model is called), undefined means the model answers as usual.
   */
  shortcuts?: (text: string, signal?: AbortSignal) => Promise<string | undefined>;
  /** Maximum user+assistant turn pairs kept in session history (bounds prompt size). */
  maxTurns?: number;
  newId?: () => string;
  now?: () => Date;
}

export interface HandleHooks {
  /** The reply's text as the model writes it (ADR-065). Not called by models that cannot stream. */
  onText?: (delta: string) => void;
}

export interface Core {
  readonly sessionId: string;
  /**
   * Receives one input, establishes context, routes it and returns the response.
   * Aborting `signal` cancels the request; a cancelled exchange is not added to history.
   */
  handle(input: ZenoInput, signal?: AbortSignal, hooks?: HandleHooks): Promise<ZenoResponse>;
  /** The current session's conversation, oldest first. */
  history(): readonly Message[];
  /** Forgets the conversation and starts a new session. */
  reset(): void;
  /** ADR-091: continues a saved session: its id and its turns (the newest kept within the history's bound). */
  resume(sessionId: string, turns: readonly Message[]): void;
  /** Lets the model start up ahead of the next request (ADR-064). Safe to call any time. */
  prepare(): void;
}

/**
 * ATOM Core: the central request/response boundary.
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
    systemPrompt: basePrompt = DEFAULT_SYSTEM_PROMPT,
    context: contextFor,
    standing,
    onExchange,
    shortcuts,
    maxTurns = 20,
    newId = randomUUID,
    now = () => new Date(),
  } = options;
  let sessionId = newId();
  let turns: Message[] = [];
  let busy = false;
  const fullPrompt = () => {
    let extra: string | undefined;
    try {
      extra = standing?.()?.trim() || undefined;
    } catch {
      extra = undefined; // standing context is a help, never a reason to fail a request
    }
    return extra ? `${basePrompt}\n\n${extra}` : basePrompt;
  };

  return {
    get sessionId() {
      return sessionId;
    },

    async handle(input, signal, hooks) {
      const text = input.text.trim();
      if (!text) throw new CoreError("Empty request");
      if (busy) throw new CoreError("Still answering the previous request");

      const context: RequestContext = { requestId: newId(), sessionId, source: input.source, receivedAt: now() };
      const userTurn: Message = { role: "user", content: text };
      const sessionAtStart = sessionId;
      // Only record the exchange if it succeeded and the session was not reset meanwhile.
      const record = (replyText: string): ZenoResponse => {
        if (sessionId === sessionAtStart) {
          const assistantTurn: Message = { role: "assistant", content: replyText };
          turns = [...turns, userTurn, assistantTurn].slice(-maxTurns * 2);
          try {
            onExchange?.(sessionId, turns);
          } catch {
            // a summary is a help, never a reason to fail a reply
          }
        }
        return { requestId: context.requestId, text: replyText };
      };

      busy = true;
      try {
        if (shortcuts) {
          const quick = await shortcuts(text, signal);
          if (signal?.aborted) throw new CoreError("Request cancelled");
          if (quick?.trim()) return record(quick.trim());
        }

        let extra: string | undefined;
        try {
          extra = (await contextFor?.({ ...input, text }, context))?.trim() || undefined;
        } catch {
          extra = undefined; // memory is a help, never a reason to fail a request
        }
        const systemPrompt = fullPrompt();
        const systemExtra = { ...(extra ? { systemExtra: extra } : {}), ...(hooks?.onText ? { onText: hooks.onText } : {}) };

        // Tool rounds live only in this request's `messages`; session history keeps just the user turn and
        // the final answer, so a trimmed history can never hold half a tool exchange.
        const messages: Message[] = [...turns, userTurn];
        const specs = tools?.specs() ?? [];
        let reply = await model.complete({ system: systemPrompt, ...systemExtra, messages, context, ...(specs.length ? { tools: specs } : {}) }, signal);
        for (let round = 0; tools && reply.toolCalls?.length; round++) {
          if (signal?.aborted) throw new CoreError("Request cancelled");
          if (round >= maxToolRounds) {
            // Out of steps. Do not just fail: ask once, with no tools, for a short account of where it got stuck,
            // so the user hears why ("Brave has two windows open") and not a bare error.
            const wrapUp = await model.complete({ system: `${systemPrompt}\n\n${OUT_OF_STEPS}`, ...systemExtra, messages, context }, signal);
            if (signal?.aborted) throw new CoreError("Request cancelled");
            if (!wrapUp.text.trim() || wrapUp.toolCalls?.length) throw new CoreError("ATOM used too many steps on this request and stopped");
            reply = { text: wrapUp.text };
            break;
          }
          const calls = reply.toolCalls;
          const results = [];
          for (const call of calls) results.push(await tools.run(call, signal)); // one at a time, in order
          if (signal?.aborted) throw new CoreError("Request cancelled");
          messages.push({ role: "assistant", content: reply.text, toolCalls: calls }, { role: "user", content: "", toolResults: results });
          reply = await model.complete({ system: systemPrompt, ...systemExtra, messages, context, tools: specs }, signal);
        }
        if (signal?.aborted) throw new CoreError("Request cancelled");
        const replyText = reply.text.trim();
        if (!replyText) throw new CoreError("The model returned an empty reply");
        return record(replyText);
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

    resume(id, saved) {
      if (busy) throw new CoreError("Still answering the previous request");
      sessionId = id;
      // Whole user/assistant pairs only, so the history never starts with an answer.
      const pairs = saved.filter((m) => m.role === "user" || m.role === "assistant");
      const start = Math.max(0, pairs.length - maxTurns * 2);
      turns = pairs.slice(pairs[start]?.role === "assistant" ? start + 1 : start);
    },

    prepare() {
      const specs = tools?.specs() ?? [];
      model.prepare?.({ system: fullPrompt(), ...(specs.length ? { tools: specs } : {}) });
    },
  };
}
