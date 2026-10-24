// The Recovery view's conversation with the runtime (ADR-157): list what it retained, read one record in parts, dismiss one, and restore a
// prompt to the draft. It also keeps the journal tidy: a completed reply that is saved with the chat is acknowledged, so its copy is scrubbed.
// Nothing here ever resends anything.

import { useCallback, useEffect, useRef } from "preact/hooks";
import type { Dispatch } from "preact/hooks";
import type { Insertion } from "./Composer.tsx";
import { newUuid } from "./ids.ts";
import type { Attempt, IslandCommand, RecoveryRecord } from "./protocol.ts";
import { draftText, needsReview, restoreWhy, restoredNote } from "./recovery.ts";
import { settingsWhy, type Action, type AppState } from "./store.ts";

const PATIENCE_MS = 10_000;

export interface RecoveryApi {
  /** Retained requests that need a look. */
  count: number;
  open: () => void;
  close: () => void;
  refresh: () => void;
  read: (id: string, offset?: number) => void;
  dismiss: (id: string) => void;
  /** Why the prompt cannot be restored to the draft now. */
  restoreWhy: (record: RecoveryRecord) => string | undefined;
  restore: (record: RecoveryRecord) => void;
  openChat: (id: string) => void;
  /** Why the source chat cannot be opened now. */
  openChatWhy: (chat: string) => string | undefined;
}

export function useRecovery(options: {
  state: AppState;
  dispatch: Dispatch<Action>;
  send: (command: IslandCommand) => Promise<boolean>;
  pendingIds: () => string[];
  /** Saved drafts have been read, so the held messages that the first list asks about are known. */
  inputsLoaded: boolean;
  offer: (insertion: Omit<Insertion, "seq">) => void;
  toast: (text: string) => void;
}): RecoveryApi {
  const { state, dispatch, send, pendingIds, inputsLoaded, offer, toast } = options;

  const ask = useCallback(
    (what: "listing" | "reading" | "dismissing", command: (request: string) => IslandCommand, keep = false) => {
      const request = newUuid();
      dispatch({ kind: "recoveryAsk", what, request, ...(keep ? { keep } : {}) });
      void send(command(request)).then((ok) => ok || dispatch({ kind: "recoveryTimeout", request }));
      setTimeout(() => dispatch({ kind: "recoveryTimeout", request }), PATIENCE_MS);
    },
    [send, dispatch],
  );
  const refresh = useCallback(() => ask("listing", (request) => ({ type: "foreground.list", request, pending: pendingIds(), pendingAnswers: [] })), [ask, pendingIds]);

  // Look once the runtime is ready, and after every receipt (a request began, finished, failed, was stopped), a moment later so a burst is one look.
  const ready = state.link === "live" && state.runtime.state === "running" && state.ready !== undefined;
  useEffect(() => {
    if (ready && inputsLoaded) refresh();
  }, [ready, inputsLoaded]);
  const receiptN = state.receipt?.n;
  useEffect(() => {
    if (!receiptN || !ready) return;
    const timer = setTimeout(refresh, 300);
    return () => clearTimeout(timer);
  }, [receiptN]);

  // After a dismissal is answered, look again.
  const wasDismissing = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (wasDismissing.current && !state.recovery.dismissing) refresh();
    wasDismissing.current = state.recovery.dismissing;
  }, [state.recovery.dismissing]);

  // A completed reply that is saved with the chat is acknowledged once, so the journal scrubs its copy.
  const acked = useRef(new Set<string>());
  useEffect(() => {
    const r = state.receipt;
    if (!r || r.state !== "completed" || !r.archived || acked.current.has(r.id)) return;
    acked.current.add(r.id);
    void send({ type: "foreground.ack", id: r.id });
  }, [receiptN]);

  const composerWhy = settingsWhy(state);
  const chatsById = new Map(state.chats.map((c) => [c.id, c]));
  return {
    count: state.recovery.attempts.filter((a: Attempt) => needsReview(a)).length,
    open: () => {
      dispatch({ kind: "recoveryOpen", open: true });
      refresh();
    },
    close: () => dispatch({ kind: "recoveryOpen", open: false }),
    refresh,
    read: (id, offset = 0) => ask("reading", (request) => ({ type: "foreground.read", request, id, offset }), state.recovery.record?.id === id),
    dismiss: (id) => {
      if (!state.recovery.dismissing) ask("dismissing", (request) => ({ type: "foreground.dismiss", request, id }));
    },
    restoreWhy: (record) => restoreWhy(record, state.chats.length === 0 ? "ATOM has no chat open." : composerWhy),
    restore: (record) => {
      if (restoreWhy(record, composerWhy)) return;
      // Into the current chat's composer only if it is empty; never sent, never replaced.
      offer({
        mode: "restore",
        text: draftText(record),
        refusal: "Clear the composer first, then restore the prompt.",
        done: (placed) => {
          if (placed) {
            dispatch({ kind: "recoveryOpen", open: false });
            toast(restoredNote(record));
          } else dispatch({ kind: "recoveryNotice", notice: "Use an empty composer in a writable, idle chat. Nothing was restored." });
        },
      });
    },
    openChat: (id) => void send({ type: "chat.open", id }).then(() => dispatch({ kind: "recoveryOpen", open: false })),
    openChatWhy: (chat) => (chatsById.has(chat) ? (state.loop !== "idle" ? "Finish or stop the active turn first." : undefined) : "That chat is not in the list (it was never saved, or was deleted)."),
  };
}
