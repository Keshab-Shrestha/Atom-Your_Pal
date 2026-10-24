// Saved history and "What this chat remembers": read-only questions to the runtime about the saved archive. Nothing here changes a chat.
// A page carries the revision it was read at; Next and Previous send it back, so a chat that changed meanwhile is refused instead of mixed.

import { useCallback } from "preact/hooks";
import type { Dispatch } from "preact/hooks";
import { newUuid } from "./ids.ts";
import type { IslandCommand } from "./protocol.ts";
import { FIRST, latestCursor, type Cursor } from "./saved-chat.ts";
import type { Action, AppState } from "./store.ts";

const PATIENCE_MS = 10_000;

export interface HistoryApi {
  open: (chatId: string) => void;
  reload: () => void;
  next: () => void;
  previous: () => void;
  /** The newest messages of the chat; `count` is how many are saved. */
  latest: (count: number) => void;
  close: () => void;
}

export interface RemembersApi {
  open: (chatId: string) => void;
  refresh: () => void;
  close: () => void;
}

export function useSavedChat(options: { state: AppState; dispatch: Dispatch<Action>; send: (command: IslandCommand) => Promise<boolean> }): { history: HistoryApi; remembers: RemembersApi } {
  const { state, dispatch, send } = options;
  const h = state.history;

  const read = useCallback(
    (chatId: string, cursor: Cursor, previous: Cursor[], revision?: string) => {
      const request = newUuid();
      dispatch({ kind: "historyAsk", chatId, request, cursor, previous });
      void send({ type: "chat.control", action: "page", id: chatId, request, message: cursor.message, offset: cursor.offset, ...(revision ? { revision } : {}) }).then((ok) => ok || dispatch({ kind: "historyTimeout", request }));
      setTimeout(() => dispatch({ kind: "historyTimeout", request }), PATIENCE_MS);
    },
    [send, dispatch],
  );
  const history: HistoryApi = {
    open: (chatId) => read(chatId, FIRST, []),
    reload: () => h && !h.reading && read(h.chatId, FIRST, []),
    next: () => h && !h.reading && h.page?.next && read(h.chatId, h.page.next, [...h.previous, h.cursor], h.page.revision),
    previous: () => {
      if (!h || h.reading || h.previous.length === 0) return;
      read(h.chatId, h.previous[h.previous.length - 1]!, h.previous.slice(0, -1), h.page?.revision);
    },
    latest: (count) => h && !h.reading && read(h.chatId, latestCursor(count), []),
    close: () => dispatch({ kind: "historyClose" }),
  };

  const inspect = useCallback(
    (chatId: string) => {
      const request = newUuid();
      dispatch({ kind: "remembersAsk", chatId, request });
      void send({ type: "chat.control", action: "inspect", id: chatId, request }).then((ok) => ok || dispatch({ kind: "remembersTimeout", request }));
      setTimeout(() => dispatch({ kind: "remembersTimeout", request }), PATIENCE_MS);
    },
    [send, dispatch],
  );
  const r = state.remembers;
  const remembers: RemembersApi = {
    open: inspect,
    refresh: () => r && !r.request && inspect(r.chatId),
    close: () => dispatch({ kind: "remembersClose" }),
  };
  return { history, remembers };
}
