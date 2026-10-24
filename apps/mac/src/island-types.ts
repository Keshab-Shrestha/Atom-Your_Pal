// The shapes the island session depends on (moved from island.ts): the owner of each area implements its interface.

import type { ProjectSourceRequest, ProjectSourceResponse } from "./project-sources.ts";
import type { ChatControlRequest, ChatControlResponse } from "./chat-controls.ts";
import type { ChatWorkBridge } from "./chat-work.ts";
import type { ForegroundStore } from "@atom/memory";
import type { ChatTurns } from "./chat-turns.ts";
import type { HubCommands } from "./hub-commands.ts";
import type { Readable } from "node:stream";
import type { Logger } from "@atom/shared";
import type { Message } from "@atom/contracts";
import { type EpisodeItem, type HelperItem, type ModelItem, type MemoryItem, type SuggestionItem, type BriefItem, type BriefSettingsItem, type MemoryChatItem, type SoulItem, type ThreadEvent, type SearchHitItem, type PaperclipItem, type PlanItem, type BrainNodeItem, type BrainEdgeItem, type BrainNoteItem, type BrainHitItem, type McpItem, type SkillDraftItem, type SkillEditItem, type TestCaseItem, type UsageItem, type ChatItem, type ProjectItem, type GitBranchItem, type RoutineInput } from "./island-protocol.ts";
import type { BriefChange } from "./island-commands.ts";
import type { EverythingResults } from "./everything-search.ts";
import type { ComputerBridge } from "./computer-bridge.ts";
import type { WindowPointer } from "./screen-context.ts";
import type { ModelSettings } from "./model-settings.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";
import { type Capability } from "@atom/tool-engine";
import type { ApiServer } from "./api-server.ts";
import { type CoreLike, type VoiceLoopEvents, type VoiceLoopOptions } from "./voice-loop.ts";

