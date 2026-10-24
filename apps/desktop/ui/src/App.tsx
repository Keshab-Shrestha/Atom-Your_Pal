import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import { writeClipboard } from "./clipboard.ts";
import type { Insertion } from "./Composer.tsx";
import { replyContent, type ClipContent } from "./copy.ts";
import { ChatList } from "./ChatList.tsx";
import { ChatView } from "./ChatView.tsx";
import { Rail } from "./Rail.tsx";
import { Surface } from "./Surface.tsx";
import { newUuid } from "./ids.ts";
import { useInputs } from "./useInputs.ts";
import { useRecovery } from "./useRecovery.ts";
import { Recovery } from "./Recovery.tsx";
import { ChatSettings } from "./ChatSettings.tsx";
import type { ChatAccessMode } from "./protocol.ts";
import { attachWhy as attachReason, currentChat, effectiveModel, initialState, reduce, sendBlock, settingsWhy } from "./store.ts";
import type { ChatItem } from "./protocol.ts";
import type { Transport } from "./transport.ts";

export function App({ transport }: { transport: Transport }) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const requestedOpen = useRef<string | undefined>(undefined);

  useEffect(() => {
    transport.start({
      onEvent: (event) => dispatch({ kind: "event", event }),
      onStatus: (status) => dispatch({ kind: "runtime", status }),
      onLink: (link) => dispatch({ kind: "link", link }),
    });
    return () => transport.stop();
  }, [transport]);

  const send = useCallback(
    async (command: Parameters<Transport["send"]>[0]) => {
      const result = await transport.send(command);
      if (!result.ok) dispatch({ kind: "problem", problem: { message: result.message } });
      return result.ok;
    },
    [transport],
  );

  // Ask for the chat list whenever the link comes (back) up, and show the chat ATOM is in.
  useEffect(() => {
    if (state.link === "live") void send({ type: "chats.list" });
  }, [state.link, send]);
  useEffect(() => {
    const id = state.currentChatId;
    if (id && id !== state.openChatId && requestedOpen.current !== id) {
      requestedOpen.current = id;
      void send({ type: "chat.open", id });
    }
    if (state.openChatId) requestedOpen.current = undefined;
  }, [state.currentChatId, state.openChatId, send]);

  const stopRef = useRef<() => void>(() => {});
  const stop = useCallback(() => stopRef.current(), []);

  const approvalId = state.approval?.id;
  const answer = useCallback(
    (approved: boolean, rememberFile?: boolean) => {
      if (!approvalId) return;
      dispatch({ kind: "answered" });
      void send({ type: "approval.answer", id: approvalId, approved, ...(approved && rememberFile ? { rememberFile: true } : {}) });
    },
    [approvalId, send],
  );

  // Esc stops a turn in flight, as in the Mac app.
  const turnRunning = state.loop !== "idle" || state.work?.outcome === "working";
  useEffect(() => {
    if (!turnRunning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turnRunning, stop]);

  // The strip stays a moment after the turn ends so the outcome can be read.
  const outcome = state.work?.outcome;
  useEffect(() => {
    if (!outcome || outcome === "working") return;
    const timer = setTimeout(() => dispatch({ kind: "workHide" }), 2500);
    return () => clearTimeout(timer);
  }, [outcome]);

  // Pin and archive are compare-and-set against the chat's metadata version; the answer carries the same request id.
  const changeFlags = useCallback(
    async (id: string, version: number, change: { pinned?: boolean; archived?: boolean }, done: string, undoing = false) => {
      const request = newUuid();
      dispatch({ kind: "mutating", mutation: { request, done, ...(undoing ? { undoing: true as const } : {}) } });
      const ok = await send({ type: "chat.control", action: "flags", id, request, version, ...change });
      if (!ok) dispatch({ kind: "mutationTimeout", request });
    },
    [send],
  );
  const flags = useCallback(
    (chat: ChatItem, change: { pinned?: boolean; archived?: boolean }) => {
      const title = `“${chat.title || "Untitled chat"}”`;
      const said = change.archived !== undefined ? `${change.archived ? "Archived" : "Unarchived"} ${title}` : `${change.pinned ? "Pinned" : "Unpinned"} ${title}`;
      void changeFlags(chat.id, chat.flagsVersion ?? 0, change, said);
    },
    [changeFlags],
  );
  const undoFlags = useCallback(() => {
    const undo = state.undo;
    if (undo) void changeFlags(undo.id, undo.version, { pinned: undo.pinned, archived: undo.archived }, "Undone", true);
  }, [state.undo, changeFlags]);

  // No answer in time: the change may or may not have happened, so say so (ChatControlsModel's timeout).
  const mutationRequest = state.mutation?.request;
  useEffect(() => {
    if (!mutationRequest) return;
    const timer = setTimeout(() => dispatch({ kind: "mutationTimeout", request: mutationRequest }), 10_000);
    return () => clearTimeout(timer);
  }, [mutationRequest]);

  // Copy: one prepared item to the clipboard; the outcome is announced, never the text.
  const [toast, setToast] = useState<string | undefined>();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copy = useCallback(async (content: ClipContent) => {
    const ok = await writeClipboard(content);
    clearTimeout(toastTimer.current);
    setToast(ok ? "Copied" : "Copy failed");
    toastTimer.current = setTimeout(() => setToast(undefined), 1400);
  }, []);

  // "Reply to this": quote a reply into the draft. A chat written by another surface is read-only, so it takes no quote.
  const [insertion, setInsertion] = useState<Insertion | undefined>();
  const quoteSeq = useRef(0);
  const quote = useCallback((text: string) => setInsertion({ seq: ++quoteSeq.current, text, mode: "quote" }), []);

  // Copy the last reply as Markdown: Ctrl/Cmd+Shift+C. Not while a dialog is open.
  const lastReply = [...state.messages].reverse().find((m) => m.role === "assistant" && m.text.trim() !== "")?.text;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== "c" || e.isComposing) return;
      if (document.querySelector("dialog[open]") || lastReply === undefined) return;
      e.preventDefault();
      void copy(replyContent(lastReply));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lastReply, copy]);

  // Fork, edit and retry: inspect the saved chat for its revision, then fork under a fresh request id (the runtime creates the child once per id).
  const startBranch = useCallback(
    (kind: "fork" | "edit" | "retry", through: number | "all") => {
      const chatId = state.currentChatId;
      if (!chatId || state.branch) return;
      const request = newUuid();
      dispatch({ kind: "branchStart", op: { stage: "inspecting", kind, chatId, through, request } });
      void send({ type: "chat.control", action: "inspect", id: chatId, request }).then((ok) => {
        if (!ok) dispatch({ kind: "branchTimeout", request });
      });
    },
    [state.currentChatId, state.branch, send],
  );
  const branch = state.branch;
  useEffect(() => {
    if (!branch || branch.stage !== "ready" || !branch.revision) return;
    const request = newUuid();
    const through = branch.through === "all" ? (branch.count ?? 0) : branch.through;
    dispatch({ kind: "forkSent", request });
    void send({ type: "chat.control", action: "fork", id: branch.chatId, request, revision: branch.revision, through, kind: branch.kind }).then((ok) => {
      if (!ok) dispatch({ kind: "branchTimeout", request });
    });
  }, [branch?.stage, branch?.revision]);
  const branchRequest = branch?.request;
  useEffect(() => {
    if (!branchRequest) return;
    const timer = setTimeout(() => dispatch({ kind: "branchTimeout", request: branchRequest }), 10_000);
    return () => clearTimeout(timer);
  }, [branchRequest]);
  const result = state.branchResult;
  useEffect(() => {
    if (!result) return;
    dispatch({ kind: "branchAck" });
    clearTimeout(toastTimer.current);
    setToast(result.created ? "Forked into a new chat" : "Opened the existing copy");
    toastTimer.current = setTimeout(() => setToast(undefined), 2400);
    if (result.draft !== "") setInsertion({ seq: ++quoteSeq.current, text: result.draft, mode: "restore" });
  }, [result]);
  // Why copying the chat is not possible now (the runtime refuses it for a running turn).
  const branchWhy = !state.currentChatId
    ? "There is no saved chat yet."
    : state.link !== "live" || state.runtime.state !== "running"
      ? "ATOM is not ready."
      : state.loop !== "idle"
        ? "Finish or stop the active turn first."
        : state.branch || state.mutation
          ? "Another change is waiting for ATOM."
          : undefined;

  // Model, thinking and access for this chat. Each is one command; the answer is the next `chats` event (or an error in words).
  const chatId = state.currentChatId;
  const settingsBlock = useMemo(() => settingsWhy(state), [state]);
  const modelBlock = useMemo(() => {
    if (state.link !== "live" || state.runtime.state !== "running") return "ATOM is not ready.";
    return currentChat(state)?.readOnly ? "This chat is written from another surface. It can be read here only." : undefined;
  }, [state]);
  const chooseModel = useCallback(
    (choice: { provider: string; model: string } | undefined) => {
      if (chatId) void send({ type: "chat.model", id: chatId, provider: choice?.provider ?? "", model: choice?.model ?? "" });
    },
    [chatId, send],
  );
  const reasoning = state.settings.reasoning;
  const chooseThinking = useCallback(
    (effort: string) => {
      if (chatId && reasoning && !settingsBlock && (effort === "" || reasoning.levels.includes(effort))) {
        void send({ type: "chat.reasoning", id: chatId, provider: reasoning.provider, model: reasoning.model, effort });
      }
    },
    [chatId, reasoning, settingsBlock, send],
  );
  const currentAccess = state.settings.access;
  const chooseAccess = useCallback(
    (mode: ChatAccessMode) => {
      if (chatId && currentAccess && !settingsBlock && mode !== currentAccess) void send({ type: "chat.access", id: chatId, mode, expected: currentAccess });
    },
    [chatId, currentAccess, settingsBlock, send],
  );

  // Every message is sent with a delivery id and its chat, so the runtime journals it before doing anything and answers with a receipt. A message with
  // files is handed over in two steps: the bridge stages each file and gives its path, then `text.send` carries the paths. The same File keeps its
  // staged path, so a retry has the identical fingerprint and the runtime recognises it. The runtime checks files only on receipt and a refusal sends
  // nothing, so the draft and the files stay in the composer until it takes the turn (a `transcript` event).
  const waiters = useRef<{ transcripts: number; errors: number; done: (ok: boolean) => void }[]>([]);
  useEffect(() => {
    for (const w of [...waiters.current]) {
      if (state.transcripts > w.transcripts) (waiters.current.splice(waiters.current.indexOf(w), 1), w.done(true));
      else if (state.errors > w.errors) (waiters.current.splice(waiters.current.indexOf(w), 1), w.done(false));
    }
  }, [state.transcripts, state.errors]);
  const staged = useRef(new WeakMap<File, string>());
  const sendMessage = useCallback(
    async (text: string, files: File[], request: string): Promise<boolean> => {
      const paths: string[] = [];
      for (const file of files) {
        let path = staged.current.get(file);
        if (!path) {
          const result = await transport.upload(file);
          if (!result.ok) {
            dispatch({ kind: "problem", problem: { message: result.message } });
            return false;
          }
          path = result.path;
          staged.current.set(file, path);
        }
        paths.push(path);
      }
      const chat = stateRef.current.currentChatId;
      const outcome = new Promise<boolean>((resolve) => {
        const waiter = { transcripts: stateRef.current.transcripts, errors: stateRef.current.errors, done: resolve };
        waiters.current.push(waiter);
        setTimeout(() => {
          const at = waiters.current.indexOf(waiter);
          if (at < 0) return;
          waiters.current.splice(at, 1);
          dispatch({ kind: "problem", problem: { message: "ATOM did not confirm the message. It may still arrive: check Recovery and the chat before sending it again. Sending it again as it is will not run it twice." } });
          resolve(false);
        }, 20_000);
      });
      if (!(await send({ type: "text.send", text, ...(paths.length > 0 ? { files: paths } : {}), ...(chat ? { request, chat } : {}) }))) return false;
      return outcome;
    },
    [send, transport],
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  // Unsent words per chat, the queue and held messages.
  const inputs = useInputs({
    state,
    transport,
    sendMessage,
    problem: (message) => dispatch({ kind: "problem", problem: { message } }),
    offer: (insertion) => setInsertion({ ...insertion, seq: ++quoteSeq.current }),
  });
  // What the runtime retains of accepted requests, and the Recovery view.
  const recovery = useRecovery({
    state,
    dispatch,
    send,
    pendingIds: inputs.api.pendingIds,
    inputsLoaded: inputs.api.loaded,
    offer: (insertion) => setInsertion({ ...insertion, seq: ++quoteSeq.current }),
    toast: (text) => {
      clearTimeout(toastTimer.current);
      setToast(text);
      toastTimer.current = setTimeout(() => setToast(undefined), 3200);
    },
  });
  // Stop ends the turn, declines what waits, and holds whatever was queued behind it.
  stopRef.current = () => {
    dispatch({ kind: "stopped" });
    inputs.holdCurrent();
    void send({ type: "talk.cancel" });
  };

  const blocked = useMemo(() => sendBlock(state), [state]);
  const chat = currentChat(state);

  return (
    <div class="lanes">
      <Rail active="chats" onOpen={() => {}} />
      <ChatList
        chats={state.chats}
        currentId={state.currentChatId}
        canAct={state.link === "live" && state.runtime.state === "running"}
        onOpen={(id) => void send({ type: "chat.open", id })}
        onNew={() => void send({ type: "chat.new" })}
        busy={state.loop !== "idle"}
        changing={state.mutation !== undefined}
        undo={state.undo}
        onRename={(id, title) => void send({ type: "chat.rename", id, title })}
        onFlags={flags}
        onDelete={(id) => void send({ type: "chat.delete", id })}
        onUndo={undoFlags}
        onDismissUndo={() => dispatch({ kind: "dismissUndo" })}
      />
      <ChatView
        chat={chat}
        messages={state.messages}
        loop={state.loop}
        problem={state.link === "unauthorized" ? { message: "This window has no access. Open ATOM from the address it printed, including the part after #." } : state.problem}
        blocked={blocked}
        work={state.work}
        approval={state.approval}
        modelLabel={state.ready?.model}
        onCopy={(content) => void copy(content)}
        onQuote={quote}
        controls={
          <ChatSettings
            info={state.info}
            settings={state.settings}
            effective={effectiveModel(state)}
            why={settingsBlock}
            modelWhy={modelBlock}
            onModel={chooseModel}
            onThinking={chooseThinking}
            onAccess={chooseAccess}
            onRefreshModels={() => void send({ type: "model.refresh" })}
          />
        }
        insertion={insertion}
        branchWhy={branchWhy}
        onBranch={startBranch}
        onStop={stop}
        onAnswer={answer}
        onSend={sendMessage}
        attachWhy={attachReason(state)}
        input={inputs.api}
        recoveryCount={recovery.count}
        onOpenRecovery={recovery.open}
        onDismissProblem={() => dispatch({ kind: "dismissProblem" })}
      />
      <Surface />
      <Recovery state={state.recovery} chats={state.chats} api={recovery} />
      {toast ? <div class="toast" role="status">{toast}</div> : null}
    </div>
  );
}
