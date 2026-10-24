// The window's state, as a pure function of what the runtime says. No DOM, no timers, no network: everything the window shows
// about a conversation is decided here, so it can be tested without a screen.

import type { ChatItem, IslandEvent, LoopState, RuntimeStatus } from "./protocol.ts";

export interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
}

export interface Problem {
  /** `error` events carry a stage; a `notice` is milder and has none. */
  stage?: string;
  message: string;
}

/** The link between this page and the bridge. */
export type Link = "connecting" | "live" | "down" | "unauthorized";

export interface AppState {
  link: Link;
  runtime: RuntimeStatus;
  /** From the runtime's `ready`; absent until it has loaded. */
  ready?: { provider: string; model: string };
  loop: LoopState;
  chats: ChatItem[];
  /** The chat voice and typing go to. */
  currentChatId?: string;
  /** The chat whose messages are shown. Equal to `currentChatId` once its `chat.opened` arrived. */
  openChatId?: string;
  messages: Message[];
  problem?: Problem;
  /** Bumps on every reducer step that adds a message, so a view can scroll to the end. */
  nextId: number;
}

export const initialState: AppState = {
  link: "connecting",
  runtime: { state: "stopped" },
  loop: "idle",
  chats: [],
  messages: [],
  nextId: 1,
};

export type Action =
  | { kind: "event"; event: IslandEvent }
  | { kind: "runtime"; status: RuntimeStatus }
  | { kind: "link"; link: Link }
  | { kind: "dismissProblem" }
  | { kind: "problem"; problem: Problem };

function withMessages(state: AppState, turns: { role: "user" | "assistant"; text: string }[]): Message[] {
  let id = state.nextId;
  return turns.map((turn) => ({ id: id++, role: turn.role, text: turn.text }));
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.kind) {
    case "link":
      return { ...state, link: action.link };
    case "runtime": {
      const runtime = action.status;
      // A runtime that is not running has no turn in flight, and a new run will say `ready` again.
      if (runtime.state === "running") return { ...state, runtime };
      const { ready: _gone, ...rest } = state;
      return { ...rest, runtime, loop: "idle" };
    }
    case "dismissProblem": {
      const { problem: _gone, ...rest } = state;
      return rest;
    }
    case "problem":
      return { ...state, problem: action.problem };
    case "event":
      return reduceEvent(state, action.event);
  }
}

function reduceEvent(state: AppState, event: IslandEvent): AppState {
  switch (event.type) {
    case "ready":
      return { ...state, ready: { provider: event.provider, model: event.model } };
    case "state":
      return { ...state, loop: event.state };
    case "chats":
      return { ...state, chats: event.chats, currentChatId: event.current };
    case "chat.opened": {
      const messages = withMessages(state, event.messages);
      return { ...state, openChatId: event.id, messages, nextId: state.nextId + messages.length };
    }
    case "conversation.reset":
      // A new chat: nothing to show yet. The `chats` event that follows names it.
      return { ...state, messages: [], openChatId: undefined };
    case "transcript":
    case "reply": {
      const role = event.type === "transcript" ? "user" : "assistant";
      const [message] = withMessages(state, [{ role, text: event.text }]);
      return { ...state, messages: [...state.messages, message!], nextId: state.nextId + 1 };
    }
    case "notice":
      return { ...state, problem: { message: event.message } };
    case "error":
      return { ...state, problem: { stage: event.stage, message: event.message }, loop: event.stage === "model" ? "idle" : state.loop };
    default:
      // The other events belong to screens that are not ported yet (docs/cross-platform-migration.md).
      return state;
  }
}

/** The chat to show for the current one: its row in the list. */
export function currentChat(state: AppState): ChatItem | undefined {
  return state.chats.find((chat) => chat.id === state.currentChatId);
}

/** Whether a message can be sent now, and if not, why in words the user can act on. */
export function sendBlock(state: AppState): string | undefined {
  if (state.link !== "live") return "The window lost its connection to ATOM. It reconnects by itself.";
  switch (state.runtime.state) {
    case "running":
      break;
    case "restarting":
      return `ATOM's runtime stopped and restarts in ${state.runtime.afterSeconds} s.`;
    case "configError":
      return state.runtime.message;
    case "failed":
      return state.runtime.message;
    case "stopped":
      return "ATOM's runtime is not running.";
  }
  if (!state.ready) return "ATOM is starting.";
  if (currentChat(state)?.readOnly) return "This chat is written from another surface (Telegram or the local API). Open it to read it only.";
  return undefined;
}
