import type { Message } from "@atom/contracts";
import { ChatBusyError, type ChatTurns } from "./chat-turns.ts";

interface ApiTurnCore {
  resume(chat: string, messages: readonly Message[]): void;
  handle(input: { text: string; source: "text" }, signal?: AbortSignal): Promise<{ text: string }>;
}

interface ApiTurnOptions {
  chatTurns: ChatTurns;
  makeCore: () => ApiTurnCore;
  messages?: (chat: string) => readonly Message[];
}

/** Serializes API turns around the singleton Core, while rejecting a duplicate chat before it waits. */
export function createApiTurnRunner(options: ApiTurnOptions): (text: string, chatId?: string, signal?: AbortSignal) => Promise<string> {
  let core: ApiTurnCore | undefined;
  let currentChat = "";
  let queue: Promise<void> = Promise.resolve();

  return (text, chatId, signal) => {
    const chat = chatId ? `api-${chatId}` : "api";
    const busy = options.chatTurns.begin(chat, "api");
    if (busy) throw new ChatBusyError(busy);

    const run = async () => {
      try {
        core ??= options.makeCore();
        if (options.messages) core.resume(chat, options.messages(chat));
        else if (currentChat !== chat) core.resume(chat, []);
        currentChat = chat;
        return (await core.handle({ text, source: "text" }, signal)).text;
      } finally {
        options.chatTurns.end(chat, "api");
      }
    };
    const next = queue.then(run, run);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
