// The window's state, as a pure function of what the runtime says. No DOM, no timers, no network: everything the window shows
// about a conversation is decided here, so it can be tested without a screen.

import type { ChatAccessMode, ChatItem, ChatReasoning, InfoEvent, IslandEvent, LoopState, RuntimeStatus } from "./protocol.ts";

export interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** The runtime's saved number (1-based). Absent for a turn that arrived live: fork, edit and retry need it, so they wait for a reopen. */
  seq?: number;
}

export interface Problem {
  /** `error` events carry a stage; a `notice` is milder and has none. */
  stage?: string;
  message: string;
}

/** The one action ATOM waits on the user to allow or decline (ADR-054). The review's text and token are never kept: this window cannot approve a file edit. */
export interface Approval {
  id: string;
  summary: string;
  reason: string;
  /** Offers "Allow for this chat" besides "Allow" (one exact file, ADR-136). */
  rememberFile?: true;
  /** The expanded complete-scope card for turning on Full access (ADR-181). */
  accessChange?: true;
  /** A file edit with a detailed review: only the native review can approve it, so here it can only be declined. */
  review?: true;
}

export type WorkOutcome = "working" | "done" | "stopped" | "failed";

/** What ATOM is doing on the computer, shown until the turn ends plus a moment. A port of WorkStripState.swift. */
export interface Work {
  step: string;
  outcome: WorkOutcome;
}

/** The first line of a step, up to its first sentence, cut to `limit` characters (IslandStatus.short). */
export function shortStep(text: string, limit = 80): string {
  const firstLine = text.split("\n")[0] ?? "";
  const end = firstLine.indexOf(". ");
  const sentence = (end >= 0 ? firstLine.slice(0, end) : firstLine).trim();
  return sentence.length <= limit ? sentence : `${sentence.slice(0, limit - 1)}…`;
}

/** A flags change (pin, archive) waiting for the runtime's answer. At most one at a time, as in ChatControlsModel.swift. */
export interface Mutation {
  /** The request UUID: the answer carries it, and nothing else is matched. */
  request: string;
  /** What to say when it succeeds, e.g. "Archived “Trip”". */
  done: string;
  /** This change is itself an Undo: it is confirmed, not offered for undoing again. */
  undoing?: true;
}

/** The last flags change, kept so it can be undone: the flags the chat had before, and the version that makes the undo conditional. */
export interface Undo {
  id: string;
  pinned: boolean;
  archived: boolean;
  version: number;
  said: string;
  /** False after an Undo has run: the notice only confirms. */
  undoable: boolean;
}

/** Copying a chat into a new one: inspect (revision and size), then fork. At most one at a time. */
export interface BranchOp {
  stage: "inspecting" | "ready" | "forking";
  kind: "fork" | "edit" | "retry";
  chatId: string;
  /** The saved number of the last message kept, or "all" for the whole chat. */
  through: number | "all";
  /** The request whose answer is awaited (inspect first, then the fork). */
  request: string;
  revision?: string;
  /** Messages in the chat when it was inspected. */
  count?: number;
}

/** A finished fork: what to tell the user, and the prompt to put back in the composer (never sent). */
export interface BranchResult {
  kind: BranchOp["kind"];
  draft: string;
  created: boolean;
}

/** What the runtime says about the chat in use: its own model (absent when it uses the default), its thinking choices and its access mode. */
export interface ChatSettings {
  provider?: string;
  model?: string;
  reasoning?: ChatReasoning;
  access?: ChatAccessMode;
  /** The project this chat belongs to. A project chat takes no attachments. */
  projectId?: string;
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
  /** The providers and models on offer, and the default model. From `info`. */
  info?: InfoEvent;
  settings: ChatSettings;
  /** The chat voice and typing go to. */
  currentChatId?: string;
  /** The chat whose messages are shown. Equal to `currentChatId` once its `chat.opened` arrived. */
  openChatId?: string;
  messages: Message[];
  problem?: Problem;
  approval?: Approval;
  work?: Work;
  mutation?: Mutation;
  undo?: Undo;
  branch?: BranchOp;
  branchResult?: BranchResult;
  /** How many turns the runtime accepted (`transcript`) and how many errors it reported: a send with files waits for one of them to move. */
  transcripts: number;
  errors: number;
  /** How many times the runtime has begun a turn (a `state` other than idle). A count cannot be missed by a render that skips the short state. */
  turnsStarted: number;
  /** Bumps on every reducer step that adds a message, so a view can scroll to the end. */
  nextId: number;
}

export const initialState: AppState = {
  link: "connecting",
  runtime: { state: "stopped" },
  loop: "idle",
  chats: [],
  settings: {},
  messages: [],
  transcripts: 0,
  errors: 0,
  turnsStarted: 0,
  nextId: 1,
};

