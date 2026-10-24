import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { Composer } from "./Composer.tsx";
import { CopyContext, Markdown } from "./Markdown.tsx";
import { RowMenu } from "./RowMenu.tsx";
import { replyContent, type ClipContent } from "./copy.ts";
import { WorkBar } from "./WorkBar.tsx";
import type { ChatItem, LoopState } from "./protocol.ts";
import type { Approval, Message, Problem, Work } from "./store.ts";

export interface ChatViewProps {
  chat: ChatItem | undefined;
  messages: Message[];
  loop: LoopState;
  problem: Problem | undefined;
  work: Work | undefined;
  approval: Approval | undefined;
  blocked: string | undefined;
  modelLabel: string | undefined;
  onSend: (text: string) => Promise<boolean>;
  onDismissProblem: () => void;
  onCopy: (content: ClipContent) => void;
  /** Appends a quote of a reply to the draft. */
  onQuote: (text: string) => void;
  /** An unsent text to place in the composer, and a counter that makes the same text insertable twice. */
  insertion: { seq: number; text: string } | undefined;
  onStop: () => void;
  onAnswer: (approved: boolean, rememberFile?: boolean) => void;
}

const LOOP_WORDS: Record<LoopState, string> = {
  idle: "Ready",
  listening: "Listening",
  transcribing: "Transcribing",
  thinking: "Thinking",
  speaking: "Speaking",
};

export function ChatView({ chat, messages, loop, problem, work, approval, blocked, modelLabel, onSend, onDismissProblem, onCopy, onQuote, insertion, onStop, onAnswer }: ChatViewProps) {
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
        <div class="head-right">
          {loop !== "idle" && work?.outcome !== "working" && !approval ? (
            <button type="button" class="btn btn-ghost" onClick={onStop} title="Stop (Esc)">Stop</button>
          ) : null}
          <span class={`pill pill-${loop}`} role="status">
            <span class="dot" aria-hidden="true" /> {LOOP_WORDS[loop]}
          </span>
        </div>
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
              <div class="msg-row msg-row-user" key={message.id}>
                <RowMenu label="Message actions" items={[{ label: "Copy message", onSelect: () => onCopy({ text: message.text }) }]} />
                <div class="msg msg-user">
                  <p>{message.text}</p>
                </div>
              </div>
            ) : (
              <article class="msg msg-atom" key={message.id}>
                <div class="who-row">
                  <p class="who"><span class="avatar" aria-hidden="true" /> ATOM</p>
                  <RowMenu
                    label="Reply actions"
                    items={[
                      { label: "Copy as Markdown", onSelect: () => onCopy(replyContent(message.text)) },
                      { label: "Copy as plain text", onSelect: () => onCopy(replyContent(message.text, "plain")) },
                      { label: "Copy as rich text", onSelect: () => onCopy(replyContent(message.text, "rich")) },
                      { label: "Reply to this", onSelect: () => onQuote(message.text), disabledWhy: blocked && !/Press Stop/.test(blocked) ? "Not available now." : undefined },
                    ]}
                  />
                </div>
                <div class="body"><CopyContext.Provider value={onCopy}><Markdown text={message.text} /></CopyContext.Provider></div>
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

      <WorkBar work={work} approval={approval} onStop={onStop} onAnswer={onAnswer} />

      <Composer
        blocked={blocked}
        modelLabel={modelLabel}
        insertion={insertion}
        onSend={(text) => {
          pinned.current = true; // your own message always brings you to the end
          return onSend(text);
        }}
      />
    </main>
  );
}
