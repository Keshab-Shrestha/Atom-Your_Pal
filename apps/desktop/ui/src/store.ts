// The window's state, as a pure function of what the runtime says. No DOM, no timers, no network: everything the window shows
// about a conversation is decided here, so it can be tested without a screen.

import type { SkillInfo, SlashCommandInfo } from "./slash.ts";
import { NOT_CONFIRMED, NOT_LOADED } from "./brief.ts";
import type { Cursor } from "./saved-chat.ts";
import { interrupt, validWork, type WorkLog } from "./work-log.ts";
import type { SavedInfo, SavedPart, Attempt, ChatAccessMode, ChatItem, ChatReasoning, InfoEvent, IslandEvent, LoopState, Receipt, RecoveryRecord, RuntimeStatus } from "./protocol.ts";

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

/** The Recovery view: what the runtime retains of accepted requests. At most one request of each kind is in flight, matched by its UUID. */
export interface RecoveryState {
  open: boolean;
  attempts: Attempt[];
  record?: RecoveryRecord;
  listing?: string;
  reading?: string;
  dismissing?: string;
  notice?: string;
  /** Delivery ids the host confirmed holding, from the last list. The local copies of those are no longer needed. */
  known: string[];
  /** Question-card ids whose answers the host confirmed holding, from the last list. The local copies of those are no longer needed. */
  knownAnswers: string[];
  /** Counts the lists that arrived, so a change can be acted on once. */
  listed: number;
}

/** The link between this page and the bridge. */
export type Link = "connecting" | "live" | "down" | "unauthorized";

/** The chat brief editor: what was last loaded or saved, and the one request in flight (ADR-091). The draft itself lives in the editor. */
export interface BriefState {
  /** The chat the brief belongs to. */
  chatId: string;
  /** The brief as the runtime has it. The next save is conditional on its version, so it can never overwrite a newer one. */
  saved?: { text: string; version: number };
  /** Counts loads, so the editor replaces its draft once for each. */
  loads: number;
  doing?: { what: "loading" | "reloading" | "saving"; request: string; text?: string; version?: number };
  /** A save was sent and no answer came in time. Asking again with the same request id cannot overwrite a newer brief. */
  unconfirmed?: { request: string; text: string; version: number };
  /** What happened, in words. `saved` means the last save was confirmed, so the editor words it against the draft. */
  note?: string;
  result?: "saved" | "problem";
}

/** Saved history: read-only pages of the saved archive. An answer replaces the page; a failed read keeps the one on screen. */
export interface HistoryState {
  chatId: string;
  /** The page being asked for, and what the cursor trail becomes if it arrives. */
  reading?: { request: string; cursor: Cursor; previous: Cursor[] };
  cursor: Cursor;
  /** Where Previous goes back to. */
  previous: Cursor[];
  page?: { parts: SavedPart[]; next?: Cursor; revision?: string };
  note?: string;
}

/** "What this chat remembers": the runtime's description of what it replays for this chat. */
export interface RemembersState {
  chatId: string;
  request?: string;
  info?: SavedInfo;
  note?: string;
}

