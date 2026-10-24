import { useEffect, useRef } from "preact/hooks";
import { kb } from "./saved-chat.ts";
import type { RemembersState } from "./store.ts";
import type { RemembersApi } from "./useSavedChat.ts";

/** What the runtime keeps for this chat: the saved messages, and how much of them it replays to continue the conversation. */
export function Remembers({ remembers, api }: { remembers: RemembersState | undefined; api: RemembersApi }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = remembers !== undefined;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  const info = remembers?.info;
  return (
    <dialog ref={dialog} class="recovery remembers" aria-labelledby="remembers-title" onCancel={(e) => (e.preventDefault(), api.close())}>
      <header class="recovery-head">
        <h2 id="remembers-title" class="confirm-title">What this chat remembers</h2>
        <button type="button" class="btn btn-ghost" onClick={api.close}>Close</button>
      </header>
      <p>Your messages stay saved. ATOM uses recent messages to continue this conversation. Memory never grants file or tool access.</p>
      {remembers?.request ? <p class="small muted" role="status">Loading saved details…</p> : null}
      {remembers?.note ? <p class="recovery-notice" role="status">{remembers.note}</p> : null}
      {info ? (
        <>
          <p><strong>{info.messages}</strong> message{info.messages === 1 ? "" : "s"} saved</p>
          <details>
            <summary>Replay and context details</summary>
            <progress class="remembers-meter" max={Math.max(1, info.replayBudget)} value={Math.max(0, info.replayBytes)} aria-label="Replay estimate against its budget" />
            <p class="small">
              Fresh replay estimate: {kb(info.replayBytes)} of {kb(info.replayBudget)}. {info.omitted} earlier message{info.omitted === 1 ? "" : "s"} omitted from that estimate; the archive stays intact.
            </p>
            <p class="small muted">
              This byte estimate excludes system prompts, tools, in-flight input and SDK memory. It is not a provider token meter. ATOM manages replay automatically; manual Compact is unavailable.
            </p>
          </details>
          <p class="small muted">Automatic summaries of older messages are not available in this runtime yet, so nothing is summarized or derived from this chat.</p>
        </>
      ) : remembers && !remembers.request ? (
        <p class="muted">Send a message to save this chat, or refresh its details.</p>
      ) : null}
      <div class="brief-actions">
        <button type="button" class="btn btn-ghost" disabled={remembers?.request !== undefined} onClick={api.refresh}>Refresh saved details</button>
      </div>
    </dialog>
  );
}