export interface IslandOptions {
  localBackup?: ReturnType<typeof import("./local-backup.ts").createLocalBackup>;
  sourceAnalysis?: Pick<ReturnType<typeof import("./source-analysis.ts").createSourceAnalysis>, "handle" | "interrupt">;
  /** Commands from the island, one JSON object per line. */
  input: Readable;
  /** Writes one encoded event line to the island. */
  write(line: string): void;
  record: VoiceLoopOptions["record"];
  stt: SpeechToText;
  /** ADR-091: a Core that can resume a saved chat names its session (the chat voice and typing go to). */
  core: CoreLike & { reset(): void; resume?(id: string, turns: readonly Message[]): void; readonly sessionId?: string; readonly busy?: boolean };
  tts: TextToSpeech;
  /** Reported in the `ready` event. ADR-098: `telegram` is true when ATOM's Telegram bot is set up in .env. */
  info: { provider: string; model: string; microphone: string; telegram?: boolean; computer?: boolean };
  /** ADR-098: Settings' "Send to Telegram" switch. Absent when Telegram is not set up: `telegram.set` does nothing. */
  telegram?: { setPush(on: boolean): void };
  /** ADR-098 item 5: the local API. Absent (voice-only mode): `api.set` answers with `on: false` and an error. */
  api?: Pick<ApiServer, "set" | "regenerate">;
  /** The AI model choice: sent as `info` after `ready`, changed by `model.set`. Without it, `model.set` is refused. */
  settings?: Pick<ModelSettings, "info" | "setModel" | "scanTools" | "refreshModels">;
  /** Computer control (ADR-054): shows what ATOM is doing and asks before risky actions. Absent when it is off. */
  computer?: Pick<ComputerBridge, "attach" | "answer" | "cancelAll" | "setForeground"> & Partial<Pick<ComputerBridge, "setDecisions" | "decisionResult">>;
  /** Window task/retry turns have their own Core, outside the foreground voice/text loop. */
  taskActivity?: { busy(): boolean; onChange(listener: () => void): () => void };
  chatWork?: ChatWorkBridge;
  foreground?: ForegroundStore & { profile(chat: string, source: "voice" | "text"): { provider: string; model: string } };
  /** What ATOM keeps (ADR-058), for Settings. Absent when memory is off: `memory.*` answers `enabled: false`. */
  memory?: IslandMemory;
  /** The second brain (Memory → Graph). */
  brain?: IslandBrain;
  replyDrafts?: import("./reply-drafts.ts").ReplyDrafts;
  /** The "/" picker: Keshab's Claude commands, read from ~/.claude/commands (ADR-117). */
  slashCommands?: { list(): { name: string; description: string; hint: string }[] };
  /** Plugins → Skills: open a skill's SKILL.md and save Keshab's edit. `write` throws with words for the user. */
  skillFiles?: {
    read(name: string): { name: string; source: "yours" | "zeno"; text: string } | undefined;
    write(name: string, text: string): { name: string; source: "yours" | "zeno"; text: string };
  };
  /** ADR-091: chat sessions. Absent when memory is off. */
  chats?: IslandChats;
  /** Who is answering in which chat: a second turn in a chat that is answering is refused (the window and the phone share a chat). */
  chatTurns?: ChatTurns;
  /** Ask ATOM (upgrades.md B3). Absent: `text.edit` answers with an error. */
  textEdit?: IslandTextEdit;
  /** Daily brief (upgrades.md C3). Absent when memory is off: `brief.*` answer with the defaults. */
  dailyBrief?: IslandDailyBrief;
  /** Remembering by itself (upgrades.md C2). Absent when memory is off: `suggestions.*` answer with none. */
  suggestions?: IslandSuggestions;
  /** Search everything (upgrades.md C1): Second brain pages, facts, notes, projects, agents, skills, routines. Absent: only chats, tasks and reports. */
  everything?: { search(query: string): EverythingResults };
  /** ADR-113: files attached to a typed message. Absent: a message with files is refused. */
  attachments?: { add(chatId: string, paths: readonly string[]): { ok: true; text: string } | { error: string } };
  /** ADR-107: projects. Absent when memory is off: `project.*` and `chat.new` with a project are refused. */
  projects?: IslandProjects;
  workspace?: Pick<ReturnType<typeof import("./project-workspace.ts").createProjectWorkspace>, "handle"> & Partial<Pick<ReturnType<typeof import("./project-workspace.ts").createProjectWorkspace>, "git">>;
  /** ADR-091: ATOM's task branches. */
  git?: IslandGit;
  /** Helpers and their jobs (ADR-081). Absent when their file could not be opened: no helpers are listed. */
  helpers?: IslandHelpers;
  /** Pal dropped on a window (ADR-074): reads that app once for the next request. Absent: `context.window` is refused. */
  screen?: Pick<WindowPointer, "point" | "clear">;
  /**
   * "What can I ask?" (ADR-076): the tools that are on, for the model in use. Sent as `capabilities` after `ready`,
   * and again after a model switch, since Claude plan web search depends on the provider.
   */
  capabilities?(): Capability[];
  /** Claude plan usage reports (ADR-076), forwarded as `plan.usage`. Returns a function that stops listening. */
  onPlanUsage?(listener: (usage: { fiveHour?: number; sevenDay?: number; overage?: boolean }) => void): () => void;
  /** Plays a short sound before a timer is announced (optional). */
  chime?(): Promise<void>;
  /** Timers (ADR-061): subscribe to timers ending, to announce them. */
  onTimer?(listener: (timer: { id: number; label: string; seconds: number }) => void): () => void;
  /** Goals Pal handed out (Task 3.5) and plans waiting (Task 3.8): a line to say when idle, then `after`. */
  onGoalLine?(listener: (line: string, after?: () => void) => void): () => void;
  micName(): Promise<string>;
  /** Plain-language error text for the user. */
  describe(error: unknown): string;
  /** Extra error fields for model errors (gateway kind, retryable). */
  errorDetails?(error: unknown): { kind?: string; retryable?: boolean };
  /** Wraps the loop events, e.g. to add logging. */
  wrapEvents?(events: VoiceLoopEvents): VoiceLoopEvents;
  log?: Pick<Logger, "info" | "warn" | "error">;
  /** Called once, after the microphone and speech are released, when the session ends. */
  onQuit(): void;
  silenceWarnMs?: number;
  levelIntervalMs?: number;
}

