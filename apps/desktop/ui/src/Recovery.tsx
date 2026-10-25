import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons.tsx";
import { writeClipboard } from "./clipboard.ts";
import { dismissWhy, draftText, fileNames, needsReview, stateWord } from "./recovery.ts";
import type { ChatItem } from "./protocol.ts";
import type { RecoveryState } from "./store.ts";
import type { RecoveryApi } from "./useRecovery.ts";

/** Retained requests, for review. It restores an unsent draft and never repeats work: a missing reply does not prove that nothing happened. */
export function Recovery({ state, chats, api }: { state: RecoveryState; chats: ChatItem[]; api: RecoveryApi }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  // The local copy of an answer being dismissed, asked about first. Keep is where focus starts.
  const [dismissing, setDismissing] = useState<string | undefined>();
  const keepAnswer = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (dismissing) keepAnswer.current?.focus();
  }, [dismissing]);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (state.open && !el.open) el.showModal();
    if (!state.open && el.open) el.close();
  }, [state.open]);
  useEffect(() => setConfirming(false), [state.record?.id]);
  // A question that asks for a decision starts on the safe choice.
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);

  const title = (id: string) => chats.find((c) => c.id === id)?.title ?? `Unfinished chat (${id.slice(0, 12)})`;
  const record = state.record;
  const busy = state.listing !== undefined || state.reading !== undefined;
  const restoreProblem = record ? api.restoreWhy(record) : undefined;
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  return (
    <dialog ref={dialog} class="recovery" aria-labelledby="recovery-title" onCancel={(e) => (e.preventDefault(), api.close())}>
      <header class="recovery-head">
        <h2 id="recovery-title" class="confirm-title">Recovery</h2>
        <div class="recovery-actions">
          <button type="button" class="btn btn-ghost" onClick={api.refresh} disabled={state.listing !== undefined}>Refresh</button>
          <button type="button" class="btn btn-ghost" onClick={api.close} autofocus>Close</button>
        </div>
      </header>
      <p class="small muted">A missing reply does not prove nothing happened. Review the saved chat and any file changes before retrying. Recovery restores an unsent draft; it never repeats work by itself.</p>
      {state.notice ? <p class="recovery-notice" role="status">{state.notice}</p> : null}
      {busy ? <p class="small muted" role="status">Checking saved records…</p> : null}

      {api.answers.length > 0 ? (
        <ul class="recovery-list" aria-label="Answers not confirmed">
          {api.answers.map((a) => (
            <li key={a.id} class="recovery-answer">
              <p class="recovery-title">Answer not confirmed · {title(a.chat)}</p>
              <p class="small muted">You answered one of ATOM's questions, but ATOM never confirmed that it received the answer. It may have; check the chat before relying on it.</p>
              <p class="small"><strong>Question:</strong> {a.question}</p>
              <p class="small recovery-answer-text"><strong>Your answer:</strong> {a.answer}</p>
              {dismissing === a.id ? (
                <div class="recovery-confirm" role="group" aria-label="Dismiss the local answer copy?">
                  <p class="small">Dismiss the local answer copy? Copy it first if you need it. This does not cancel or reverse any answer ATOM already received.</p>
                  <div class="recovery-actions">
                    <button type="button" class="btn" ref={keepAnswer} onClick={() => setDismissing(undefined)}>Keep</button>
                    <button type="button" class="btn btn-danger" onClick={() => (setDismissing(undefined), api.dismissAnswer(a.id))}>Dismiss</button>
                  </div>
                </div>
              ) : (
                <div class="recovery-actions">
                  <button type="button" class="btn btn-ghost" onClick={() => void writeClipboard({ text: `${a.question}\n${a.answer}` })}><Icon name="copy" size={14} /> Copy question and answer</button>
                  <button type="button" class="btn btn-ghost" onClick={() => setDismissing(a.id)}>Dismiss local copy…</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <ul class="recovery-list" aria-label="Retained requests">
        {state.attempts.map((a) => (
          <li key={a.id} class="recovery-row">
            <div>
              <p class="recovery-title">{title(a.chat)}</p>
              <p class="small muted">
                {stateWord(a.state)} · {when(a.createdAt)}
                {a.answerCount > 0 ? ` · ${a.answerCount} saved answer${a.answerCount === 1 ? "" : "s"}` : ""}
                {a.archived ? " · reply is saved with the chat" : a.hasReply ? " · a reply is kept here" : ""}
                {needsReview(a) ? "" : " · nothing to do"}
              </p>
            </div>
            <button type="button" class="btn btn-ghost" disabled={state.reading !== undefined} onClick={() => api.read(a.id)}>Review</button>
          </li>
        ))}
        {state.attempts.length === 0 && api.answers.length === 0 && !busy ? (
          <li class="muted">No retained requests. Held messages stay in their own chat.</li>
        ) : null}
      </ul>

      {record ? (
        <section class="recovery-detail" aria-label="Selected request">
          <h3 class="recovery-title">{stateWord(record.state)} · {title(record.chat)}</h3>
          <p class="small muted">Chosen when it was accepted: {record.provider ?? "unknown"} · {record.model ?? "unknown"}</p>
          <pre class="recovery-text" tabIndex={0} aria-label="Prompt">{draftText(record)}</pre>
          {record.files.length > 0 ? <p class="small">Files it carried: {fileNames(record.files).join(", ")}. They cannot be attached again from here.</p> : null}
          {record.notes.length > 0 ? <p class="small">Saved note references: {record.notes.join(", ")}.</p> : null}
          <div class="recovery-actions">
            <button type="button" class="btn btn-ghost" onClick={() => void writeClipboard({ text: draftText(record) })}><Icon name="copy" size={14} /> Copy prompt and answers</button>
            <button type="button" class="btn btn-ghost" disabled={Boolean(api.openChatWhy(record.chat))} title={api.openChatWhy(record.chat)} onClick={() => api.openChat(record.chat)}>Open source chat</button>
            <button type="button" class="btn btn-primary" disabled={Boolean(restoreProblem)} title={restoreProblem} onClick={() => api.restore(record)}>Restore to current empty draft</button>
          </div>
          {restoreProblem ? <p class="small muted">{restoreProblem}</p> : <p class="small muted">Restoring uses the current chat's model, project and permissions. It is not sent until you press Send.</p>}
          {record.reply !== "" ? (
            <div>
              <p class="small recovery-title">Kept reply · from character {record.offset}</p>
              <pre class="recovery-text" tabIndex={0} aria-label="Reply part">{record.reply}</pre>
              <div class="recovery-actions">
                <button type="button" class="btn btn-ghost" onClick={() => void writeClipboard({ text: record.reply })}>Copy this part</button>
                <button type="button" class="btn btn-ghost" disabled={record.offset === 0} onClick={() => api.read(record.id)}>First part</button>
                {record.nextOffset !== undefined ? <button type="button" class="btn btn-ghost" onClick={() => api.read(record.id, record.nextOffset)}>Next part</button> : null}
              </div>
            </div>
          ) : null}
          {confirming ? (
            <div class="recovery-confirm" role="group" aria-label="Dismiss this recovery copy?">
              <p class="small">Dismiss this recovery copy? This clears its prompt, answers and reply. It does not undo file or network actions or delete the saved chat. Its delivery id remains, so an old request cannot run again.</p>
              <div class="recovery-actions">
                <button type="button" class="btn" ref={keep} onClick={() => setConfirming(false)}>Keep</button>
                <button type="button" class="btn btn-danger" onClick={() => (setConfirming(false), api.dismiss(record.id))}>Dismiss</button>
              </div>
            </div>
          ) : (
            <button type="button" class="btn btn-ghost" disabled={Boolean(dismissWhy(record.state)) || state.dismissing !== undefined} title={dismissWhy(record.state)} onClick={() => setConfirming(true)}>Dismiss recovery copy…</button>
          )}
        </section>
      ) : null}
    </dialog>
  );
}
