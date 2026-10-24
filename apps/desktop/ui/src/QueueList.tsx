import { Icon } from "./icons.tsx";
import type { Entry } from "./input.ts";

export interface QueueListProps {
  queue: Entry[];
  held: Entry[];
  /** The entry whose turn has been asked for and has not started. */
  sending: string | undefined;
  /** A turn is running: sending the oldest now ends it. */
  working: boolean;
  /** Why nothing can be sent now; undefined when it can. */
  blocked: string | undefined;
  onSendNow: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

const first = (text: string) => (text.split("\n").find((l) => l.trim() !== "") ?? "").trim() || "(files only)";

function Row({ entry, children, tag }: { entry: Entry; children: preact.ComponentChildren; tag?: string }) {
  const files = entry.files.length;
  return (
    <li class="q-row">
      <div class="q-main">
        {tag ? <span class="tag">{tag}</span> : null}
        <span class="q-text">{first(entry.text)}</span>
        {files > 0 ? <span class="muted small">{files} file{files === 1 ? "" : "s"}</span> : null}
        {entry.lost > 0 ? <span class="small q-lost">{entry.lost} file{entry.lost === 1 ? " was" : "s were"} not kept. Attach {entry.lost === 1 ? "it" : "them"} again.</span> : null}
      </div>
      <div class="q-actions">{children}</div>
    </li>
  );
}

/** Messages waiting to go (in order) and messages held for review. Held ones are never sent by themselves. */
export function QueueList({ queue, held, sending, working, blocked, onSendNow, onEdit, onRemove }: QueueListProps) {
  if (queue.length === 0 && held.length === 0) return null;
  return (
    <section class="queue" aria-label="Waiting messages">
      {queue.length > 0 ? (
        <>
          <p class="eyebrow q-title"><Icon name="queue" size={14} /> Waiting to be sent · {queue.length}</p>
          <ol class="q-list">
            {queue.map((entry, i) => (
              <Row key={entry.id} entry={entry} tag={entry.id === sending ? "Sending…" : i === 0 ? "Next" : undefined}>
                {i === 0 && entry.id !== sending ? (
                  <button type="button" class="btn btn-ghost" disabled={Boolean(blocked)} title={working ? "Send this now. This stops the turn that is running." : "Send this now"} onClick={onSendNow}>
                    {working ? "Send now, stop current" : "Send now"}
                  </button>
                ) : null}
                <button type="button" class="btn btn-ghost" disabled={entry.id === sending} aria-label={`Edit waiting message: ${first(entry.text)}`} onClick={() => onEdit(entry.id)}>Edit</button>
                <button type="button" class="btn btn-ghost" disabled={entry.id === sending} aria-label={`Remove waiting message: ${first(entry.text)}`} onClick={() => onRemove(entry.id)}>Remove</button>
              </Row>
            ))}
          </ol>
        </>
      ) : null}
      {held.length > 0 ? (
        <>
          <p class="eyebrow q-title q-held-title">Held for review · {held.length}</p>
          <p class="small muted q-held-note">These were not sent: the chat was stopped, changed or restarted. Nothing here is sent by itself.</p>
          <ol class="q-list">
            {held.map((entry) => (
              <Row key={entry.id} entry={entry} tag="Held">
                <button type="button" class="btn btn-ghost" aria-label={`Edit held message: ${first(entry.text)}`} onClick={() => onEdit(entry.id)}>Edit</button>
                <button type="button" class="btn btn-ghost" aria-label={`Discard held message: ${first(entry.text)}`} onClick={() => onRemove(entry.id)}>Discard</button>
              </Row>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