export type Action =
  | { kind: "event"; event: IslandEvent }
  | { kind: "runtime"; status: RuntimeStatus }
  | { kind: "link"; link: Link }
  | { kind: "dismissProblem" }
  /** A flags change was sent. */
  | { kind: "mutating"; mutation: Mutation }
  /** No answer came in time: the change may or may not have happened. */
  | { kind: "mutationTimeout"; request: string }
  | { kind: "dismissUndo" }
  | { kind: "branchStart"; op: BranchOp }
  /** The inspect answered: the fork is sent under this new request id. */
  | { kind: "forkSent"; request: string }
  | { kind: "branchTimeout"; request: string }
  | { kind: "branchAck" }
  /** The user pressed Stop (or Esc). */
  | { kind: "stopped" }
  /** The user answered the pending request; it is gone at once so a stale prompt cannot approve a later action. */
  | { kind: "answered" }
  /** The moment the strip lingers after a turn is over. */
  | { kind: "workHide" }
  | { kind: "problem"; problem: Problem };

function withMessages(state: AppState, turns: { role: "user" | "assistant"; text: string; seq?: number }[]): Message[] {
  let id = state.nextId;
  return turns.map((turn) => ({ id: id++, role: turn.role, text: turn.text, ...(turn.seq !== undefined ? { seq: turn.seq } : {}) }));
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.kind) {
    case "link":
      return { ...state, link: action.link };
    case "runtime": {
      const runtime = action.status;
      // A runtime that is not running has no turn in flight, nothing it asked is still waiting, and a new run will say `ready` again.
      if (runtime.state === "running") return { ...state, runtime };
      const { ready: _ready, approval: _approval, work: _work, mutation: _mutation, branch: _branch, ...rest } = state;
      return { ...rest, runtime, loop: "idle" };
    }
    case "dismissProblem": {
      const { problem: _gone, ...rest } = state;
      return rest;
    }
    case "problem":
      return { ...state, problem: action.problem };
    case "mutating":
      return { ...dropUndo(state), mutation: action.mutation };
    case "dismissUndo":
      return dropUndo(state);
    case "branchStart":
      return { ...state, branch: action.op };
    case "forkSent":
      return state.branch ? { ...state, branch: { ...state.branch, stage: "forking", request: action.request } } : state;
    case "branchAck": {
      const { branchResult: _gone, ...rest } = state;
      return rest;
    }
    case "branchTimeout": {
      if (state.branch?.request !== action.request) return state;
      const { branch, ...rest } = state;
      return {
        ...rest,
        problem: {
          message: branch!.stage === "forking"
            ? "ATOM did not confirm the new chat. It may still have been created: look in the chat list before trying again."
            : "ATOM did not answer. Try again.",
        },
      };
    }
    case "mutationTimeout": {
      if (state.mutation?.request !== action.request) return state;
      const { mutation: _gone, ...rest } = state;
      return { ...rest, problem: { message: "ATOM did not confirm the chat change. Refresh the chat list before trying again." } };
    }
    case "stopped": {
      const { approval: _approval, ...rest } = state;
      return { ...rest, ...(state.work?.outcome === "working" ? { work: { ...state.work, outcome: "stopped" as const } } : {}) };
    }
    case "answered": {
      const { approval: _approval, ...rest } = state;
      return rest;
    }
    case "workHide": {
      const { work: _work, ...rest } = state;
      return rest;
    }
    case "event":
      return reduceEvent(state, action.event);
  }
}

