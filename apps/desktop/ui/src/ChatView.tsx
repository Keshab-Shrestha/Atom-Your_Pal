import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Composer } from "./Composer.tsx";
import { FindBar } from "./FindBar.tsx";
import { WorkLog } from "./WorkLog.tsx";
import { QuestionCard, type AnswerOutcome, type Question } from "./QuestionCard.tsx";
import type { WorkLog as WorkLogState } from "./work-log.ts";
import { findInMessages, selectedMatch, stepSelection } from "./find.ts";
import { QueueList } from "./QueueList.tsx";
import type { InputApi } from "./useInputs.ts";
import { CopyContext, Markdown } from "./Markdown.tsx";
import { RowMenu } from "./RowMenu.tsx";
import { replyContent, type ClipContent } from "./copy.ts";
import type { Incoming, Insertion } from "./Composer.tsx";
import { splitAttachments } from "./attachments.ts";
import { Icon } from "./icons.tsx";
import type { SkillInfo, SlashAction, SlashCommandInfo } from "./slash.ts";
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
  onSend: (text: string, files: File[], request: string) => Promise<boolean>;
  /** Retained requests that need a look (interrupted, failed, or with a reply not saved in the chat). */
  recoveryCount: number;
  onOpenRecovery: () => void;
  /** What ATOM did in the turn in view, as the window saw it; shown only for the chat it belongs to. */
  workLog: WorkLogState | undefined;
  /** The question ATOM waits on in this chat, if any, and how to answer it (undefined text skips it). */
  question: Question | undefined;
  onQuestion: (text: string | undefined) => Promise<AnswerOutcome>;
  /** Why the chat brief cannot be opened now; undefined when it can. */
  briefWhy: string | undefined;
  onOpenBrief: () => void;
  /** Why saved history and "What this chat remembers" cannot be read now; undefined when they can. */
  savedWhy: string | undefined;
  onOpenHistory: () => void;
  onOpenRemembers: () => void;
  onDismissProblem: () => void;
  onCopy: (content: ClipContent) => void;
  /** Appends a quote of a reply to the draft. */
  onQuote: (text: string) => void;
  /** An unsent text to place in the composer, and a counter that makes the same text insertable twice. */
  insertion: Insertion | undefined;
  attachWhy: string | undefined;
  /** The skills and Claude commands for the "/" picker, and how to run ATOM's own commands. */
  slash: { skills: SkillInfo[]; commands: SlashCommandInfo[] };
  onSlash: (action: SlashAction) => string | undefined;
  /** Unsent words, files and waiting messages of this chat. */
  input: InputApi;
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

