// ADR-097 item 3: the chats Keshab keeps in memory. Keeping one asks a model (no tools) for a summary and section
// headings; if that fails, a deterministic digest is used, so keeping never fails. Every request then gets the best
// matching lines (hybrid search, top-down). Logs carry ids, counts and states only, never chat text.

import { chatSections, digestBrief, fallbackDigest, keptChatContext, type ChatDigest, type Embed, type MemoryStore } from "@atom/memory";
import type { Logger } from "@atom/shared";
import type { Embedder } from "./embedder.ts";
import type { MemoryChatItem } from "./island-protocol.ts";

/** Recent chats offered on the Memory page. */
const RECENT_CHATS = 30;

export interface KeptChats {
  chats(): MemoryChatItem[];
  keep(id: string): boolean;
  drop(id: string): boolean;
  /** The best kept lines for this request, for the system prompt; undefined when none are kept or none match. */
  context(text: string): Promise<string | undefined>;
}

export interface KeptChatsOptions {
  memory: MemoryStore;
  embedder: Embedder;
  /** The model's digest of a chat brief, or a throw (then the deterministic digest is used). */
  digest(brief: string): Promise<ChatDigest>;
  /** Called when the list changes (keeping starts or ends, a chat is removed). */
  changed(): void;
  log: Pick<Logger, "info" | "warn" | "error" | "debug">;
}

export function createKeptChats({ memory, embedder, digest, changed, log }: KeptChatsOptions): KeptChats {
  const indexing = new Set<string>();
  const index = memory.chatIndex;
  const embed: Embed = (texts) => embedder.embed(texts);
  // Kept chats already: load the model now so the first request can search by meaning, and add any missing vectors.
  const warm = () =>
    void embedder.warm().then(async (ok) => {
      if (!ok) return;
      try {
        const added = await index.fillVectors(embed);
        if (added) log.info("memory.vectors_filled", { added });
      } catch (error) {
        log.warn("memory.vectors_fill_failed", { message: error instanceof Error ? error.message : String(error) });
      }
    });
  if (index.count() > 0) warm();

  const keepNow = async (id: string) => {
    const messages = memory.chats.messages(id);
    const title = memory.chats.list(RECENT_CHATS * 10).find((c) => c.id === id)?.title ?? "Chat";
    const sections = chatSections(messages);
    let made: ChatDigest;
    let source = "model";
    try {
      made = await digest(digestBrief(title, sections));
    } catch (error) {
      source = "fallback";
      log.warn("memory.digest_failed", { chat: id, message: error instanceof Error ? error.message : String(error) });
      made = fallbackDigest(title, sections);
    }
    const ok = await embedder.warm();
    const result = await index.keep(id, title, messages, made, ok ? embed : undefined);
    log.info("memory.chat_kept", { chat: id, digest: source, ...result });
  };

  return {
    chats() {
      const kept = new Map(index.kept().map((k) => [k.chatId, k]));
      const recent = memory.chats.list(RECENT_CHATS);
      const items: MemoryChatItem[] = recent.map((c) => {
        const k = kept.get(c.id);
        return {
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt.toISOString(),
          messages: c.messages,
          kept: Boolean(k),
          ...(indexing.has(c.id) ? { indexing: true } : {}),
          ...(k ? { keptAt: k.keptAt.toISOString() } : {}),
        };
      });
      const listed = new Set(recent.map((c) => c.id));
      for (const k of kept.values()) {
        if (!listed.has(k.chatId)) items.push({ id: k.chatId, title: k.title, messages: k.messages, kept: true, keptAt: k.keptAt.toISOString() });
      }
      return items;
    },

    keep(id) {
      if (indexing.has(id)) return true;
      if (!memory.chats.messages(id).length) return false;
      indexing.add(id);
      changed();
      void keepNow(id)
        .catch((error: unknown) => log.error("memory.chat_keep_failed", { chat: id, message: error instanceof Error ? error.message : String(error) }))
        .finally(() => {
          indexing.delete(id);
          changed();
        });
      return true;
    },

    drop(id) {
      const removed = index.drop(id);
      if (removed) changed();
      return removed;
    },

    async context(text) {
      if (index.count() === 0) return undefined;
      // Meaning only once the model is loaded: a request never waits for the download.
      const semantic = embedder.ready();
      if (!semantic) warm();
      const hits = await index.search(text, semantic ? embed : undefined);
      log.debug("memory.kept_chats", { hits: hits.length, semantic });
      return keptChatContext(hits);
    },
  };
}
