import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { Composer } from "./Composer.tsx";
import { Markdown } from "./Markdown.tsx";
import type { ChatItem, LoopState } from "./protocol.ts";
import type { Message, Problem } from "./store.ts";

export interface ChatViewProps {
  chat: ChatItem | undefined;
  messages: Message[];
  loop: LoopState;
  problem: Problem | undefined;
  blocked: string | undefined;
  modelLabel: string | undefined;
  onSend: (text: string) => Promise<boolean>;
  onDismissProblem: () => void;
}

const LOOP_WORDS: Record<LoopState, string> = {
  idle: "Ready",
  listening: "Listening",
  transcribing: "Transcribing",
  thinking: "Thinking",
  speaking: "Speaking",
};

export function ChatView({ chat, messages, loop, problem, blocked, modelLabel, onSend, onDismissProblem }: ChatViewProps) {
  const log = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  /** True while the reader is at (or near) the end: new text and late layout changes then keep the end in view. Reading older text lets go. */
  const pinned = useRef(true);
  const toEnd = () => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  // Another chat opened: start at its end.
  useLayoutEffect(() => {
    pinned.current = true;
    toEnd();
  }, [chat?.id]);
  useLayoutEffect(() => {
    if (pinned.current) toEnd();
  }, [messages.length, loop]);
  // Fonts, tables and code blocks settle after the first paint; keep the end in view when the content grows.
  useEffect(() => {
    const content = inner.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(() => {
      if (pinned.current) toEnd();
    });
    watcher.observe(content);
    return () => watcher.disconnect();
  }, []);

  return (
    <main class="lane lane-chat" aria-label="Conversation">
      <header class="chat-head">
        <div>
          <p class="eyebrow">Chat</p>
          <h1 class="display">{chat?.title || "New chat"}</h1>
        </div>
        <span class={`pill pill-${loop}`} role="status">
          <span class="dot" aria-hidden="true" /> {LOOP_WORDS[loop]}
        </span>
      </header>

      {problem ? (
        <div class="banner banner-bad" role="alert">
          <p>{problem.message}</p>
          <button type="button" class="btn btn-ghost" onClick={onDismissProblem}>Dismiss</button>
        </div>
      ) : null}

      <div
        class="log"
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div class="log-inner" ref={inner}>
        {messages.length === 0 ? (
          <div class="empty">
            <h2 class="display">Start a conversation</h2>
            <p class="muted">Type below. ATOM answers here, and out loud when your voice is on.</p>
          </div>
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <div class="msg msg-user" key={message.id}>
                <p>{message.text}</p>
              </div>
            ) : (
              <article class="msg msg-atom" key={message.id}>
                <p class="who"><span class="avatar" aria-hidden="true" /> ATOM</p>
                <div class="body"><Markdown text={message.text} /></div>
              </article>
            ),
          )
        )}
        {loop === "thinking" || loop === "transcribing" ? (
          <p class="working" role="status">
            <span class="pulse" aria-hidden="true" /> {loop === "thinking" ? "ATOM is thinking…" : "Transcribing…"}
          </p>
        ) : null}
        </div>
      </div>

      <Composer
        blocked={blocked}
        modelLabel={modelLabel}
        onSend={(text) => {
          pinned.current = true; // your own message always brings you to the end
          return onSend(text);
        }}
      />
    </main>
  );
}
