import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { Composer } from "./Composer.tsx";
import { CopyContext, Markdown } from "./Markdown.tsx";
import { RowMenu } from "./RowMenu.tsx";
import { replyContent, type ClipContent } from "./copy.ts";
import type { Insertion } from "./Composer.tsx";
import type { ComponentChildren } from "preact";
import { WorkBar } from "./WorkBar.tsx";
import type { ChatItem, LoopState } from "./protocol.ts";
import type { Approval, Message, Problem, Work } from "./store.ts";
import type { MenuItem } from "./RowMenu.tsx";

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
  insertion: Insertion | undefined;
  /** The composer's model, thinking and access controls. */
  controls: ComponentChildren;
  /** Why a chat cannot be copied into a new one right now; undefined when it can. */
  branchWhy: string | undefined;
  /** Copy the chat into a new one: through a saved message, or the whole chat (through "all"). */
  onBranch: (kind: "fork" | "edit" | "retry", through: number | "all") => void;
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

const NO_SEQ = "Reopen this chat to use this on a message that has just arrived.";

export function ChatView({ chat, messages, loop, problem, work, approval, blocked, modelLabel, onSend, onDismissProblem, onCopy, onQuote, insertion, controls, branchWhy, onBranch, onStop, onAnswer }: ChatViewProps) {
  /** Fork, edit and retry need the runtime's saved number for the message. */
  const branchItems = (message: Message): MenuItem[] => {
    const why = branchWhy ?? (message.seq === undefined ? NO_SEQ : undefined);
    const through = message.seq ?? 0;
    return [
      ...(message.role === "user"
        ? [
            { label: "Edit in new chat", onSelect: () => onBranch("edit", through), disabledWhy: why },
            { label: "Retry in new chat", onSelect: () => onBranch("retry", through), disabledWhy: why },
          ]
        : []),
      { label: "Fork through here", onSelect: () => onBranch("fork", through), disabledWhy: why },
    ];
  };
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
          <RowMenu
            label="Chat options"
            items={[{ label: "Fork chat", onSelect: () => onBranch("fork", "all"), disabledWhy: branchWhy ?? (chat && chat.messages > 0 ? undefined : "This chat is not saved yet. Send a message first.") }]}
          />
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
                <RowMenu label="Message actions" items={[{ label: "Copy message", onSelect: () => onCopy({ text: message.text }) }, ...branchItems(message)]} />
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
                      ...branchItems(message),
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
        controls={controls}
        insertion={insertion}
        onSend={(text) => {
          pinned.current = true; // your own message always brings you to the end
          return onSend(text);
        }}
      />
    </main>
  );
}
