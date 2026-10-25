import { useEffect, useRef, useState } from "preact/hooks";
import { MAX_ANSWER_UNITS, answerWhy } from "./input.ts";
import type { ChatWorkEvent } from "./protocol.ts";

export type Question = ChatWorkEvent["questions"][number];
export type AnswerOutcome = { ok: true } | { ok: false; why?: string };

/**
 * One question ATOM asks while it works (ADR-156): suggestions to pick, a box for the user's own words, and Skip. It is clarification, not
 * permission. It never takes keyboard focus when it appears, so a key typed a moment earlier cannot answer it, and Enter in the message box
 * never answers it. The answer is written down by the window before it is sent; the card then waits for the runtime to confirm.
 */
export function QuestionCard({ question, onAnswer }: { question: Question; onAnswer: (text: string | undefined) => Promise<AnswerOutcome> }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  // The runtime tells why a saved answer was refused by repeating the card with an error: then the card can be tried again.
  const error = question.error;
  useEffect(() => {
    if (error) setSent(false);
  }, [error]);
  const area = useRef<HTMLTextAreaElement>(null);
  const why = answerWhy(text);

  async function submit(answer: string | undefined) {
    if (sent) return;
    if (answer !== undefined) {
      const refused = answerWhy(answer);
      if (refused) return setNote(refused);
    }
    setNote(undefined);
    setSent(true);
    const outcome = await onAnswer(answer);
    if (!outcome.ok) {
      setSent(false);
      setNote(outcome.why ?? "The answer was not sent. Try again, or Skip.");
    }
  }

  return (
    <section class="question" role="group" aria-labelledby="question-title" aria-live="assertive" aria-busy={sent}>
      <p id="question-title" class="ask-title">ATOM asks</p>
      <p class="question-prompt">{question.prompt}</p>
      {error ? <p class="question-error" role="alert">{error}</p> : null}
      {question.choices.length > 0 ? (
        <ul class="question-choices" aria-label="Suggested answers">
          {question.choices.map((choice) => (
            <li key={choice}>
              <button type="button" class="btn" disabled={sent} onClick={() => void submit(choice)}>{choice}</button>
            </li>
          ))}
        </ul>
      ) : null}
      <label class="field">
        <span class="field-label">Your answer</span>
        <textarea
          ref={area}
          rows={2}
          value={text}
          disabled={sent}
          maxLength={MAX_ANSWER_UNITS}
          aria-label="Answer to ATOM's question"
          onInput={(e) => {
            setText(e.currentTarget.value);
            setNote(undefined);
          }}
          onKeyDown={(e) => {
            // Ctrl or Cmd+Enter sends; a plain Enter is a new line, so an answer is never sent by a stray key.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing && !why) {
              e.preventDefault();
              void submit(text);
            }
          }}
        />
      </label>
      <div class="ask-actions">
        <button type="button" class="btn btn-primary" disabled={sent || why !== undefined} onClick={() => void submit(text)}>Send answer</button>
        <button type="button" class="btn btn-ghost" disabled={sent} onClick={() => void submit(undefined)}>Skip</button>
        {sent ? <span class="small muted" role="status">Waiting for confirmation…</span> : null}
      </div>
      {note ? <p class="small question-error" role="status">{note}</p> : null}
      <p class="small muted">
        Answering gives clarification, not file or system permission. Do not enter passwords or secrets. ATOM waits up to 90 seconds, then carries on without an answer. The message box queues a new message instead.
      </p>
    </section>
  );
}
