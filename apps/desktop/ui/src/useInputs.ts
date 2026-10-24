// The unsent input of every chat, and what happens to it: it is kept per chat, saved by the bridge, and queued messages are sent one at a time
// when the chat is idle. Everything still waiting is HELD (never sent by itself) when Stop is pressed, a turn-ending error arrives, the chat is
// left or the runtime goes away. The rules themselves are in input.ts; this wires them to the runtime and the bridge.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Insertion } from "./Composer.tsx";
import { newUuid } from "./ids.ts";
import {
  emptyInput, enqueue, fromSaved, holdAll, markSending, nextToSend, savedKey, snapshot, started, take, toSaved,
  type ChatInput, type Entry, type Inputs,
} from "./input.ts";
import { sendBlock, type AppState } from "./store.ts";
import type { Transport } from "./transport.ts";

/** After a message is sent, the next one waits for the runtime to begin that turn, but never longer than this. */
const START_PATIENCE_MS = 10_000;

export interface InputApi {
  /** Saved drafts have been read (or could not be). The composer is shown only then, so it starts from what was kept. */
  loaded: boolean;
  chatId: string;
  current: ChatInput;
  working: boolean;
  /** Why no waiting message can be sent now; undefined when one can. */
  blocked: string | undefined;
  onSnapshot: (chatId: string, draft: string, files: File[]) => void;
  onFlushRegister: (flush: (() => void) | undefined) => void;
  onQueue: (text: string, files: File[]) => { ok: true } | { ok: false; why: string };
  onSendNow: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export interface UseInputs {
  api: InputApi;
  /** Stop was pressed: whatever waits is held. */
  holdCurrent: () => void;
}

export function useInputs(options: {
  state: AppState;
  transport: Transport;
  /** Sends one message and resolves true once the runtime has taken the turn (a transcript came back), false on a refusal or no answer. */
  sendMessage: (text: string, files: File[], confirm: boolean) => Promise<boolean>;
  problem: (message: string) => void;
  offer: (insertion: Omit<Insertion, "seq">) => void;
}): UseInputs {
  const { state, transport, sendMessage, problem, offer } = options;
  const chat = state.currentChatId ?? "";
  const [inputs, setInputs] = useState<Inputs>({});
  const ref = useRef(inputs);
  /** Applies a change at once (later steps in the same event see it) and shows it. */
  const apply = useCallback((change: (cur: Inputs) => Inputs) => {
    const next = change(ref.current);
    if (next === ref.current) return;
    ref.current = next;
    setInputs(next);
  }, []);
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [, tick] = useState(0);

  // ---- load once, when the link first comes up ----
  useEffect(() => {
    if (loaded || state.link !== "live") return;
    let stale = false;
    void transport.loadInput().then(({ saved, note }) => {
      if (stale) return;
      apply((cur) => ({ ...fromSaved(saved), ...cur })); // what was typed in the meantime wins
      if (note) problem(note);
      setLoaded(true);
    });
    return () => {
      stale = true;
    };
  }, [state.link, loaded]);

  // ---- save, a moment after the words change, and when the page is hidden or closed ----
  const failing = useRef(false);
  const persist = useCallback(
    async (keepalive: boolean) => {
      const saved = toSaved(ref.current);
      if (keepalive && JSON.stringify(saved).length > 60_000) return; // a closing page may send only a small request
      const ok = await transport.saveInput(saved, keepalive ? { keepalive: true } : undefined);
      if (!ok && !failing.current) problem("Your drafts could not be saved. They are kept while this window stays open.");
      failing.current = !ok;
    },
    [transport],
  );
  const key = savedKey(inputs);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => void persist(false), 300);
    return () => clearTimeout(timer);
  }, [key, loaded]);
  const flusher = useRef<(() => void) | undefined>(undefined);
  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  useEffect(() => {
    const onHide = () => {
      if (!loadedRef.current) return;
      flusher.current?.(); // the composer hands over its latest words first
      void persist(true);
    };
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persist]);

  // ---- hold everything that waits: leaving the chat, the runtime going away, an error that ends the turn ----
  const hold = useCallback((c: string) => apply((cur) => holdAll(cur, c)), [apply]);
  const previous = useRef(chat);
  useEffect(() => {
    if (previous.current !== chat) {
      hold(previous.current);
      previous.current = chat;
    }
  }, [chat]);
  useEffect(() => {
    if (state.runtime.state !== "running") hold(chat);
  }, [state.runtime.state]);
  useEffect(() => {
    const stage = state.problem?.stage;
    if (state.errors > 0 && stage !== "settings" && stage !== "protocol") hold(chat);
  }, [state.errors]);

  // ---- send waiting messages, one at a time ----
  const lastSend = useRef<{ turns: number; at: number } | undefined>(undefined);
  const run = useCallback(
    async (c: string, entry: Entry) => {
      lastSend.current = { turns: stateRef.current.turnsStarted, at: Date.now() };
      setTimeout(() => tick((n) => n + 1), START_PATIENCE_MS + 100); // re-check the patience limit even if nothing else changes
      apply((cur) => markSending(cur, c, entry.id));
      const ok = await sendMessage(entry.text, entry.files, true);
      apply((cur) => (ok ? started(cur, c, entry.id) : holdAll(cur, c)));
    },
    [apply, sendMessage],
  );
  const blocked = sendBlock(state);
  const idle = state.loop === "idle" && !state.approval && state.work?.outcome !== "working";
  const sentWhen = lastSend.current;
  const turnBegan = !sentWhen || state.turnsStarted > sentWhen.turns || Date.now() - sentWhen.at > START_PATIENCE_MS;
  const next = loaded ? nextToSend(inputs, chat) : undefined;
  useEffect(() => {
    if (next && idle && !blocked && turnBegan) void run(chat, next);
  }, [next?.id, idle, blocked, turnBegan, chat, loaded]);

  const api: InputApi = {
    loaded,
    chatId: chat,
    current: inputs[chat] ?? emptyInput(),
    working: state.loop !== "idle" || state.work?.outcome === "working",
    blocked,
    onSnapshot: useCallback((c, draft, files) => apply((cur) => snapshot(cur, c, draft, files)), [apply]),
    onFlushRegister: useCallback((flush) => void (flusher.current = flush), []),
    onQueue: (text, files) => {
      const result = enqueue(ref.current, chat, { id: newUuid(), text, files, lost: 0 });
      if (!result.ok) return { ok: false, why: result.why };
      apply(() => result.inputs);
      return { ok: true };
    },
    onSendNow: () => {
      const cur = ref.current[chat];
      const head = cur && cur.sending === undefined ? cur.queue[0] : undefined;
      if (head && !sendBlock(stateRef.current)) void run(chat, head); // text.send ends the turn in flight, as asked
    },
    onEdit: (id) => {
      const cur = ref.current[chat];
      const entry = cur && cur.sending !== id ? [...cur.queue, ...cur.held].find((e) => e.id === id) : undefined;
      if (!entry) return;
      // Moves only this entry into an empty composer; resending adds a new entry at the end. If the composer is not empty it stays where it is.
      offer({ mode: "restore", text: entry.text, files: entry.files, refusal: "Clear the composer first, then edit this message.", done: (placed) => placed && apply((c) => take(c, chat, id).inputs) });
    },
    onRemove: (id) => apply((cur) => take(cur, chat, id).inputs),
  };
  return { api, holdCurrent: () => hold(chat) };
}