export function ChatView({ chat, messages, loop, problem, work, approval, blocked, modelLabel, onSend, recoveryCount, onOpenRecovery, workLog, question, onQuestion, briefWhy, onOpenBrief, savedWhy, onOpenHistory, onOpenRemembers, onDismissProblem, onCopy, onQuote, insertion, attachWhy, slash, onSlash, input, controls, branchWhy, onBranch, onStop, onAnswer }: ChatViewProps) {
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
  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;
  const showLog = workLog !== undefined && chat !== undefined && workLog.work.chat === chat.id;
  const step = work?.outcome === "working" ? work.step : undefined;
  // Files dropped on the chat go to the composer, which checks them. A drop never sends anything.
  const [dragging, setDragging] = useState(false);
  const [incoming, setIncoming] = useState<Incoming | undefined>();
  const dropSeq = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  /** True while the reader is at (or near) the end: new text and late layout changes then keep the end in view. Reading older text lets go. */
  const pinned = useRef(true);
  // Find in chat (ADR-152): the loaded messages only. While it is open the view stays where the match is instead of following new text.
  const [find, setFind] = useState({ open: false, query: "", selection: 0, tick: 0 });
  const findOpen = useRef(false);
  findOpen.current = find.open;
  const results = useMemo(() => (find.open ? findInMessages(messages, find.query) : { matches: [], more: false }), [messages, find.open, find.query]);
  const match = find.open ? selectedMatch(results, find.selection) : undefined;
  const openFind = () => setFind((f) => ({ ...f, open: true, tick: f.tick + 1 }));
  const closeFind = (refocus = true) => {
    setFind((f) => ({ ...f, open: false, query: "", selection: 0 }));
    if (refocus) document.getElementById("message")?.focus();
  };
  // Another chat: Find closes with an empty box.
  useEffect(() => closeFind(false), [chat?.id]);
  // Ctrl/Cmd+F is Find in this chat, not the browser's (as in the Mac app). Not while a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f" && !e.isComposing && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        openFind();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // The selected match comes into view, in the middle of the log.
  useEffect(() => {
    if (!match) return;
    log.current?.querySelector(`[data-msg="${match.messageId}"]`)?.scrollIntoView({ block: "center" });
  }, [match?.messageId, match?.offset, find.query, find.tick]);
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
    if (pinned.current && !findOpen.current) toEnd();
  }, [messages.length, loop]);
  // Fonts, tables and code blocks settle after the first paint; keep the end in view when the content grows.
  useEffect(() => {
    const content = inner.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(() => {
      if (pinned.current && !findOpen.current) toEnd();
    });
    watcher.observe(content);
    return () => watcher.disconnect();
  }, []);

  return (
    <main
      class="lane lane-chat"
      aria-label="Conversation"
      onDragEnter={(e) => e.dataTransfer?.types.includes("Files") && (e.preventDefault(), setDragging(true))}
      onDragOver={(e) => e.dataTransfer?.types.includes("Files") && e.preventDefault()}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        const items = [...e.dataTransfer.items];
        const folders = items.filter((i) => i.kind === "file" && i.webkitGetAsEntry?.()?.isDirectory).length;
        const dropped = [...e.dataTransfer.files].filter((_, i) => !(items[i]?.webkitGetAsEntry?.()?.isDirectory));
        setIncoming({ seq: ++dropSeq.current, files: dropped, folders });
      }}
    >
      {dragging ? (
        <div class="dropzone" aria-hidden="true">
          <p>{attachWhy ?? "Drop files to attach them"}</p>
        </div>
      ) : null}
      <header class="chat-head">
        <div>
          <p class="eyebrow">Chat</p>
          <h1 class="display">{chat?.title || "New chat"}</h1>
        </div>
        <div class="head-right">
          <RowMenu
            label={recoveryCount > 0 ? `Chat options (${recoveryCount} to review in Recovery)` : "Chat options"}
            attention={recoveryCount > 0}
            items={[
              { label: recoveryCount > 0 ? `Recovery (${recoveryCount})` : "Recovery", onSelect: onOpenRecovery },
              { label: "Find in chat", onSelect: openFind, disabledWhy: messages.length > 0 ? undefined : "This chat has no messages yet." },
              { label: "Saved history", onSelect: onOpenHistory, disabledWhy: savedWhy },
              { label: "Chat brief", onSelect: onOpenBrief, disabledWhy: briefWhy },
              { label: "What this chat remembers", onSelect: onOpenRemembers, disabledWhy: savedWhy },
              { label: "Fork chat", onSelect: () => onBranch("fork", "all"), disabledWhy: branchWhy ?? (chat && chat.messages > 0 ? undefined : "This chat is not saved yet. Send a message first.") },
            ]}
          />
          {loop !== "idle" && work?.outcome !== "working" && !approval ? (
            <button type="button" class="btn btn-ghost" onClick={onStop} title="Stop (Esc)">Stop</button>
          ) : null}
          <span class={`pill pill-${loop}`} role="status">
            <span class="dot" aria-hidden="true" /> {LOOP_WORDS[loop]}
          </span>
        </div>
      </header>

      {find.open ? (
        <FindBar
          query={find.query}
          results={results}
          selection={find.selection}
          focusTick={find.tick}
          onQuery={(query) => setFind((f) => ({ ...f, query, selection: 0 }))}
          onStep={(direction) => setFind((f) => ({ ...f, selection: stepSelection(f.selection, results.matches.length, direction) }))}
          onClose={() => closeFind()}
        />
      ) : null}

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
          messages.flatMap((message) => [
            message.role === "user" ? (
              <div class={`msg-row msg-row-user${match?.messageId === message.id ? " found" : ""}`} key={message.id} data-msg={message.id}>
                <RowMenu label="Message actions" items={[{ label: "Copy message", onSelect: () => onCopy({ text: message.text }) }, ...branchItems(message)]} />
                <div class="msg msg-user">
                  <UserText text={message.text} />
                </div>
              </div>
            ) : (
              <article class={`msg msg-atom${match?.messageId === message.id ? " found" : ""}`} key={message.id} data-msg={message.id}>
                <div class="who-row">
                  <p class="who"><span class="avatar" aria-hidden="true" /> ATOM</p>
                  <RowMenu
                    label="Reply actions"
                    items={[
                      { label: "Copy as Markdown", onSelect: () => onCopy(replyContent(message.text)) },
                      { label: "Copy as plain text", onSelect: () => onCopy(replyContent(message.text, "plain")) },
                      { label: "Copy as rich text", onSelect: () => onCopy(replyContent(message.text, "rich")) },
                      { label: "Reply to this", onSelect: () => onQuote(message.text), disabledWhy: blocked ? "Not available now." : undefined },
                      ...branchItems(message),
                    ]}
                  />
                </div>
                <div class="body"><CopyContext.Provider value={onCopy}><Markdown text={message.text} /></CopyContext.Provider></div>
              </article>
            ),
            // The work log of the turn in view goes right after the message that started it.
            ...(message.id === lastUserId && showLog ? [<WorkLog key="worklog" log={workLog!} {...(step ? { step } : {})} />] : []),
          ])
        )}
        {loop === "thinking" || loop === "transcribing" ? (
          <p class="working" role="status">
            <span class="pulse" aria-hidden="true" /> {loop === "thinking" ? "ATOM is thinking…" : "Transcribing…"}
          </p>
        ) : null}
        </div>
      </div>

      <WorkBar work={work} approval={approval} onStop={onStop} onAnswer={onAnswer} />
      {question && showLog ? <QuestionCard key={question.id} question={question} onAnswer={onQuestion} /> : null}

      <QueueList
        queue={input.current.queue}
        held={input.current.held}
        sending={input.current.sending}
        working={input.working}
        blocked={input.blocked}
        onSendNow={input.onSendNow}
        onEdit={input.onEdit}
        onRemove={input.onRemove}
      />

      {input.loaded ? (
      <Composer
        key={input.chatId}
        chatId={input.chatId}
        initial={input.current}
        working={input.working}
        queued={input.current.queue.length}
        onSnapshot={input.onSnapshot}
        onFlushRegister={input.onFlushRegister}
        onQueue={input.onQueue}
        onSendNow={input.onSendNow}
        blocked={blocked}
        modelLabel={modelLabel}
        controls={controls}
        attachWhy={attachWhy}
        slash={chat?.readOnly ? undefined : slash}
        onSlash={onSlash}
        incoming={incoming}
        insertion={insertion}
        onSend={(text, files, request) => {
          pinned.current = true; // your own message always brings you to the end
          return onSend(text, files, request);
        }}
      />
      ) : null}
    </main>
  );
}

/** A sent message: its words, with each attached file shown by name (never by its local path). */
function UserText({ text }: { text: string }) {
  const pieces = splitAttachments(text);
  if (!pieces.some((p) => "attached" in p)) return <p>{text}</p>;
  return (
    <p>
      {pieces.map((piece, i) =>
        "attached" in piece ? (
          <span key={i} class="sent-file" title="Attached file"><Icon name="file" size={14} /> {piece.attached}</span>
        ) : (
          <span key={i}>{piece.text.replace(/^\n+|\n+$/g, "") === "" ? "" : piece.text}</span>
        ),
      )}
    </p>
  );
}
