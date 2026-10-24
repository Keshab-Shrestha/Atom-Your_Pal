import { useCallback, useEffect, useMemo, useReducer, useRef } from "preact/hooks";
import { ChatList } from "./ChatList.tsx";
import { ChatView } from "./ChatView.tsx";
import { Rail } from "./Rail.tsx";
import { Surface } from "./Surface.tsx";
import { currentChat, initialState, reduce, sendBlock } from "./store.ts";
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
      />
      <ChatView
        chat={chat}
        messages={state.messages}
        loop={state.loop}
        problem={state.link === "unauthorized" ? { message: "This window has no access. Open ATOM from the address it printed, including the part after #." } : state.problem}
        blocked={blocked}
        modelLabel={state.ready?.model}
        onSend={(text) => send({ type: "text.send", text })}
        onDismissProblem={() => dispatch({ kind: "dismissProblem" })}
      />
      <Surface />
    </div>
  );
}