function reduceEvent(state: AppState, event: IslandEvent): AppState {
  switch (event.type) {
    case "ready":
      return { ...state, ready: { provider: event.provider, model: event.model } };
    case "state": {
      if (event.state === "idle") return endWork({ ...dropApproval(state), loop: "idle" }, "done");
      // A new request: the old work is over and out of the way at once.
      if (event.state === "listening") return { ...dropWork(state), loop: event.state, turnsStarted: state.turnsStarted + 1 };
      return { ...state, loop: event.state, ...(state.loop === "idle" ? { turnsStarted: state.turnsStarted + 1 } : {}) };
    }
    case "computer.step":
      return { ...state, work: { step: shortStep(event.text), outcome: "working" } };
    case "computer.end":
      return endWork(state, "done");
    case "approval.request": {
      const approval: Approval = {
        id: event.id,
        summary: event.summary,
        reason: event.reason,
        ...(event.rememberFile ? { rememberFile: true as const } : {}),
        ...(event.accessChange ? { accessChange: true as const } : {}),
        ...(event.fileReview ? { review: true as const } : {}),
      };
      // One request at a time: a newer one replaces an older.
      return { ...state, approval, work: { step: shortStep(event.summary), outcome: "working" } };
    }
    case "approval.closed":
      return state.approval?.id === event.id ? dropApproval(state) : state;
    case "info":
      return { ...state, info: event };
    case "chats":
      return {
        ...state,
        chats: event.chats,
        currentChatId: event.current,
        settings: {
          ...(event.currentProvider ? { provider: event.currentProvider } : {}),
          ...(event.currentModel ? { model: event.currentModel } : {}),
          ...(event.reasoning ? { reasoning: event.reasoning } : {}),
          ...(event.access ? { access: event.access } : {}),
          ...(event.currentProjectId ? { projectId: event.currentProjectId } : {}),
        },
      };
    case "chat.opened": {
      const messages = withMessages(state, event.messages);
      return { ...state, openChatId: event.id, messages, nextId: state.nextId + messages.length };
    }
    case "conversation.reset":
      // A new chat: nothing to show yet. The `chats` event that follows names it.
      return { ...dropWork(dropApproval(state)), messages: [], openChatId: undefined };
    case "transcript":
    case "reply": {
      const role = event.type === "transcript" ? "user" : "assistant";
      const [message] = withMessages(state, [{ role, text: event.text }]);
      return { ...state, messages: [...state.messages, message!], nextId: state.nextId + 1, ...(event.type === "transcript" ? { transcripts: state.transcripts + 1 } : {}) };
    }
    case "chat.control": {
      const branch = state.branch;
      // The answers of a fork in progress. Only the one for the awaited request counts.
      if (branch && event.request === branch.request && (event.action === "inspect" || event.action === "fork")) {
        const { branch: _gone, ...rest } = state;
        if (!event.ok) return { ...rest, problem: { message: event.error ?? "ATOM could not copy the chat." } };
        if (event.action === "inspect" && branch.stage === "inspecting") {
          if (!event.revision || !event.info) return { ...rest, problem: { message: "ATOM did not describe the chat. Try again." } };
          return { ...state, branch: { ...branch, stage: "ready", revision: event.revision, count: event.info.messages } };
        }
        if (event.action === "fork" && branch.stage === "forking") {
          return { ...rest, branchResult: { kind: branch.kind, draft: event.branch?.draft ?? "", created: event.branch?.created ?? true } };
        }
        return state;
      }
      // Only the answer to our own flags request counts; a late or foreign one changes nothing.
      if (event.action !== "flags" || state.mutation?.request !== event.request) return state;
      const { mutation, ...rest } = state;
      if (!event.ok || !event.metadata) return { ...rest, problem: { message: event.error ?? "ATOM could not change the chat." } };
      const { previousPinned, previousArchived, version } = event.metadata;
      return { ...rest, undo: { id: event.id, pinned: previousPinned, archived: previousArchived, version, said: mutation!.done, undoable: !mutation!.undoing } };
    }
    case "notice":
      return { ...state, problem: { message: event.message } };
    case "error": {
      const next = { ...state, errors: state.errors + 1, problem: { stage: event.stage, message: event.message }, loop: event.stage === "model" ? ("idle" as const) : state.loop };
      // Errors about another command (settings, protocol) say nothing about the turn (ProtocolModels.swift `endsTurn`).
      return event.stage === "settings" || event.stage === "protocol" ? next : endWork(dropApproval(next), "failed");
    }
    default:
      // The other events belong to screens that are not ported yet (docs/cross-platform-migration.md).
      return state;
  }
}

function dropUndo(state: AppState): AppState {
  const { undo: _gone, ...rest } = state;
  return rest;
}

function dropApproval(state: AppState): AppState {
  const { approval: _gone, ...rest } = state;
  return rest;
}

function dropWork(state: AppState): AppState {
  const { work: _gone, ...rest } = state;
  return rest;
}

/** The turn is over: a strip that was working says how it ended (once). */
function endWork(state: AppState, outcome: Exclude<WorkOutcome, "working">): AppState {
  return state.work?.outcome === "working" ? { ...state, work: { ...state.work, outcome } } : state;
}

/** The provider and model that the next turn in this chat uses. */
export function effectiveModel(state: AppState): { provider: string; model: string } | undefined {
  const provider = state.settings.provider ?? state.info?.provider;
  const model = state.settings.model ?? state.info?.model;
  return provider && model ? { provider, model } : undefined;
}

/** Why the thinking and access menus cannot be used now (they change the next turn of an idle, writable chat); undefined when they can. */
export function settingsWhy(state: AppState): string | undefined {
  if (state.link !== "live" || state.runtime.state !== "running" || !state.ready) return "ATOM is not ready.";
  if (currentChat(state)?.readOnly) return "This chat is written from another surface. It can be read here only.";
  if (state.loop !== "idle") return "Finish or stop the active turn first.";
  return undefined;
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
  if (state.branch) return "ATOM is copying the chat into a new one.";
  if (currentChat(state)?.archived) return "This chat is archived. Unarchive it to continue.";
  return undefined;
}

/** Why this chat takes no attachments; undefined when it does. A project chat reads its folder instead (docs/island-protocol.md). */
export function attachWhy(state: AppState): string | undefined {
  return state.settings.projectId ? "Project chats take no attachments." : undefined;
}