export interface AppState {
  link: Link;
  runtime: RuntimeStatus;
  /** From the runtime's `ready`; absent until it has loaded. */
  ready?: { provider: string; model: string };
  loop: LoopState;
  chats: ChatItem[];
  /** The providers and models on offer, and the default model. From `info`. */
  info?: InfoEvent;
  /** The skills and Claude commands the "/" picker offers. From `helpers` and `commands`; empty until the runtime has answered. */
  slash: { skills: SkillInfo[]; commands: SlashCommandInfo[] };
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
  recovery: RecoveryState;
  brief?: BriefState;
  /** The foreground work log of the turn in view (ADR-156): temporary, never restored from saved history. */
  workLog?: WorkLog;
  history?: HistoryState;
  remembers?: RemembersState;
  /** The newest receipt for an accepted request. `n` counts them, so each is handled once. */
  receipt?: Receipt & { n: number };
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
  slash: { skills: [], commands: [] },
  settings: {},
  messages: [],
  transcripts: 0,
  errors: 0,
  turnsStarted: 0,
  recovery: { open: false, attempts: [], known: [], knownAnswers: [], listed: 0 },
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
  | { kind: "historyAsk"; chatId: string; request: string; cursor: Cursor; previous: Cursor[] }
  | { kind: "historyTimeout"; request: string }
  | { kind: "historyClose" }
  | { kind: "remembersAsk"; chatId: string; request: string }
  | { kind: "remembersTimeout"; request: string }
  | { kind: "remembersClose" }
  | { kind: "briefOpen"; chatId: string; request: string }
  | { kind: "briefReload"; request: string }
  | { kind: "briefSave"; request: string; text: string; version: number }
  | { kind: "briefTimeout"; request: string }
  | { kind: "briefClose" }
  | { kind: "recoveryOpen"; open: boolean }
  /** `keep`: the next part of the record already on screen is being read, so it stays until the part arrives. */
  | { kind: "recoveryAsk"; what: "listing" | "reading" | "dismissing"; request: string; keep?: boolean }
  | { kind: "recoveryTimeout"; request: string }
  | { kind: "recoveryNotice"; notice: string | undefined }
  | { kind: "recoveryRecord"; record: RecoveryRecord | undefined }
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
      // Without the runtime in view, the log stops counting and says it was interrupted.
      return { ...state, link: action.link, ...(action.link !== "live" && state.workLog ? { workLog: interrupt(state.workLog) } : {}) };
    case "runtime": {
      const runtime = action.status;
      // A runtime that is not running has no turn in flight, nothing it asked is still waiting, and a new run will say `ready` again.
      if (runtime.state === "running") return { ...state, runtime };
      const { ready: _ready, approval: _approval, work: _work, mutation: _mutation, branch: _branch, workLog, ...rest } = state;
      // Nothing asked of the runtime is still being waited for; what it retained stays shown until the next list.
      const { listing: _l, reading: _r, dismissing: _d, ...recovery } = state.recovery;
      return { ...rest, recovery, runtime, loop: "idle", ...(workLog ? { workLog: interrupt(workLog) } : {}) };
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
    case "historyAsk": {
      const same = state.history?.chatId === action.chatId ? state.history : undefined;
      return { ...state, history: { chatId: action.chatId, cursor: same?.cursor ?? action.cursor, previous: same?.previous ?? [], ...(same?.page ? { page: same.page } : {}), reading: { request: action.request, cursor: action.cursor, previous: action.previous } } };
    }
    case "historyTimeout": {
      const h = state.history;
      if (!h?.reading || h.reading.request !== action.request) return state;
      const { reading: _gone, ...rest } = h;
      return { ...state, history: { ...rest, note: "The history did not arrive. Reload to try again." } };
    }
    case "historyClose": {
      const { history: _gone, ...rest } = state;
      return rest;
    }
    case "remembersAsk":
      return { ...state, remembers: { chatId: action.chatId, request: action.request, ...(state.remembers?.chatId === action.chatId && state.remembers.info ? { info: state.remembers.info } : {}) } };
    case "remembersTimeout": {
      const r = state.remembers;
      if (!r || r.request !== action.request) return state;
      const { request: _gone, ...rest } = r;
      return { ...state, remembers: { ...rest, note: "The saved details did not arrive. Refresh to try again." } };
    }
    case "remembersClose": {
      const { remembers: _gone, ...rest } = state;
      return rest;
    }
    case "briefOpen":
      return { ...state, brief: { chatId: action.chatId, loads: 0, doing: { what: "loading", request: action.request } } };
    case "briefReload": {
      const { brief } = state;
      if (!brief) return state;
      const { note: _n, result: _r, ...rest } = brief;
      return { ...state, brief: { ...rest, doing: { what: "reloading", request: action.request } } };
    }
    case "briefSave": {
      const { brief } = state;
      if (!brief) return state;
      const { note: _n, result: _r, unconfirmed: _u, ...rest } = brief;
      return { ...state, brief: { ...rest, doing: { what: "saving", request: action.request, text: action.text, version: action.version } } };
    }
    case "briefTimeout": {
      const { brief } = state;
      if (!brief?.doing || brief.doing.request !== action.request) return state;
      const { doing, ...rest } = brief;
      if (doing.what === "saving") return { ...state, brief: { ...rest, unconfirmed: { request: doing.request, text: doing.text!, version: doing.version! }, note: NOT_CONFIRMED, result: "problem" } };
      return { ...state, brief: { ...rest, note: NOT_LOADED, result: "problem" } };
    }
    case "briefClose": {
      const { brief: _gone, ...rest } = state;
      return rest;
    }
    case "recoveryOpen":
      return { ...state, recovery: { ...state.recovery, open: action.open, ...(action.open ? {} : { record: undefined, notice: undefined }) } };
    case "recoveryAsk":
      return { ...state, recovery: { ...state.recovery, [action.what]: action.request, ...(action.what === "reading" ? { notice: undefined, ...(action.keep ? {} : { record: undefined }) } : {}) } };
    case "recoveryNotice":
      return { ...state, recovery: { ...state.recovery, notice: action.notice } };
    case "recoveryRecord":
      return { ...state, recovery: { ...state.recovery, record: action.record } };
    case "recoveryTimeout": {
      const r = state.recovery;
      const which = r.listing === action.request ? "listing" : r.reading === action.request ? "reading" : r.dismissing === action.request ? "dismissing" : undefined;
      if (!which) return state;
      const { [which]: _gone, ...rest } = r;
      return { ...state, recovery: { ...rest, notice: "Recovery was not confirmed. Local copies remain held. Refresh and review saved history before retrying; nothing is resent automatically." } };
    }
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
    case "helpers":
      // The event is large (workers, models, plugins); the picker only needs the skills. A name with white space could not be typed, so it is left out.
      return event.skills ? { ...state, slash: { ...state.slash, skills: event.skills.filter((s) => /^\S+$/u.test(s.name)).map((s) => ({ name: s.name, description: s.description ?? "" })) } } : state;
    case "commands":
      return { ...state, slash: { ...state.slash, commands: event.commands.filter((c) => /^\S+$/u.test(c.name)).map((c) => ({ name: c.name, description: c.description ?? "", hint: c.hint ?? "" })) } };
    case "foreground.receipt":
      return { ...state, receipt: { ...event, n: (state.receipt?.n ?? 0) + 1 } };
    case "foreground.recovery": {
      const r = state.recovery;
      if (r.listing === event.request) {
        const { listing: _l, ...rest } = r;
        if (!event.ok) return { ...state, recovery: { ...rest, notice: event.error } };
        const attempts = event.attempts ?? [];
        const stale = rest.record && !attempts.some((a) => a.id === rest.record!.id);
        return { ...state, recovery: { ...rest, attempts, known: event.known ?? [], knownAnswers: event.knownAnswers ?? [], listed: r.listed + 1, ...(stale ? { record: undefined } : {}) } };
      }
      if (r.reading === event.request) {
        const { reading: _r, ...rest } = r;
        return { ...state, recovery: event.ok && event.record ? { ...rest, record: event.record } : { ...rest, notice: event.error ?? "That recovery record could not be read." } };
      }
      if (r.dismissing === event.request) {
        const { dismissing: _d, ...rest } = r;
        // A dismissed record leaves the list at once; the next list confirms it.
        const gone = r.record?.id;
        return { ...state, recovery: event.ok ? { ...rest, record: undefined, attempts: r.attempts.filter((a) => a.id !== gone) } : { ...rest, notice: event.error } };
      }
      return state;
    }
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
      // The work log belongs to one turn of one chat; another chat shows none.
      const { workLog, ...rest } = state;
      return { ...rest, ...(workLog && workLog.work.chat === event.id ? { workLog } : {}), openChatId: event.id, messages, nextId: state.nextId + messages.length };
    }
    case "chat.work":
      return validWork(event) ? { ...state, workLog: { work: event, n: (state.workLog?.n ?? 0) + 1 } } : state;
    case "conversation.reset": {
      // A new chat: nothing to show yet. The `chats` event that follows names it.
      const { workLog: _gone, ...rest } = dropWork(dropApproval(state));
      return { ...rest, messages: [], openChatId: undefined };
    }
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
      // The saved history's pages and "What this chat remembers": their own requests, for their own chat.
      const reading = state.history?.reading;
      if (state.history && reading && event.action === "page" && event.request === reading.request && event.id === state.history.chatId) {
        const { reading: _gone, ...rest } = state.history;
        if (!event.ok || !event.page) return { ...state, history: { ...rest, note: event.error ?? "ATOM could not read the saved history." } };
        const { messages, nextMessage, nextOffset } = event.page;
        const { note: _n, ...clean } = rest;
        return { ...state, history: { ...clean, cursor: reading.cursor, previous: reading.previous, page: { parts: messages, ...(nextMessage !== undefined ? { next: { message: nextMessage, offset: nextOffset ?? 0 } } : {}), ...(event.revision ? { revision: event.revision } : {}) } } };
      }
      const asking = state.remembers;
      if (asking?.request && event.action === "inspect" && event.request === asking.request && event.id === asking.chatId) {
        const { request: _gone, note: _n, ...rest } = asking;
        return { ...state, remembers: event.ok && event.info ? { ...rest, info: event.info } : { ...rest, note: event.error ?? "ATOM could not read the saved details." } };
      }
      // The brief editor's answers: its own request, for its own chat.
      const editor = state.brief;
      if (editor && event.id === editor.chatId && (event.action === "inspect" || event.action === "brief")) {
        const awaited = editor.doing?.request === event.request ? editor.doing : editor.unconfirmed?.request === event.request ? { what: "saving" as const } : undefined;
        if (awaited && (awaited.what === "saving") === (event.action === "brief")) {
          const { doing: _d, unconfirmed: _u, note: _n, result: _r, ...rest } = editor;
          if (!event.ok || !event.brief) return { ...state, brief: { ...rest, note: event.error ?? (awaited.what === "saving" ? "The brief was not saved. Your draft is unchanged." : "ATOM could not load the saved brief."), result: "problem" as const } };
          const loaded = { ...rest, saved: event.brief, loads: awaited.what === "saving" ? rest.loads : rest.loads + 1 };
          return { ...state, brief: awaited.what === "saving" ? { ...loaded, result: "saved" as const } : { ...loaded, ...(editor.doing?.what === "reloading" ? { note: "Loaded the saved brief." } : {}) } };
        }
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
