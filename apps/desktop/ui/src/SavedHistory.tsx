import { useEffect, useRef } from "preact/hooks";
import type { ClipContent } from "./copy.ts";
import { partLabel } from "./saved-chat.ts";
import type { HistoryState } from "./store.ts";
import type { HistoryApi } from "./useSavedChat.ts";

/**
 * Read-only pages of this chat's saved archive. Edit, Retry and Fork copy the chat into a NEW chat as it was when the page was read
 * (the page's revision goes with the request); the saved chat itself is never changed, and effects of earlier work are not undone.
 */
export function SavedHistory({ history, savedCount, branchWhy, api, onCopy, onBranch }: {
  history: HistoryState | undefined;
  /** How many messages the chat list says are saved: where "Latest saved" starts. */
  savedCount: number;
  /** Why a chat cannot be copied into a new one right now; undefined when it can. */
  branchWhy: string | undefined;
  api: HistoryApi;
  onCopy: (content: ClipContent) => void;
  onBranch: (kind: "fork" | "edit" | "retry", through: number, revision: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = history !== undefined;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  const reading = history?.reading !== undefined;
  const page = history?.page;
  const revision = page?.revision;
  const why = branchWhy ?? (revision ? undefined : "The page has no saved version to copy from. Reload it first.");

  return (
    <dialog ref={dialog} class="recovery history" aria-labelledby="history-title" onCancel={(e) => (e.preventDefault(), api.close())}>
      <header class="recovery-head">
        <h2 id="history-title" class="confirm-title">Saved history</h2>
        <button type="button" class="btn btn-ghost" onClick={api.close}>Close</button>
      </header>
      <p class="small muted">Read-only pages from the saved archive. Editing or retrying creates a new chat before that message; review it before sending. Existing file and network effects are not undone.</p>
      <div class="recovery-actions history-nav" role="group" aria-label="Pages">
        <button type="button" class="btn btn-ghost" disabled={reading} onClick={api.reload}>First / Reload</button>
        <button type="button" class="btn btn-ghost" disabled={reading || !history || history.previous.length === 0} onClick={api.previous}>Previous</button>
        <button type="button" class="btn btn-ghost" disabled={reading || !page?.next} onClick={api.next}>Next</button>
        <button type="button" class="btn btn-ghost" disabled={reading || savedCount === 0} onClick={() => api.latest(savedCount)}>Latest saved</button>
      </div>
      {reading ? <p class="small muted" role="status">Loading saved messages…</p> : null}
      {history?.note ? <p class="recovery-notice" role="status">{history.note}</p> : null}
      <ol class="history-parts" aria-label="Saved messages">
        {(page?.parts ?? []).map((part) => (
          <li key={`${part.seq}-${part.offset}`} class="history-part">
            <p class="small muted history-label">{partLabel(part)}</p>
            <p class="history-text">{part.text}</p>
            <div class="history-actions">
              <button type="button" class="link-btn" onClick={() => onCopy({ text: part.text })}>Copy this part</button>
              {part.role === "user" ? (
                <>
                  <button type="button" class="link-btn" disabled={why !== undefined} title={why} onClick={() => onBranch("edit", part.seq, revision!)}>Edit in new chat</button>
                  <button type="button" class="link-btn" disabled={why !== undefined} title={why} onClick={() => onBranch("retry", part.seq, revision!)}>Retry in new chat</button>
                </>
              ) : null}
              <button type="button" class="link-btn" disabled={why !== undefined} title={why} onClick={() => onBranch("fork", part.seq, revision!)}>Fork through here</button>
            </div>
          </li>
        ))}
      </ol>
      {page && page.parts.length === 0 ? <p class="muted">No saved messages on this page.</p> : null}
    </dialog>
  );
}
