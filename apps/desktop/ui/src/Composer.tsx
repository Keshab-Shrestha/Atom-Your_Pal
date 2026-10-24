import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Icon } from "./icons.tsx";
import { MAX_QUOTED_DRAFT, quoteAppending, stripHidden } from "./copy.ts";
import { MAX_FILES, kindOf, pastedTextName, pasteDecision, refuseFile, sizeLabel } from "./attachments.ts";
import type { ChatInput } from "./input.ts";

/** Text for the composer from somewhere else. `seq` changes with every request, so the same text can be offered twice. */
export interface Insertion {
  seq: number;
  text: string;
  /** "quote" is appended after the draft; "restore" is a prompt put back after edit or retry and never replaces a draft. */
  mode: "quote" | "restore";
  /** For "restore": the files that went with the prompt (an entry taken back from the queue). */
  files?: File[];
  /** Told whether the text was placed. A composer that is not empty refuses, and the caller then leaves the source where it was. */
  done?: (placed: boolean) => void;
  /** Said when a restore is refused. */
  refusal?: string;
}

/** Files that arrived by drag and drop. */
export interface Incoming {
  seq: number;
  files: File[];
  /** Folders that were dropped too: they cannot be attached. */
  folders: number;
}

export interface ComposerProps {
  /** This chat. The composer is shown afresh for each chat, starting from what was kept for it. */
  chatId: string;
  initial: Pick<ChatInput, "draft" | "files">;
  /** A turn is running: Enter queues the message instead of sending it. */
  working: boolean;
  /** How many messages already wait to be sent in this chat. A new message goes behind them. */
  queued: number;
  /** Words and files to keep for this chat (called when they settle, and when the composer goes away). */
  onSnapshot: (chatId: string, draft: string, files: File[]) => void;
  /** Lets the app save the composer's latest state when the page is being closed. */
  onFlushRegister: (flush: (() => void) | undefined) => void;
  /** Adds a message to the queue. Refuses, with the reason, when the chat is full. */
  onQueue: (text: string, files: File[]) => { ok: true } | { ok: false; why: string };
  /** Sends the oldest waiting message now, ending the turn in flight. */
  onSendNow: () => void;
  /** Why sending is not possible right now, in words for the user; undefined when it is. */
  blocked: string | undefined;
  /** Why this chat takes no attachments; undefined when it does. */
  attachWhy: string | undefined;
  /** Shown when the model picker is not available yet. */
  modelLabel: string | undefined;
  /** The model, thinking and access controls. */
  controls: ComponentChildren;
  /** A reply to quote into the draft. `seq` changes with every request, so the same reply can be quoted twice. */
  insertion: Insertion | undefined;
  incoming: Incoming | undefined;
  /** Resolves false when ATOM did not take the message: the draft and the files are kept. */
  onSend: (text: string, files: File[]) => Promise<boolean>;
}

interface Staged {
  id: number;
  file: File;
  /** An object URL for an image's thumbnail; revoked when the file leaves. */
  preview?: string;
}

