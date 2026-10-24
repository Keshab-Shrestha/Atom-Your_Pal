import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons.tsx";
import { MAX_QUOTED_DRAFT, quoteAppending } from "./copy.ts";

/** Text for the composer from somewhere else. `seq` changes with every request, so the same text can be offered twice. */
export interface Insertion {
  seq: number;
  text: string;
  /** "quote" is appended after the draft; "restore" is a prompt put back after edit or retry and never replaces a draft. */
  mode: "quote" | "restore";
}

export interface ComposerProps {
  /** Why sending is not possible right now, in words for the user; undefined when it is. */
  blocked: string | undefined;
  modelLabel: string | undefined;
  /** A reply to quote into the draft. `seq` changes with every request, so the same reply can be quoted twice. */
  insertion: Insertion | undefined;
  /** Resolves false when ATOM did not take the message: the draft is kept. */
  onSend: (text: string) => Promise<boolean>;
}

export function Composer({ blocked, modelLabel, insertion, onSend }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const area = useRef<HTMLTextAreaElement>(null);
  const handled = useRef(0);

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  // "Reply to this": the quote goes after what is already typed, which is kept exactly; nothing is sent.
  useEffect(() => {
    if (!insertion || insertion.seq === handled.current) return;
    handled.current = insertion.seq;
    if (insertion.mode === "restore") {
      // A changed composer is never overwritten (docs/conversation-controls.md).
      if (draft.trim() !== "") return setNote("Your draft was kept. The earlier prompt is still in the original chat.");
      setNote(undefined);
      setDraft(insertion.text);
      requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(insertion.text.length, insertion.text.length);
        grow();
      });
      return;
    }
    const next = quoteAppending(insertion.text, draft);
    if (next === undefined) return;
    if ([...next].length > MAX_QUOTED_DRAFT) return setNote("The quote will not fit. Shorten the draft or copy a smaller excerpt.");
    setNote(undefined);
    setDraft(next);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
      grow();
    });
  }, [insertion]);

  async function submit() {
    const text = draft.trim();
    if (!text || blocked || busy) return;
    setBusy(true);
    const taken = await onSend(text);
    setBusy(false);
    if (taken) {
      setDraft("");
      requestAnimationFrame(grow);
    }
  }

  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label class="sr-only" for="message">Message ATOM</label>
      <textarea
        id="message"
        ref={area}
        rows={2}
        placeholder="How can I help you today?"
        value={draft}
        aria-describedby={blocked ? "composer-note" : undefined}
        onInput={(e) => {
          setDraft(e.currentTarget.value);
          setNote(undefined);
          grow();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div class="composer-foot">
        {modelLabel ? <span class="chip" title="The model this chat uses">{modelLabel}</span> : <span />}
        <button type="submit" class="send" aria-label="Send message" disabled={!draft.trim() || Boolean(blocked) || busy}>
          <Icon name="send" size={18} />
        </button>
      </div>
      {blocked || note ? (
        <p id="composer-note" class="composer-note" role="status">
          {note ?? blocked}
        </p>
      ) : null}
    </form>
  );
}