/** The second brain as the window sees it (services/memory/src/brain.ts). Each method throws, with words for the user, on a bad note. */
export interface IslandBrain {
  source?(request: import("./brain-source-folder.ts").BrainSourceRequest): Promise<import("./brain-source-folder.ts").BrainSourceResponse>;
  graph(): { nodes: BrainNodeItem[]; edges: BrainEdgeItem[]; omitted: number; tags: { tag: string; count: number }[] };
  note(id: number): BrainNoteItem | undefined;
  /** Saves a new note, or changes the note with `id` (a new title renames it). Returns the note. */
  save(input: { id?: number; title: string; body: string }): BrainNoteItem;
  remove(id: number): boolean;
  search(query: string): BrainHitItem[];
  /** Called after the brain changed (a note saved, memory mirrored). Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

export interface IslandMemory {
  list(): MemoryItem[];
  count(): number;
  forget(id: number): boolean;
  clear(): number;
  /** Conversation summaries (ADR-059), newest first. */
  episodes(): EpisodeItem[];
  forgetEpisode(id: number): boolean;
  clearEpisodes(): number;
  /** ADR-097: recent chats and kept chats, for the Memory page. */
  chats?(): MemoryChatItem[];
  /** ADR-097: starts keeping a chat (the summary and index are written in the background). False when there is no such chat. */
  keepChat?(id: string): boolean;
  dropChat?(id: string): boolean;
  /** Called after ATOM keeps or forgets something by itself (the remember / forget tools). Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

/** Remembering by itself (upgrades.md C2): the facts the notes noticed, waiting for the user's Accept. */
export interface IslandSuggestions {
  list(): SuggestionItem[];
  enabled(): boolean;
  setEnabled(on: boolean): void;
  /** Keeps the fact (with the user's edit, if any). Throws, with words for the user, when it cannot be kept. */
  accept(id: number, text?: string): void;
  deny(id: number): boolean;
  onChange(listener: () => void): () => void;
}

/** Ask ATOM (upgrades.md B3): rewrites text as asked. Rejects with words for the user; an abort rejects too. */
export interface IslandTextEdit {
  edit(req: { text: string; selection?: [number, number]; instruction: string }, signal: AbortSignal): Promise<{ answer: string; changed: boolean }>;
}

/** Daily brief (upgrades.md C3). */
export interface IslandDailyBrief {
  state(): { settings: BriefSettingsItem; history: BriefItem[]; running: boolean; preparationBudget?: import("@atom/memory").PreparationBudget; preparationModel?: string; notice?: string };
  /** Starts a brief now (the answer comes as a `brief` event). */
  run(): void;
  /** Changes the given settings. Throws, with words for the user, for a value that is not allowed. */
  update(change: BriefChange): void;
  selectNote?(id: number, included: boolean): void;
  onChange(listener: () => void): () => void;
}

/** ADR-091: ATOM's task branches; pushing one is Keshab's alone (the window asks him to confirm first). */
export interface IslandGit {
  list(): Promise<GitBranchItem[]>;
  push(repo: string, branch: string): Promise<void>;
  diff(repo: string, branch: string): Promise<{ text: string; truncated: boolean }>;
}

/** ADR-091: Keshab's chat sessions with ATOM (kept on this Mac). */
export interface IslandChats {
  confirmFullAccess?(id: string, expected: import("@atom/contracts").ChatAccessMode, signal: AbortSignal): Promise<boolean>;
  accessOf?(id: string): import("@atom/contracts").ChatAccessMode;
  setAccess?(id: string, mode: import("@atom/contracts").ChatAccessMode, expected: import("@atom/contracts").ChatAccessMode): { ok: true } | { error: string };
  reasoningOf?(id: string): import("./model-settings.ts").ChatReasoning;
  setReasoning?(id: string, provider: string, model: string, effort: string): { ok: true } | { error: string };
  lastOpened?(): string | undefined;
  rememberOpened?(id: string | undefined): void;
  control?(command: ChatControlRequest): ChatControlResponse;
  metadataOf?(id: string): { pinned: boolean; archived: boolean; version: number } | undefined;
  list(): ChatItem[];
  messages(id: string): Message[];
  remove(id: string): boolean;
  /** ADR-097: a chat's own model; undefined when it uses the default. */
  modelOf?(id: string): { provider: string; model: string } | undefined;
  /** ADR-097: sets a chat's own model (provider and model "": the default again). Validated like `model.set`. */
  setModel?(id: string, provider: string, model: string): { ok: true } | { error: string };
  /** ADR-098: chats whose messages match the words, best first (at most 20). */
  search?(query: string): SearchHitItem<string>[];
  /** ADR-107: a chat's own title (the runtime refuses a bad title or a chat that is not saved yet). */
  rename?(id: string, title: string): { ok: true } | { error: string };
  /** ADR-107: the chat's project (also for a new chat not saved yet); undefined for a plain chat. */
  projectOf?(id: string): string | undefined;
  /** ADR-107: the turns the Core gets when a chat is opened: all of them, or the newest few of a long project chat (`trimmed`). */
  replay?(id: string, turns: Message[]): { turns: Message[]; trimmed: boolean };
  /** Called after a chat is saved. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
  /** ADR-109: called with the chat id after a goal's result was posted into it. Returns an unsubscribe. */
  onPosted?(listener: (chatId: string) => void): () => void;
}

/** ADR-107: the result of a project command: done, or why not in words for Keshab. */
export type ProjectResult = { ok: true } | { error: string };

/** ADR-107: projects (a named folder and its chats). Every method checks its input and never throws for a bad one. */
export interface IslandProjects {
  create?(input: ProjectSourceRequest, signal: AbortSignal): Promise<ProjectSourceResponse>;
  list(): ProjectItem[];
  add(name: string, path: string): ProjectResult;
  rename(id: string, name: string): ProjectResult;
  /** Chats stay as plain chats unless `deleteChats`. Files are never touched; the project's Agent is kept. */
  remove(id: string, deleteChats: boolean): ProjectResult;
  archive(id: string, archived: boolean): ProjectResult;
  /** provider and model "": the project has no model of its own. */
  setModel(id: string, provider: string, model: string): ProjectResult;
  setWeb(id: string, web: boolean): ProjectResult;
  /** Is there a project, not archived, that can take a new chat? */
  startChat(projectId: string): ProjectResult;
  /** Puts the chat (new, maybe not saved yet) in the project. */
  assign(chatId: string, projectId: string): void;
}

export interface IslandHelpers {
  /** Every helper with its newest jobs, in the fixed order. */
  list(): HelperItem[];
  /** Installed app names, sorted: the choices for `helper.set`. */
  apps(): Promise<string[]>;
  /** Throws, with words for the user, for an unknown helper. */
  setApp(helper: string, app: string): void;
  /** Throws, with words for the user, for an unknown or unavailable helper, an empty or long task, or bad blockers. */
  addJob(helper: string, task: string, blockedBy?: number[], planFirst?: boolean): void;
  /** Task 3.8: approve or reject a task's waiting plan. Throws, with words for the user, when no plan waits. */
  approvePlan(id: number): void;
  rejectPlan(id: number): void;
  /** Whether a worker's new tasks plan first. Throws, with words for the user, for an unknown worker. */
  setPlanFirst(helper: string, on: boolean): void;
  /** ADR-098: whether a worker's runs get the browser. Throws, with words for the user, for an unknown worker. */
  setBrowser(helper: string, on: boolean): void;
  /** ADR-088: add an agent (its folder and soul.md) or remove one Keshab added. Throw with words for the user. */
  createAgent(input: { name: string; role: string; kit: "research" | "folders" | "think"; personality: string; howItWorks: string; rules: string }): void;
  removeAgent(id: string): void;
  /** ADR-093: agent folders whose soul.md could not be loaded, for the Board (folder name and why, never task text). */
  agentProblems(): { id: string; problem: string }[];
  /** Task 3.16: the tasks handed to Keshab's Paperclip, for the board. Absent when the connection is off. */
  paperclip?(): { issues: PaperclipItem[] };
  /** ADR-111: the newest work plans with the state of each portion. */
  plans?(): PlanItem[];
  /** Task 3.14: opens a task's report in its worker's app. Absent: `job.open` is refused. Rejects with words for the user. */
  openReport?(id: number): Promise<string>;
  /** ADR-091: the Dashboard's tokens. */
  usage?(): UsageItem;
  /** ADR-090: Keshab's MCP servers, without secrets; add, remove, set, and test (runs the server, lists its tools). */
  mcp(): McpItem[];
  addMcp(input: { name: string; kind: "command" | "url"; command?: string; args?: string[]; env?: string[]; url?: string; transport?: "http" | "sse"; headers?: string[] }): void;
  removeMcp(id: number): boolean;
  setMcp(id: number, change: { enabled?: boolean; trusted?: boolean; workers?: string[] }): void;
  testMcp?(id: number): Promise<void>;
  /** ADR-098 item 8: runs a pending soul proposal's ("soul") or skill edit's ("skill") test cases again. */
  runTests?(kind: "soul" | "skill", id: number): Promise<void>;
  /** ADR-090: runs a failed or stopped task again. Throws, with words for the user, for any other state. */
  retry(id: number): void;
  /** Task 3.13: rate a finished task ("not good" asks Tinker to review it); answer Tinker's proposals. Each throws with words for the user. */
  rate(id: number, good: boolean, comment?: string): void;
  acceptProposal(id: number): void;
  rejectProposal(id: number): void;
  undoProposal(id: number): void;
  /** Task 3.12: the skills (Keshab's and, ADR-094, ATOM's), and a worker's choice of them. Throws, with words for the user, for an unknown skill. */
  skills(): { name: string; description: string; source?: "yours" | "zeno" | "hub" }[];
  /** B3.5, ADR-102: the skills hub (search, preview, approve, reject, uninstall, update); absent: the commands are refused. */
  hub?: HubCommands;
  /** ADR-094: Tinker's skill drafts and edits (pending and recent), and the answers to them. Each answer throws with words for the user. */
  skillDrafts(): SkillDraftItem[];
  skillEdits(): SkillEditItem[];
  makeSkill(id: number): void;
  approveSkillDraft(id: number): void;
  rejectSkillDraft(id: number): void;
  acceptSkillEdit(id: number): void;
  rejectSkillEdit(id: number): void;
  undoSkillEdit(id: number): void;
  /** ADR-098 item 8: the saved test cases; save a done task as one, or delete one. Each throws with words for the user. */
  testCases(): TestCaseItem[];
  saveTestCase(jobId: number, kind: "soul" | "skill", target: string): void;
  deleteTestCase(id: number): void;
  setSkills(helper: string, skills: string[]): void;
  /** Task 3.11: grants a folder. Throws, with words for the user, for a folder that cannot be granted. */
  addGrant(helper: string, path: string): void;
  removeGrant(helper: string, path: string): boolean;
  /** ADR-097: Keshab's own schedule, new or changed. Throw, with words for the user, for a bad worker, task or schedule. */
  addRoutine(input: RoutineInput): void;
  updateRoutine(id: number, input: RoutineInput): void;
  /** Task 3.9: removes a routine. False when there is none. */
  removeRoutine(id: number): boolean;
  /** ADR-094: pauses or resumes a routine. Throws, with words for the user, for an unknown one. */
  pauseRoutine(id: number, paused: boolean): void;
  /** Changes what a queued task waits for (ADR-087). Throws, with words for the user, for a started task or a circle. */
  setBlockers(id: number, blockedBy: number[]): void;
  /** Adds Keshab's note to a task, which wakes it (Task 3.6). Throws, with words for the user, for an unknown task or an empty or long note. */
  addComment(id: number, text: string): void;
  /**
   * ADR-098 item 3: Keshab's message to a task: a running one gets it at its next step ("live"), else it is kept as a
   * note that wakes the task ("queued"). Throws, with words for the user, for an unknown task or a bad message.
   */
  steer?(id: number, text: string): "live" | "queued";
  /** ADR-098 item 3: stops a running task's current step; it waits for Keshab's message. Throws, with words, when it cannot. */
  interrupt?(id: number): Promise<void>;
  /** ADR-098: a task's labels. Throw, with words for the user, for an unknown task or a bad label or a seventh one. */
  addLabel(id: number, label: string): void;
  removeLabel(id: number, label: string): void;
  /** ADR-098: tasks (task text, labels, notes) and reports matching the words, best first (at most 20 of each). */
  search?(query: string): { tasks: SearchHitItem<number>[]; reports: SearchHitItem<number>[] };
  /** Forgets a task's session; an ended task runs again, fresh (Task 3.6). Throws, with words for the user, for a running task. */
  startFresh(id: number): void;
  /** B3.4: undoes a task's file edits (one file, or all). Throws, with words for the user, for an unknown task. */
  undo?(id: number, options: { path?: string; force?: boolean }): void;
  /** A task's thread, or undefined for an unknown task. */
  thread(id: number): Omit<ThreadEvent, "type"> | undefined;
  /** Pins a helper to an offered model ("" unpins). Throws, with words for the user, for an unknown helper or model. */
  pin(helper: string, model: string): void;
  /** Separate Codex pin. Optional for older bridges; "" clears even when Codex is unavailable. */
  pinCodex?(helper: string, model: string): void;
  /** Saves an edited soul as a new version (Task 3.3). Throws, with words for the user, for an unknown helper or a bad soul. */
  saveSoul(helper: string, soul: SoulItem): void;
  /** Makes an older soul version current again, as a new version. Throws, with words for the user, for an unknown one. */
  restoreSoul(helper: string, version: number): void;
  /** Whether worker jobs may use the large model (ADR-083). */
  allowLarge(): boolean;
  setAllowLarge(allowed: boolean): void;
  /** The plan's models offered to worker jobs; empty when the provider is not the Claude plan. */
  models(): ModelItem[];
  stop(id: number): boolean;
  remove(id: number): boolean;
  /** Called after every change to helpers or jobs. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}
