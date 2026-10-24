import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons.tsx";
import { RowMenu, type MenuItem } from "./RowMenu.tsx";
import type { ChatItem } from "./protocol.ts";
import type { Undo } from "./store.ts";
import { checkTitle, MAX_TITLE } from "./titles.ts";

export interface ChatListProps {
  chats: ChatItem[];
  currentId: string | undefined;
  /** Disabled while ATOM cannot take commands. */
  canAct: boolean;
  /** A turn is running: archiving is refused by the runtime then. */
  busy: boolean;
  /** A flags change is waiting for its answer. */
  changing: boolean;
  undo: Undo | undefined;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onFlags: (chat: ChatItem, change: { pinned?: boolean; archived?: boolean }) => void;
  onDelete: (id: string) => void;
  onUndo: () => void;
  onDismissUndo: () => void;
}

const SHARED_WHY = "This chat is written from Telegram or the local API. It can be read here only.";

export function ChatList(props: ChatListProps) {
  const { chats, currentId, canAct, busy, changing, undo } = props;
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState<string | undefined>();
  const [confirming, setConfirming] = useState<ChatItem | undefined>();
  const needle = query.trim().toLowerCase();
  const matches = (chat: ChatItem) => needle === "" || chat.title.toLowerCase().includes(needle);
  const live = chats.filter((chat) => !chat.archived && matches(chat));
  const archived = chats.filter((chat) => chat.archived && matches(chat));
  // Pinned first, then ATOM's own order (newest first).
  const ordered = [...live.filter((c) => c.pinned), ...live.filter((c) => !c.pinned)];

  const menuFor = (chat: ChatItem): MenuItem[] => {
    const offline = !canAct ? "ATOM is not ready." : undefined;
    return [
      { label: "Rename", onSelect: () => setRenaming(chat.id), disabledWhy: chat.readOnly ? SHARED_WHY : offline },
      { label: chat.pinned ? "Unpin" : "Pin to top", onSelect: () => props.onFlags(chat, { pinned: !chat.pinned }), disabledWhy: changing ? "Another change is waiting for ATOM." : offline },
      {
        label: chat.archived ? "Unarchive" : "Archive",
        onSelect: () => props.onFlags(chat, { archived: !chat.archived }),
        disabledWhy: chat.readOnly ? SHARED_WHY : changing ? "Another change is waiting for ATOM." : busy ? "Finish or stop the active turn first." : offline,
      },
      { label: "Delete…", onSelect: () => setConfirming(chat), danger: true, disabledWhy: offline },
    ];
  };

  const row = (chat: ChatItem) =>
    renaming === chat.id ? (
      <li key={chat.id}>
        <RenameRow
          chat={chat}
          onCancel={() => setRenaming(undefined)}
          onCommit={(title) => {
            setRenaming(undefined);
            if (title !== chat.title) props.onRename(chat.id, title);
          }}
        />
      </li>
    ) : (
      <li key={chat.id} class="list-row">
        <button type="button" class="list-btn" aria-current={chat.id === currentId ? "true" : undefined} onClick={() => props.onOpen(chat.id)}>
          {chat.pinned ? <Icon name="pin" size={14} /> : null}
          <span class="list-title">{chat.title || "Untitled chat"}</span>
          {chat.readOnly ? <span class="tag">read only</span> : null}
        </button>
        <RowMenu label={`Actions for ${chat.title || "Untitled chat"}`} items={menuFor(chat)} />
      </li>
    );

  return (
    <aside class="lane lane-list" aria-label="Chats">
      <header class="list-head">
        <h2 class="eyebrow">Chats</h2>
      </header>
      <div class="search">
        <label class="sr-only" for="chat-search">Search chats</label>
        <Icon name="search" size={16} />
        <input id="chat-search" type="search" placeholder="Search chats" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </div>
      <button type="button" class="btn btn-primary" disabled={!canAct} onClick={props.onNew}>
        <Icon name="plus" size={16} /> New chat
      </button>
      {undo ? (
        <p class="undo" role="status">
          <span>{undo.said}.</span>
          {undo.undoable ? <button type="button" class="link-btn" disabled={changing || !canAct} onClick={props.onUndo}>Undo</button> : null}
          <button type="button" class="link-btn" aria-label="Dismiss" onClick={props.onDismissUndo}><Icon name="close" size={14} /></button>
        </p>
      ) : null}
      {chats.length === 0 ? (
        <p class="muted small">No chats yet. Choose New chat, or type a message to ATOM.</p>
      ) : ordered.length === 0 && archived.length === 0 ? (
        <p class="muted small">No chat matches “{query}”.</p>
      ) : (
        <ul class="list" aria-label="Your chats">
          {ordered.map(row)}
        </ul>
      )}
      {archived.length > 0 ? (
        <section>
          <button type="button" class="list-fold" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            <span class={showArchived ? "turn open" : "turn"}><Icon name="chevron" size={14} /></span>
            <span class="eyebrow">Archived chats · {archived.length}</span>
          </button>
          {showArchived ? <ul class="list">{archived.map(row)}</ul> : null}
        </section>
      ) : null}
      <DeleteDialog
        chat={confirming}
        onCancel={() => setConfirming(undefined)}
        onConfirm={() => {
          if (confirming) props.onDelete(confirming.id);
          setConfirming(undefined);
        }}
      />
    </aside>
  );
}

function RenameRow({ chat, onCommit, onCancel }: { chat: ChatItem; onCommit: (title: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(chat.title);
  const [why, setWhy] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  /** Enter ends the edit, and removing the field can blur it: the title is sent once. */
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const commit = () => {
    if (finished.current) return;
    const checked = checkTitle(text);
    if (!checked.ok) return setWhy(checked.why);
    finished.current = true;
    onCommit(checked.title);
  };
  const cancel = () => {
    finished.current = true;
    onCancel();
  };
  return (
    <div class="rename">
      <label class="sr-only" for="rename-input">Chat title</label>
      <input
        id="rename-input"
        ref={input}
        value={text}
        maxLength={MAX_TITLE * 2}
        aria-invalid={why ? "true" : undefined}
        aria-describedby={why ? "rename-why" : undefined}
        onInput={(e) => (setText(e.currentTarget.value), setWhy(undefined))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.isComposing) (e.preventDefault(), commit());
          else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), cancel());
        }}
        onBlur={() => (checkTitle(text).ok ? commit() : cancel())}
      />
      {why ? <p id="rename-why" class="rename-why" role="alert">{why}</p> : null}
    </div>
  );
}

function DeleteDialog({ chat, onCancel, onConfirm }: { chat: ChatItem | undefined; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (chat && !el.open) el.showModal();
    if (!chat && el.open) el.close();
  }, [chat]);
  return (
    <dialog ref={dialog} class="confirm" aria-labelledby="delete-title" onCancel={(e) => (e.preventDefault(), onCancel())}>
      <h2 id="delete-title" class="confirm-title">Delete “{chat?.title}”?</h2>
      <p class="muted">The chat and its messages are removed for good.</p>
      <div class="confirm-actions">
        <button type="button" class="btn" autofocus onClick={onCancel}>Cancel</button>
        <button type="button" class="btn btn-danger" onClick={onConfirm}>Delete chat</button>
      </div>
    </dialog>
  );
}