export function Composer({ chatId, initial, working, queued, onSnapshot, onFlushRegister, onQueue, onSendNow, blocked, attachWhy, modelLabel, controls, insertion, incoming, onSend }: ComposerProps) {
  const nextId = useRef(1);
  const [draft, setDraft] = useState(initial.draft);
  const [files, setFiles] = useState<Staged[]>(() => initial.files.map((file) => ({ id: nextId.current++, file, ...(kindOf(file.name) === "image" ? { preview: URL.createObjectURL(file) } : {}) })));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // A composer shown again for the same chat must not apply an old quote, drop or restore a second time.
  const handled = useRef(insertion?.seq ?? 0);
  const droppedHandled = useRef(incoming?.seq ?? 0);
  const pastes = useRef(0);

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  const focusEnd = (length: number) =>
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(length, length);
      grow();
    });

  // Keep this chat's words and files for when it is shown again. Typing is saved a moment after it settles, and always when the composer goes away.
  const latest = useRef({ draft, files });
  latest.current = { draft, files };
  const flush = () => onSnapshot(chatId, latest.current.draft, latest.current.files.map((f) => f.file));
  useEffect(() => {
    const timer = setTimeout(flush, 250);
    return () => clearTimeout(timer);
  }, [draft, files]);
  useEffect(() => {
    onFlushRegister(flush);
    return () => {
      flush();
      onFlushRegister(undefined);
    };
  }, []);

  // Object URLs are released when the composer goes away.
  const live = useRef<Staged[]>([]);
  live.current = files;
  useEffect(() => () => live.current.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []);

  /** Adds files after the checks the user can act on; the runtime still checks each one when the message is sent. */
  function addFiles(list: File[], folders = 0) {
    if (attachWhy) return setNote(attachWhy);
    const added: Staged[] = [];
    const said: string[] = folders > 0 ? [`${folders === 1 ? "A folder" : "Folders"} cannot be attached. Attach the files inside instead.`] : [];
    for (const file of list) {
      if ([...files, ...added].some((f) => f.file.name === file.name && f.file.size === file.size && f.file.lastModified === file.lastModified)) continue;
      const why = refuseFile(file.name, file.size, files.length + added.length);
      if (why) {
        said.push(why);
        continue;
      }
      added.push({ id: nextId.current++, file, ...(kindOf(file.name) === "image" ? { preview: URL.createObjectURL(file) } : {}) });
    }
    if (added.length > 0) setFiles((cur) => [...cur, ...added]);
    setNote(said.length > 0 ? said[0] : undefined);
  }
  const removeFile = (id: number) =>
    setFiles((cur) => {
      cur.find((f) => f.id === id && f.preview) && URL.revokeObjectURL(cur.find((f) => f.id === id)!.preview!);
      return cur.filter((f) => f.id !== id);
    });

  useEffect(() => {
    if (!incoming || incoming.seq === droppedHandled.current) return;
    droppedHandled.current = incoming.seq;
    addFiles(incoming.files, incoming.folders);
  }, [incoming]);

  // "Reply to this" and the prompt restored by Edit or Retry. Nothing is sent, and what is typed is kept exactly.
  useEffect(() => {
    if (!insertion || insertion.seq === handled.current) return;
    handled.current = insertion.seq;
    if (insertion.mode === "restore") {
      // A changed composer is never overwritten (docs/conversation-controls.md).
      if (draft.trim() !== "" || files.length > 0) {
        setNote(insertion.refusal ?? "Your draft was kept. The earlier prompt is still in the original chat.");
        return insertion.done?.(false);
      }
      setNote(undefined);
      setDraft(insertion.text);
      if (insertion.files?.length) addFiles(insertion.files);
      focusEnd(insertion.text.length);
      return insertion.done?.(true);
    }
    const next = quoteAppending(insertion.text, draft);
    if (next === undefined) return;
    if ([...next].length > MAX_QUOTED_DRAFT) return setNote("The quote will not fit. Shorten the draft or copy a smaller excerpt.");
    setNote(undefined);
    setDraft(next);
    focusEnd(next.length);
  }, [insertion]);

  function onPaste(e: ClipboardEvent) {
    const pasted = [...(e.clipboardData?.files ?? [])];
    if (pasted.length > 0) {
      e.preventDefault(); // a screenshot or a copied file: attach it, as the Mac app does
      return addFiles(pasted);
    }
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const el = area.current;
    if (!text || !el) return;
    const decision = pasteDecision(text, draft, [el.selectionStart, el.selectionEnd], MAX_FILES - files.length, attachWhy);
    switch (decision.kind) {
      case "normal":
        return;
      case "nothing":
        e.preventDefault();
        return setNote(`That paste held only hidden characters (${decision.removed}), so nothing was pasted.`);
      case "refuse":
        e.preventDefault();
        return setNote(decision.why);
      case "clean":
        e.preventDefault();
        // execCommand keeps the editor's own Undo working; setRangeText is the fallback.
        if (!document.execCommand("insertText", false, decision.text)) {
          el.setRangeText(decision.text, el.selectionStart, el.selectionEnd, "end");
          setDraft(el.value);
        }
        return setNote(`Removed ${decision.removed} hidden character${decision.removed === 1 ? "" : "s"} from the pasted text.`);
      case "attach": {
        e.preventDefault();
        const file = new File([decision.text], pastedTextName(++pastes.current), { type: "text/plain" });
        addFiles([file]);
        setNote(`Long text was attached as ${file.name}.${decision.removed > 0 ? ` Removed ${decision.removed} hidden character${decision.removed === 1 ? "" : "s"}.` : ""}`);
      }
    }
  }

  /** Enter sends, or queues when a turn is running or messages already wait. Ctrl/Cmd+Enter queues and sends the oldest waiting message now. */
  async function submit(now = false) {
    const text = draft.trim();
    if (blocked || busy) return;
    if (!text && files.length === 0) {
      if (now) onSendNow(); // an empty composer: send the oldest waiting message
      return;
    }
    // Hidden controls typed or inserted some other way: clean the draft and let the user look before it goes.
    const hidden = stripHidden(draft);
    if (hidden.removed > 0) {
      setDraft(hidden.text);
      return setNote(`Removed ${hidden.removed} hidden character${hidden.removed === 1 ? "" : "s"} from the message. Review it, then send it again.`);
    }
    const staged = files.map((f) => f.file);
    const clear = () => {
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setFiles([]);
      setDraft("");
      setNote(undefined);
      requestAnimationFrame(grow);
    };
    if (working || queued > 0 || now) {
      const queuedIt = onQueue(text, staged);
      if (!queuedIt.ok) return setNote(queuedIt.why);
      clear();
      if (now) onSendNow();
      return;
    }
    setBusy(true);
    const taken = await onSend(text, staged);
    setBusy(false);
    if (taken) clear();
  }

  const canSend = (draft.trim() !== "" || files.length > 0) && !blocked && !busy;
  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-chat={chatId}
    >
      {files.length > 0 ? (
        <ul class="files" aria-label="Attached files">
          {files.map((f) => (
            <li key={f.id} class="file-chip">
              {f.preview ? <img src={f.preview} alt="" width={32} height={32} /> : <span class="file-icon" aria-hidden="true"><Icon name="file" size={18} /></span>}
              <span class="file-name" title={f.file.name}>{f.file.name}</span>
              <span class="muted small">{sizeLabel(f.file.size)}</span>
              <button type="button" class="file-remove" aria-label={`Remove ${f.file.name}`} disabled={busy} onClick={() => removeFile(f.id)}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label class="sr-only" for="message">Message ATOM</label>
      <textarea
        id="message"
        ref={area}
        rows={2}
        placeholder="How can I help you today?"
        value={draft}
        aria-describedby={blocked || note ? "composer-note" : undefined}
        onInput={(e) => {
          setDraft(e.currentTarget.value);
          setNote(undefined);
          grow();
        }}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void submit(e.ctrlKey || e.metaKey);
          }
        }}
      />
      <div class="composer-foot">
        <div class="foot-left">
          <button
            type="button"
            class="attach-btn"
            aria-label="Attach files"
            aria-disabled={attachWhy ? "true" : undefined}
            title={attachWhy ?? `Attach up to ${MAX_FILES} files: text, code, PDFs or images`}
            disabled={busy}
            onClick={() => (attachWhy ? setNote(attachWhy) : picker.current?.click())}
          >
            <Icon name="clip" size={16} />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            onChange={(e) => {
              addFiles([...(e.currentTarget.files ?? [])]);
              e.currentTarget.value = ""; // the same file can be chosen again
            }}
          />
          {controls ?? (modelLabel ? <span class="chip" title="The model this chat uses">{modelLabel}</span> : <span />)}
        </div>
        <button type="submit" class="send" aria-label={working || queued > 0 ? "Queue message" : "Send message"} title={working || queued > 0 ? "Queue this message (Enter). Ctrl or Cmd+Enter sends the oldest waiting message now and stops the current turn." : "Send (Enter)"} disabled={!canSend}>
          <Icon name={working || queued > 0 ? "queue" : "send"} size={18} />
        </button>
      </div>
      {working || queued > 0 ? (
        <p class="hint small muted">Enter queues this message. Ctrl or Cmd+Enter sends the oldest waiting message now and stops the current turn.</p>
      ) : null}
      {blocked || note || busy ? (
        <p id="composer-note" class="composer-note" role="status">
          {busy && files.length > 0 ? "Sending your files…" : (note ?? blocked)}
        </p>
      ) : null}
    </form>
  );
}
