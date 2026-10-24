import { useEffect, useRef, useState } from "preact/hooks";
import { saveWhy, savedNote, validBrief } from "./brief.ts";
import type { BriefState } from "./store.ts";
import type { BriefApi } from "./useBrief.ts";

/**
 * The chat brief: background the user keeps for this chat. It goes with each request in this chat and grants nothing. Closing with
 * words that were not saved asks once, so a stray Escape does not lose them.
 */
export function Brief({ brief, currentChatId, busy, api }: { brief: BriefState | undefined; currentChatId: string | undefined; busy: string | undefined; api: BriefApi }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const open = brief !== undefined;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
    if (!open) {
      setDraft("");
      setDiscarding(false);
    }
  }, [open]);
  // Each load of the saved brief (the first, or "Replace draft with saved") replaces the draft once.
  const loads = brief?.loads ?? 0;
  useEffect(() => {
    if (loads > 0 && brief?.saved) setDraft(brief.saved.text);
    setDiscarding(false);
  }, [loads]);

  const saved = brief?.saved;
  const working = brief?.doing !== undefined;
  const changed = saved !== undefined && draft !== saved.text;
  const why = saveWhy({ onOriginalChat: currentChatId === brief?.chatId, draft, busy });
  const canSave = saved !== undefined && changed && !working && why === undefined;

  const close = () => {
    if (changed && !discarding) return setDiscarding(true);
    api.close();
  };
  const note = brief?.result === "saved" && saved ? savedNote(draft, saved.text) : brief?.note;
  const status = working ? (brief!.doing!.what === "saving" ? "Saving…" : "Loading the saved brief…") : note;

  return (
    <dialog
      ref={dialog}
      class="recovery brief"
      aria-labelledby="brief-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (canSave) api.save(draft);
        }
      }}
    >
      <header class="recovery-head">
        <h2 id="brief-title" class="confirm-title">Chat brief</h2>
        <button type="button" class="btn btn-ghost" onClick={close}>Close</button>
      </header>
      <p>Keep the project, decisions and next step here. Your saved brief accompanies each request in this chat, including after restarting or changing models.</p>
      <label class="field">
        <span class="field-label">Brief for this chat</span>
        <textarea
          class="brief-text"
          rows={8}
          value={draft}
          disabled={saved === undefined && working}
          aria-invalid={!validBrief(draft) ? "true" : undefined}
          onInput={(e) => {
            setDraft(e.currentTarget.value);
            setDiscarding(false);
          }}
        />
      </label>
      <p class="small muted">
        Shared with this chat’s model when you send. It does not grant file access or become global memory. Other chats and forks start without this brief. Clear the text and save to stop including it in future requests. Earlier versions may remain in the model’s session.
      </p>
      {why && changed ? <p class="small brief-why" role="status">{why}</p> : null}
      {status ? <p class={`small ${brief?.result === "problem" ? "brief-bad" : "muted"}`} role="status">{status}</p> : null}
      {discarding ? (
        <p class="small brief-bad" role="status">
          You have words that are not saved.{" "}
          <button type="button" class="link-btn" onClick={api.close}>Discard them and close</button>
          {" "}or{" "}
          <button type="button" class="link-btn" onClick={() => setDiscarding(false)}>keep editing</button>.
        </p>
      ) : null}
      {brief?.unconfirmed && !working ? (
        <p>
          <button type="button" class="btn btn-ghost" onClick={api.check}>Check save result</button>
        </p>
      ) : null}
      <div class="brief-actions">
        <button type="button" class="btn btn-ghost" disabled={working || currentChatId !== brief?.chatId || busy !== undefined} title={busy} onClick={api.reload}>Replace draft with saved</button>
        <button type="button" class="btn btn-primary" disabled={!canSave} title={why} onClick={() => api.save(draft)}>
          {brief?.doing?.what === "saving" ? "Saving…" : "Save for this chat"}
        </button>
      </div>
    </dialog>
  );
}
