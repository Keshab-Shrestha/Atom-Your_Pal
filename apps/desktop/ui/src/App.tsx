import { useCallback, useEffect, useMemo, useReducer, useRef } from "preact/hooks";
import { ChatList } from "./ChatList.tsx";
import { ChatView } from "./ChatView.tsx";
import { Rail } from "./Rail.tsx";
import { Surface } from "./Surface.tsx";
import { newUuid } from "./ids.ts";
import { currentChat, initialState, reduce, sendBlock } from "./store.ts";
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

  const stop = useCallback(() => {
    dispatch({ kind: "stopped" });
    void send({ type: "talk.cancel" });
  }, [send]);

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
        onStop={stop}
        onAnswer={answer}
        onSend={(text) => send({ type: "text.send", text })}
        onDismissProblem={() => dispatch({ kind: "dismissProblem" })}
      />
      <Surface />
    </div>
  );
}
