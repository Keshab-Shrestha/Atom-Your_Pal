import { useState } from "preact/hooks";
import { Icon } from "./icons.tsx";
import type { ChatItem } from "./protocol.ts";

export interface ChatListProps {
  chats: ChatItem[];
  currentId: string | undefined;
  /** Disabled while ATOM cannot take commands. */
  canAct: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
}

export function ChatList({ chats, currentId, canAct, onOpen, onNew }: ChatListProps) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const needle = query.trim().toLowerCase();
  const matches = (chat: ChatItem) => needle === "" || chat.title.toLowerCase().includes(needle);
  const live = chats.filter((chat) => !chat.archived && matches(chat));
  const archived = chats.filter((chat) => chat.archived && matches(chat));
  // Pinned first, then ATOM's own order (newest first).
  const ordered = [...live.filter((c) => c.pinned), ...live.filter((c) => !c.pinned)];

  const row = (chat: ChatItem) => (
    <li key={chat.id}>
      <button type="button" class="list-btn" aria-current={chat.id === currentId ? "true" : undefined} onClick={() => onOpen(chat.id)}>
        {chat.pinned ? <Icon name="pin" size={14} /> : null}
        <span class="list-title">{chat.title || "Untitled chat"}</span>
        {chat.readOnly ? <span class="tag">read only</span> : null}
      </button>
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
      <button type="button" class="btn btn-primary" disabled={!canAct} onClick={onNew}>
        <Icon name="plus" size={16} /> New chat
      </button>
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
    </aside>
  );
}
