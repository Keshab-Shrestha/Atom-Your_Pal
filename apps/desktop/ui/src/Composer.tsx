import { useRef, useState } from "preact/hooks";
import { Icon } from "./icons.tsx";

export interface ComposerProps {
  /** Why sending is not possible right now, in words for the user; undefined when it is. */
  blocked: string | undefined;
  modelLabel: string | undefined;
  /** Resolves false when ATOM did not take the message: the draft is kept. */
  onSend: (text: string) => Promise<boolean>;
}

export function Composer({ blocked, modelLabel, onSend }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

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
      {blocked ? (
        <p id="composer-note" class="composer-note" role="status">
          {blocked}
        </p>
      ) : null}
    </form>
  );
}
