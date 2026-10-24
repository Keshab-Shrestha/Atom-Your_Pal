import type { Approval, Work } from "./store.ts";

export interface WorkBarProps {
  work: Work | undefined;
  approval: Approval | undefined;
  onStop: () => void;
  onAnswer: (approved: boolean, rememberFile?: boolean) => void;
}

const ENDED: Record<string, string> = { done: "Done", stopped: "Stopped", failed: "Couldn't finish" };

/**
 * What ATOM is doing on the computer, and the one question it waits on. A port of the Swift work strip (ADR-056), drawn inside the chat.
 * It never takes keyboard focus when a question appears: a key typed a moment before cannot answer it. It is announced instead.
 */
export function WorkBar({ work, approval, onStop, onAnswer }: WorkBarProps) {
  if (approval) {
    const allowLabel = approval.accessChange ? "Enable Full access" : approval.rememberFile ? "Allow for this task" : "Allow";
    return (
      <section class={`workbar workbar-ask${approval.accessChange ? " workbar-wide" : ""}`} role="group" aria-labelledby="ask-title" aria-live="assertive">
        <p id="ask-title" class="ask-title">ATOM asks</p>
        <p class="ask-summary">{approval.summary}</p>
        <p class={approval.accessChange ? "ask-reason ask-reason-full" : "ask-reason"}>{approval.reason}</p>
        {approval.review ? (
          <p class="muted small">This edit needs the detailed review, which is not in this window yet. You can decline it here, or answer it in the Mac app.</p>
        ) : null}
        <div class="ask-actions">
          <button type="button" class="btn" onClick={() => onAnswer(false)}>Decline</button>
          {approval.review ? null : (
            <>
              <button type="button" class="btn btn-primary" onClick={() => onAnswer(true, false)}>{allowLabel}</button>
              {approval.rememberFile ? (
                <button type="button" class="btn btn-primary" onClick={() => onAnswer(true, true)}>Allow for this chat</button>
              ) : null}
            </>
          )}
        </div>
        <p class="muted small">If you don't answer, ATOM declines after a minute.</p>
      </section>
    );
  }
  if (!work) return null;
  if (work.outcome === "working") {
    return (
      <section class="workbar" role="status" aria-label="ATOM is working on your computer">
        <span class="pulse" aria-hidden="true" />
        <span class="work-line">{work.step || "Working on your computer"}</span>
        <button type="button" class="btn btn-ghost" onClick={onStop}>Stop</button>
      </section>
    );
  }
  return (
    <section class={`workbar workbar-${work.outcome}`} role="status">
      <span class="work-line">{ENDED[work.outcome]}</span>
    </section>
  );
}
