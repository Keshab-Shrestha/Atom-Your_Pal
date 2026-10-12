// ADR-098: ZENO's own Telegram bot, over the Bot API with Node's fetch. One chat only (ZENO_TELEGRAM_CHAT_ID); every
// other chat is ignored. The log gets method names, error codes and counts: never message text, never the token.

import type { Logger } from "@zeno/shared";

const API = "https://api.telegram.org";
/** Telegram's limit for one message. */
export const MESSAGE_LIMIT = 4096;
/** How long one getUpdates call waits for something new. */
const POLL_SECONDS = 50;
const FIRST_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** A send or a button answer that takes longer than this has failed. */
const CALL_TIMEOUT_MS = 20_000;

/** One inline button. `data` is at most 64 bytes (Telegram's limit for callback data). */
export interface Button {
  text: string;
  data: string;
}

/** What Keshab sent: a text message, or a press on one of the bot's buttons. */
export type TelegramInput = { kind: "text"; text: string } | { kind: "button"; data: string; queryId: string };

export interface TelegramClient {
  /** Plain text (no Markdown, so nothing in it can break the message), split at MESSAGE_LIMIT. Buttons go on the last part. */
  send(text: string, buttons?: Button[][]): Promise<void>;
  /** Ends a button's spinner, with a short toast. */
  answer(queryId: string, text?: string): Promise<void>;
  /** Stops polling. A call in flight is aborted. */
  stop(): void;
}

export interface TelegramOptions {
  token: string;
  /** The one chat ZENO serves. */
  chatId: string;
  onInput(input: TelegramInput): void;
  log: Logger;
  fetch?: typeof fetch;
}

class TelegramError extends Error {
  readonly code: number;
  constructor(method: string, code: number) {
    super(`Telegram ${method} failed (${code}).`);
    this.name = "TelegramError";
    this.code = code;
  }
}

interface RawUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

/** Splits text into parts of at most `limit` characters, at a line break when one is near the end. */
export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  const parts: string[] = [];
  let rest = text.trim() || "…";
  while (rest.length > limit) {
    const cut = rest.lastIndexOf("\n", limit);
    const at = cut > limit / 2 ? cut : limit;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, "");
  }
  parts.push(rest);
  return parts;
}

/** Starts long polling. Errors back off (1 s, doubling, at most 60 s); stop() ends it cleanly. */
export function startTelegram(options: TelegramOptions): TelegramClient {
  const { token, chatId, onInput, log, fetch: fetchFn = fetch } = options;
  const stopping = new AbortController();
  let offset = 0;
  let ignored = 0;

  async function call<T>(method: string, body: object, timeoutMs: number): Promise<T> {
    const signal = AbortSignal.any([stopping.signal, AbortSignal.timeout(timeoutMs)]);
    const response = await fetchFn(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const json = (await response.json().catch(() => ({ ok: false }))) as { ok: boolean; result?: T; error_code?: number };
    if (!json.ok) throw new TelegramError(method, json.error_code ?? response.status);
    return json.result as T;
  }

  // Only what is safe to log: the method and the code, never a message (a fetch error could hold the URL with the token).
  const codeOf = (error: unknown) => (error instanceof TelegramError ? error.code : error instanceof Error ? error.name : "unknown");

  function take(update: RawUpdate) {
    const from = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (from === undefined || String(from) !== chatId) {
      ignored++;
      log.info("telegram.ignored", { count: ignored });
      return;
    }
    if (update.callback_query) {
      onInput({ kind: "button", data: update.callback_query.data ?? "", queryId: update.callback_query.id });
    } else if (update.message) {
      onInput({ kind: "text", text: update.message.text ?? "" });
    }
  }

  async function poll() {
    let backoff = FIRST_BACKOFF_MS;
    while (!stopping.signal.aborted) {
      try {
        const updates = await call<RawUpdate[]>(
          "getUpdates",
          { offset, timeout: POLL_SECONDS, allowed_updates: ["message", "callback_query"] },
          (POLL_SECONDS + 15) * 1000,
        );
        backoff = FIRST_BACKOFF_MS;
        for (const update of updates) {
          offset = update.update_id + 1;
          take(update);
        }
      } catch (error) {
        if (stopping.signal.aborted) return;
        log.warn("telegram.poll_failed", { code: codeOf(error), retryMs: backoff });
        await new Promise((resolve) => setTimeout(resolve, backoff).unref());
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  void poll();
  log.info("telegram.start");

  return {
    async send(text, buttons) {
      const parts = splitMessage(text);
      for (const [i, part] of parts.entries()) {
        const markup =
          buttons?.length && i === parts.length - 1
            ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } }
            : {};
        try {
          await call("sendMessage", { chat_id: chatId, text: part, ...markup }, CALL_TIMEOUT_MS);
        } catch (error) {
          log.warn("telegram.send_failed", { code: codeOf(error) });
          return;
        }
      }
    },
    async answer(queryId, text) {
      try {
        await call("answerCallbackQuery", { callback_query_id: queryId, ...(text ? { text: text.slice(0, 200) } : {}) }, CALL_TIMEOUT_MS);
      } catch (error) {
        log.warn("telegram.answer_failed", { code: codeOf(error) });
      }
    },
    stop() {
      stopping.abort();
      log.info("telegram.stop");
    },
  };
}
