// Island mode (`main.ts --island`): ATOM Island drives the voice loop with JSON-line commands on
// stdin and receives JSON-line events on stdout. Specification: docs/island-protocol.md.

import type { HubCommands } from "./hub-commands.ts";
import { chatWriter, readOnlyMessage } from "./chat-owner.ts";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Logger } from "@atom/shared";
import type { Message } from "@atom/contracts";
import {
  PROTOCOL_VERSION,
  createLevelThrottle,
  encodeEvent,
  parseCommand,
  planUsageEvent,
  type IslandCommand,
  type IslandEvent,
  type EpisodeItem,
  type HelperItem,
  type ManagerItem,
  type ModelItem,
  type MemoryItem,
  type MemoryChatItem,
  type SoulItem,
  type ThreadEvent,
  type SearchHitItem,
  type PaperclipItem,
  type McpItem,
  type SkillDraftItem,
  type TeamTaskItem,
  type SkillEditItem,
  type TestCaseItem,
  type UsageItem,
  type ChatItem,
  type ProjectItem,
  type GitBranchItem,
  type RoutineInput,
} from "./island-protocol.ts";
import type { ComputerBridge } from "./computer-bridge.ts";
import type { WindowPointer } from "./screen-context.ts";
import type { ModelSettings } from "./model-settings.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";
import { spokenDuration, type Capability } from "@atom/tool-engine";
import type { ApiServer } from "./api-server.ts";
import { createVoiceLoop, type CoreLike, type LoopNotice, type VoiceLoop, type VoiceLoopEvents, type VoiceLoopOptions } from "./voice-loop.ts";

export interface IslandOptions {
  /** Commands from the island, one JSON object per line. */
  input: Readable;
  /** Writes one encoded event line to the island. */
  write(line: string): void;
  record: VoiceLoopOptions["record"];
  stt: SpeechToText;
  /** ADR-091: a Core that can resume a saved chat names its session (the chat voice and typing go to). */
  core: CoreLike & { reset(): void; resume?(id: string, turns: readonly Message[]): void; readonly sessionId?: string };
  tts: TextToSpeech;
  /** Reported in the `ready` event. ADR-098: `telegram` is true when ATOM's Telegram bot is set up in .env. */
  info: { provider: string; model: string; microphone: string; telegram?: boolean };
  /** ADR-098: Settings' "Send to Telegram" switch. Absent when Telegram is not set up: `telegram.set` does nothing. */
  telegram?: { setPush(on: boolean): void };
  /** ADR-098 item 5: the local API. Absent (voice-only mode): `api.set` answers with `on: false` and an error. */
  api?: Pick<ApiServer, "set">;
  /** The AI model choice: sent as `info` after `ready`, changed by `model.set`. Without it, `model.set` is refused. */
  settings?: Pick<ModelSettings, "info" | "setModel" | "scanTools" | "refreshModels">;
  /** Computer control (ADR-054): shows what ATOM is doing and asks before risky actions. Absent when it is off. */
  computer?: Pick<ComputerBridge, "attach" | "answer" | "cancelAll">;
  /** What ATOM keeps (ADR-058), for Settings. Absent when memory is off: `memory.*` answers `enabled: false`. */
  memory?: IslandMemory;
  /** ADR-091: chat sessions. Absent when memory is off. */
  chats?: IslandChats;
  /** ADR-107: projects. Absent when memory is off: `project.*` and `chat.new` with a project are refused. */
  projects?: IslandProjects;
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

/** ADR-091: ATOM's task branches; pushing one is Keshab's alone (the window asks him to confirm first). */
export interface IslandGit {
  list(): Promise<GitBranchItem[]>;
  push(repo: string, branch: string): Promise<void>;
  diff(repo: string, branch: string): Promise<{ text: string; truncated: boolean }>;
}

/** ADR-091: Keshab's chat sessions with ATOM (kept on this Mac). */
export interface IslandChats {
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
  /** ADR-095: the Managers with their Agents; add, rename, switch mode, remove one; move an Agent. Each throws with words for the user. */
  managers(): ManagerItem[];
  createManager(name: string, mode?: "plan" | "group"): void;
  renameManager(id: string, name: string): void;
  setManagerMode(id: string, mode: "plan" | "group"): void;
  removeManager(id: string): void;
  setManager(helper: string, manager: string): void;
  /** Task 3.16: the tasks handed to Keshab's Paperclip, for the board. Absent when the connection is off. */
  paperclip?(): { issues: PaperclipItem[] };
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
  /** ADR-094: the team tasks waiting to be taken; post one (no role: anyone; throws with words for the user) or take one back. */
  teamTasks(): TeamTaskItem[];
  addTeamTask(task: string, role?: string): void;
  removeTeamTask(id: number): boolean;
  /** ADR-094: a worker's wake-ups ("off" turns them off), and pausing them. Throw, with words for the user. */
  setWakeUp(helper: string, every: "off" | "15m" | "1h" | "4h" | "1d"): void;
  pauseWakeUp(helper: string, paused: boolean): void;
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
  /** Saves an edited soul as a new version (Task 3.3). Throws, with words for the user, for an unknown helper or a bad soul. */
  saveSoul(helper: string, soul: SoulItem): void;
  /** Makes an older soul version current again, as a new version. Throws, with words for the user, for an unknown one. */
  restoreSoul(helper: string, version: number): void;
  /** Whether worker jobs may use the large model (ADR-083). */
  allowLarge(): boolean;
  /** ADR-098 item 7: "Use Codex when the Claude plan limit is reached" (default off), and whether Codex is found and signed in. */
  codex?(): { codexFallback: boolean; codexReady: boolean };
  setCodexFallback?(on: boolean): void;
  setAllowLarge(allowed: boolean): void;
  /** The plan's models offered to worker jobs; empty when the provider is not the Claude plan. */
  models(): ModelItem[];
  stop(id: number): boolean;
  remove(id: number): boolean;
  /** Called after every change to helpers or jobs. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

const HELPERS_OFF = "Helpers are off: their file could not be opened.";

export interface IslandSession {
  readonly loop: VoiceLoop;
  /** Ends the session as if `quit` had been received (used for SIGTERM). */
  quit(): void;
}

/** Notice wording for the island's controls (hold Ctrl+Option to talk). */
export function islandNoticeText(notice: LoopNotice): string {
  switch (notice.kind) {
    case "too_short":
      return "Too short. Hold Ctrl+Option while you speak, then let go.";
    case "mic_starting":
      return `The microphone was still starting. Wait for "speak now", then talk.`;
    case "no_speech":
      return `No speech recognized (loudest sound ${notice.loudest}). Speak close to the microphone.`;
  }
}

function runProjectCommand(projects: IslandProjects, command: Extract<IslandCommand, { type: `project.${string}` }>): ProjectResult {
  switch (command.type) {
    case "project.add":
      return projects.add(command.name, command.path);
    case "project.rename":
      return projects.rename(command.id, command.name);
    case "project.remove":
      return projects.remove(command.id, command.deleteChats === true);
    case "project.archive":
      return projects.archive(command.id, command.archived);
    case "project.model":
      return projects.setModel(command.id, command.provider, command.model);
    case "project.web":
      return projects.setWeb(command.id, command.web);
  }
}

export function runIsland(options: IslandOptions): IslandSession {
  const { core, tts, describe } = options;
  const errorDetails = options.errorDetails ?? (() => ({}));
  const wrap = options.wrapEvents ?? ((events) => events);
  let quitting = false;

  const send = (event: IslandEvent) => {
    if (!quitting || event.type === "error") options.write(encodeEvent(event));
  };
  options.computer?.attach(send);
  const level = createLevelThrottle((peak) => send({ type: "mic.level", peak }), options.levelIntervalMs);

  const loop = createVoiceLoop({
    record: options.record,
    stt: options.stt,
    // ADR-098: a chat that Telegram or the local API writes is read-only here; its one writer keeps its history right.
    core: {
      handle: (input, signal, hooks) => {
        const writer = chatWriter(core.sessionId ?? "");
        return writer ? Promise.reject(new Error(readOnlyMessage(writer))) : core.handle(input, signal, hooks);
      },
    },
    tts,
    silenceWarnMs: options.silenceWarnMs,
    speakTyped: () => speech.reports || speech.updates, // ADR-106: a Quiet chat does not speak a typed turn
    events: wrap({
      onState: (state) => {
        if (state === "listening") level.reset();
        send({ type: "state", state });
      },
      onMicReady: () => send({ type: "mic.ready" }),
      onLevel: (peak) => level.push(peak),
      onMicSilent: () => void options.micName().then((microphone) => send({ type: "mic.silent", microphone })),
      onTranscript: (text) => send({ type: "transcript", text }),
      onReply: (text) => send({ type: "reply", text }),
      onTurnComplete: (t) =>
        send({
          type: "turn.complete",
          speechMs: t.speechMs,
          transcriptionMs: t.transcription,
          modelMs: t.model,
          firstSoundMs: t.firstSound,
        }),
      onNotice: (notice) => send({ type: "notice", kind: notice.kind, message: islandNoticeText(notice) }),
      onError: (stage, error) => send({ type: "error", stage, message: describe(error), ...errorDetails(error) }),
    }),
  });

  function handle(command: IslandCommand) {
    switch (command.type) {
      case "talk.start":
        options.computer?.cancelAll(); // a new request ends whatever was waiting for an answer
        // While listening this is a repeat (e.g. a key event delivered twice): keep the current recording.
        if (loop.state !== "listening") loop.press();
        return;
      case "talk.send":
        if (loop.state === "listening") loop.press();
        return;
      case "talk.cancel":
        options.computer?.cancelAll(); // Esc: anything waiting for the user is a no
        loop.cancel();
        return;
      case "text.send":
        options.computer?.cancelAll();
        loop.ask(command.text);
        return;
      case "approval.answer":
        options.computer?.answer(command.id, command.approved);
        return;
      case "conversation.reset":
        return newChat(undefined);
      case "chat.new": {
        // ADR-107: a new chat, in a project when asked. The project is checked first, so a refusal resets nothing.
        if (command.projectId) {
          const result = options.projects?.startChat(command.projectId) ?? { error: "Projects are off." };
          if ("error" in result) return send({ type: "error", stage: "settings", message: result.error });
        }
        return newChat(command.projectId);
      }
      case "chat.rename": {
        const writer = chatWriter(command.id);
        if (writer) return send({ type: "error", stage: "settings", message: readOnlyMessage(writer) });
        const result = options.chats?.rename?.(command.id, command.title) ?? { error: "Chats are off, so a chat cannot be renamed." };
        if ("error" in result) return send({ type: "error", stage: "settings", message: result.error });
        return sendChats();
      }
      case "project.add":
      case "project.rename":
      case "project.remove":
      case "project.archive":
      case "project.model":
      case "project.web": {
        const projects = options.projects;
        const result: ProjectResult = !projects ? { error: "Projects are off." } : runProjectCommand(projects, command);
        if ("error" in result) {
          options.log?.warn("project.refused", { command: command.type });
          return send({ type: "error", stage: "settings", message: result.error });
        }
        options.log?.info("project.change", { action: command.type });
        return sendChats();
      }
      case "git.list": {
        const git = options.git;
        if (!git) return send({ type: "git", branches: [] });
        void git.list().then((branches) => send({ type: "git", branches }), (error: unknown) => refuseHelpers(command.type, describe(error)));
        return;
      }
      case "git.push": {
        // ADR-091: Keshab clicked Push and confirmed. Logs the task branch's number only.
        const git = options.git;
        if (!git) return refuseHelpers(command.type, "Git is not available.");
        options.log?.info("git.push", { task: Number(command.branch.split("-").at(-1)) });
        void git.push(command.repo, command.branch).then(
          () => git.list().then((branches) => send({ type: "git", branches })),
          (error: unknown) => {
            options.log?.warn("git.push_failed", { task: Number(command.branch.split("-").at(-1)) });
            refuseHelpers(command.type, describe(error));
          },
        );
        return;
      }
      case "git.diff": {
        const git = options.git;
        if (!git) return;
        void git.diff(command.repo, command.branch).then(
          (d) => send({ type: "git.diff", repo: command.repo, branch: command.branch, ...d }),
          (error: unknown) => refuseHelpers(command.type, describe(error)),
        );
        return;
      }
      case "chats.list":
        chatsWatched = true;
        sendChats();
        return;
      case "chat.open": {
        // ADR-091: continue a saved chat; voice and typing go to it from now on.
        const chats = options.chats;
        if (!chats || !core.resume) return;
        const turns = chats.messages(command.id);
        if (!turns.length) {
          sendChats();
          return;
        }
        options.computer?.cancelAll();
        loop.cancel();
        options.screen?.clear();
        const replay = chats.replay?.(command.id, turns) ?? { turns, trimmed: false }; // ADR-107: a long project chat is replayed capped
        core.resume(command.id, replay.turns);
        sendOpened(command.id, turns, replay.trimmed);
        sendChats();
        return;
      }
      case "chat.delete": {
        options.chats?.remove(command.id);
        if (command.id === core.sessionId) {
          loop.cancel();
          core.reset();
          send({ type: "conversation.reset" });
        }
        sendChats();
        return;
      }
      case "context.window": {
        const app = command.name;
        const pointed = options.screen?.point(command.bundleId, app) ?? Promise.resolve({ ok: false as const, message: "Reading the screen is turned off." });
        void pointed.then(
          (result) => send({ type: "context.ready", app, ...result }),
          (error: unknown) => send({ type: "context.ready", app, ok: false, message: describe(error) }),
        );
        return;
      }
      case "model.refresh":
        // ADR-097: the Claude plan's live model list again; `info` follows either way.
        void (options.settings?.refreshModels?.() ?? Promise.resolve()).then(sendInfo, (error: unknown) => options.log?.warn("models.refresh_failed", { message: describe(error) }));
        return;
      case "chat.model": {
        // ADR-097: this chat's own model, from the chat's top bar. Voice and new chats keep the default.
        const id = command.id || core.sessionId || "";
        const result = options.chats?.setModel?.(id, command.provider, command.model) ?? { error: "Chats are off, so a chat cannot have its own model." };
        if ("error" in result) {
          options.log?.warn("chat.model_refused", { reason: result.error });
          send({ type: "error", stage: "settings", message: result.error });
          return;
        }
        sendChats();
        return;
      }
      case "model.set": {
        // Applies to the next request; a turn in progress finishes with the old model.
        if (!options.settings) {
          send({ type: "error", stage: "settings", message: "This runtime cannot switch models." });
          return;
        }
        const result = options.settings.setModel(command.provider, command.model);
        if ("error" in result) {
          options.log?.warn("model.set_refused", { reason: result.error });
          send({ type: "error", stage: "settings", message: result.error });
          return;
        }
        sendInfo();
        return;
      }
      case "memory.list":
        memoryWatched = true; // from now on, changes ATOM makes by itself are sent too
        sendMemory();
        return;
      case "memory.forget":
        if (options.memory?.forget(command.id)) options.log?.info("memory.change", { action: "forget", id: command.id, by: "settings" });
        sendMemory();
        return;
      case "memory.clear": {
        const removed = options.memory?.clear() ?? 0;
        if (removed) options.log?.info("memory.change", { action: "clear", removed, by: "settings" });
        sendMemory();
        return;
      }
      case "memory.keepChat":
      case "memory.dropChat": {
        const done = command.type === "memory.keepChat" ? options.memory?.keepChat?.(command.id) : options.memory?.dropChat?.(command.id);
        if (done) options.log?.info("memory.change", { action: command.type === "memory.keepChat" ? "keepChat" : "dropChat", by: "settings" });
        else send({ type: "error", stage: "settings", message: command.type === "memory.keepChat" ? "That chat is gone, or memory is off." : "That chat is not kept." });
        sendMemory();
        return;
      }
      case "episode.forget":
        if (options.memory?.forgetEpisode(command.id)) options.log?.info("episode.change", { action: "forget", id: command.id, by: "settings" });
        sendMemory();
        return;
      case "episode.clear": {
        const removed = options.memory?.clearEpisodes() ?? 0;
        if (removed) options.log?.info("episode.change", { action: "clear", removed, by: "settings" });
        sendMemory();
        return;
      }
      case "tools.scan":
        // ADR-093: look for the AI tools on this Mac again, then send the choices.
        void options.settings?.scanTools?.().then(sendInfo, (error: unknown) => options.log?.warn("tools.scan_failed", { message: describe(error) }));
        return;
      case "telegram.set":
        options.telegram?.setPush(command.push);
        return;
      case "api.set":
        if (!options.api) return send({ type: "api", on: false, port: 0, tokenFile: "", error: "The local API is not available in this mode." });
        void options.api.set(command.on).then((status) => send({ type: "api", ...status }));
        return;
      case "speech.set":
        // ADR-091: muted kinds still show (the island card, Pal's line); they are not said or chimed.
        speech = { reports: command.reports, updates: command.updates, chime: command.chime ?? true };
        return;
      case "helpers.list":
        helpersWatched = true; // from now on, every job change is sent too
        sendHelpers();
        return;
      case "helper.set":
        void setHelperApp(command.helper, command.app);
        return;
      case "job.add":
        changeHelpers(command.type, (helpers) => helpers.addJob(command.helper, command.task, command.blockedBy, command.planFirst));
        return;
      case "plan.approve":
        changeHelpers(command.type, (helpers) => helpers.approvePlan(command.id));
        return;
      case "plan.reject":
        changeHelpers(command.type, (helpers) => helpers.rejectPlan(command.id));
        return;
      case "agent.create":
        changeHelpers(command.type, (helpers) =>
          helpers.createAgent({ name: command.name, role: command.role, kit: command.kit, personality: command.personality, howItWorks: command.howItWorks, rules: command.rules }),
        );
        return;
      case "agent.remove":
        changeHelpers(command.type, (helpers) => helpers.removeAgent(command.id));
        return;
      case "manager.create":
        changeHelpers(command.type, (helpers) => helpers.createManager(command.name, command.mode));
        return;
      case "manager.rename":
        changeHelpers(command.type, (helpers) => helpers.renameManager(command.id, command.name));
        return;
      case "manager.mode":
        changeHelpers(command.type, (helpers) => helpers.setManagerMode(command.id, command.mode));
        return;
      case "manager.delete":
        changeHelpers(command.type, (helpers) => helpers.removeManager(command.id));
        return;
      case "agent.manager":
        changeHelpers(command.type, (helpers) => helpers.setManager(command.helper, command.manager));
        return;
      case "job.open": {
        const helpers = options.helpers;
        if (!helpers?.openReport) return refuseHelpers(command.type, HELPERS_OFF);
        // Done by code in the worker's app; a problem ("no app chosen", "no web sources") comes back as words.
        void helpers.openReport(command.id).then(
          () => sendHelpers(),
          (error: unknown) => refuseHelpers(command.type, describe(error)),
        );
        return;
      }
      case "mcp.add":
        changeHelpers(command.type, (helpers) => helpers.addMcp(command));
        return;
      case "mcp.remove":
        options.helpers?.removeMcp(command.id); // unknown: ignored
        sendHelpers();
        return;
      case "mcp.set":
        changeHelpers(command.type, (helpers) => helpers.setMcp(command.id, command));
        return;
      case "mcp.test": {
        const helpers = options.helpers;
        if (!helpers?.testMcp) return refuseHelpers(command.type, HELPERS_OFF);
        void helpers.testMcp(command.id).then(
          () => sendHelpers(),
          (error: unknown) => refuseHelpers(command.type, describe(error)),
        );
        return;
      }
      case "job.retry":
        changeHelpers(command.type, (helpers) => helpers.retry(command.id));
        return;
      case "job.rate":
        changeHelpers(command.type, (helpers) => helpers.rate(command.id, command.good, command.comment));
        return;
      case "proposal.accept":
        changeHelpers(command.type, (helpers) => helpers.acceptProposal(command.id));
        return;
      case "proposal.reject":
        changeHelpers(command.type, (helpers) => helpers.rejectProposal(command.id));
        return;
      case "proposal.undo":
        changeHelpers(command.type, (helpers) => helpers.undoProposal(command.id));
        return;
      case "helper.skills":
        changeHelpers(command.type, (helpers) => helpers.setSkills(command.helper, command.skills));
        return;
      case "skill.make":
        changeHelpers(command.type, (helpers) => helpers.makeSkill(command.id));
        return;
      case "skill.hub.search":
        void runHub(command.type, (hub) => hub.search(command.query));
        return;
      case "skill.hub.preview":
        void runHub(command.type, (hub) => hub.preview(command.source, command.path));
        return;
      case "skill.hub.update":
        void runHub(command.type, (hub) => hub.update(command.name));
        return;
      case "skill.hub.approve":
        changeHelpers(command.type, (helpers) => hubOf(helpers).approve(command.id));
        return;
      case "skill.hub.reject":
        changeHelpers(command.type, (helpers) => hubOf(helpers).reject(command.id));
        return;
      case "skill.hub.uninstall":
        changeHelpers(command.type, (helpers) => hubOf(helpers).uninstall(command.name, command.force));
        return;
      case "skill.approve":
        changeHelpers(command.type, (helpers) => helpers.approveSkillDraft(command.id));
        return;
      case "skill.reject":
        changeHelpers(command.type, (helpers) => helpers.rejectSkillDraft(command.id));
        return;
      case "skill.edit.accept":
        changeHelpers(command.type, (helpers) => helpers.acceptSkillEdit(command.id));
        return;
      case "skill.edit.reject":
        changeHelpers(command.type, (helpers) => helpers.rejectSkillEdit(command.id));
        return;
      case "skill.edit.undo":
        changeHelpers(command.type, (helpers) => helpers.undoSkillEdit(command.id));
        return;
      case "testcase.save":
        changeHelpers(command.type, (helpers) => helpers.saveTestCase(command.jobId, command.kind, command.target));
        return;
      case "testcase.delete":
        changeHelpers(command.type, (helpers) => helpers.deleteTestCase(command.id));
        return;
      case "testcase.run": {
        const helpers = options.helpers;
        if (!helpers?.runTests) return refuseHelpers(command.type, HELPERS_OFF);
        // The results arrive with each case (the store's changes); a refusal says why.
        void helpers.runTests(command.proposalKind, command.id).then(
          () => sendHelpers(),
          (error: unknown) => refuseHelpers(command.type, describe(error)),
        );
        return;
      }
      case "grant.add":
        changeHelpers(command.type, (helpers) => helpers.addGrant(command.helper, command.path));
        return;
      case "grant.remove":
        options.helpers?.removeGrant(command.helper, command.path); // unknown: ignored
        sendHelpers();
        return;
      case "routine.delete":
        options.helpers?.removeRoutine(command.id); // unknown: ignored
        sendHelpers();
        return;
      case "routine.pause":
        changeHelpers(command.type, (helpers) => helpers.pauseRoutine(command.id, command.paused));
        return;
      case "routine.add": {
        const { type, ...input } = command;
        changeHelpers(type, (helpers) => helpers.addRoutine(input));
        return;
      }
      case "routine.update": {
        const { type, id, ...input } = command;
        changeHelpers(type, (helpers) => helpers.updateRoutine(id, input));
        return;
      }
      case "team.add":
        changeHelpers(command.type, (helpers) => helpers.addTeamTask(command.task, command.role));
        return;
      case "team.delete":
        options.helpers?.removeTeamTask(command.id); // taken or gone: ignored
        sendHelpers();
        return;
      case "helper.wakeUp":
        changeHelpers(command.type, (helpers) => helpers.setWakeUp(command.helper, command.every));
        return;
      case "helper.wakeUp.pause":
        changeHelpers(command.type, (helpers) => helpers.pauseWakeUp(command.helper, command.paused));
        return;
      case "helper.planFirst":
        changeHelpers(command.type, (helpers) => helpers.setPlanFirst(command.helper, command.on));
        return;
      case "helper.browser":
        changeHelpers(command.type, (helpers) => helpers.setBrowser(command.helper, command.on));
        return;
      case "job.stop":
        options.helpers?.stop(command.id); // unknown or finished: ignored
        sendHelpers();
        return;
      case "job.delete":
        options.helpers?.remove(command.id);
        sendHelpers();
        return;
      case "helper.pin":
        changeHelpers(command.type, (helpers) => helpers.pin(command.helper, command.model));
        return;
      case "helpers.settings":
        changeHelpers(command.type, (helpers) => {
          if (command.allowLarge !== undefined) helpers.setAllowLarge(command.allowLarge);
          if (command.codexFallback !== undefined) helpers.setCodexFallback?.(command.codexFallback);
        });
        return;
      case "job.block":
        changeHelpers(command.type, (helpers) => helpers.setBlockers(command.id, command.blockedBy));
        return;
      case "comment.add":
        changeHelpers(command.type, (helpers) => helpers.addComment(command.id, command.text));
        return;
      case "job.steer":
        changeHelpers(command.type, (helpers) => {
          if (!helpers.steer) throw new Error("Steering is off.");
          helpers.steer(command.id, command.text);
        });
        return;
      case "job.interrupt": {
        const interrupt = options.helpers?.interrupt;
        if (!interrupt) return refuseHelpers(command.type, HELPERS_OFF);
        interrupt(command.id).then(sendHelpers, (error: unknown) => refuseHelpers(command.type, describe(error)));
        return;
      }
      case "job.undo": {
        const undo = options.helpers?.undo;
        if (!undo) return refuseHelpers(command.type, HELPERS_OFF);
        const { id, path, force } = command;
        changeHelpers(command.type, () => undo(id, { ...(path !== undefined ? { path } : {}), ...(force !== undefined ? { force } : {}) }));
        return;
      }
      case "job.label.add":
        changeHelpers(command.type, (helpers) => helpers.addLabel(command.id, command.label));
        return;
      case "job.label.remove":
        changeHelpers(command.type, (helpers) => helpers.removeLabel(command.id, command.label));
        return;
      case "search":
        search(command.query);
        return;
      case "job.fresh":
        changeHelpers(command.type, (helpers) => helpers.startFresh(command.id));
        return;
      case "thread.get": {
        const thread = options.helpers?.thread(command.id);
        if (thread) {
          openThread = command.id;
          send({ type: "thread", ...thread });
        } else refuseHelpers(command.type, options.helpers ? "That task is gone." : HELPERS_OFF);
        return;
      }
      case "soul.set":
        changeHelpers(command.type, (helpers) => helpers.saveSoul(command.helper, command.soul));
        return;
      case "soul.restore":
        changeHelpers(command.type, (helpers) => helpers.restoreSoul(command.helper, command.version));
        return;
      case "quit":
        quit();
        return;
    }
  }

  // ADR-081: helpers. Store changes are logged by the runtime (ids and states only); refusals log the command only.
  let helpersWatched = false;
  let helpersQueued = false;
  /** Sends `helpers` once for any number of changes in the same moment (a command and the change it causes). */
  function sendHelpers() {
    if (helpersQueued) return;
    helpersQueued = true;
    void appNames().then((apps) => {
      helpersQueued = false;
      const helpers = options.helpers;
      const agentProblems = helpers?.agentProblems() ?? [];
      const managers = helpers?.managers() ?? [];
      send({ type: "helpers", helpers: helpers?.list() ?? [], apps, ...(helpers ? { allowLarge: helpers.allowLarge(), models: helpers.models(), skills: helpers.skills(), skillDrafts: helpers.skillDrafts(), skillEdits: helpers.skillEdits(), ...(helpers.hub?.payload() ? { skillHub: helpers.hub.payload() } : {}), testCases: helpers.testCases(), mcp: helpers.mcp(), teamTasks: helpers.teamTasks(), ...(helpers.usage ? { usage: helpers.usage() } : {}), ...(helpers.codex ? helpers.codex() : {}), ...(helpers.paperclip ? { paperclip: helpers.paperclip() } : {}) } : {}), ...(agentProblems.length ? { agentProblems } : {}), ...(managers.length ? { managers } : {}) });
    });
  }
  function appNames(): Promise<string[]> {
    if (!options.helpers) return Promise.resolve([]);
    return options.helpers.apps().catch((error: unknown) => {
      options.log?.warn("helpers.apps_failed", { message: describe(error) });
      return [];
    });
  }
  function refuseHelpers(command: string, message: string) {
    options.log?.warn("helpers.refused", { command });
    send({ type: "error", stage: "settings", message });
  }
  function changeHelpers(command: string, change: (helpers: IslandHelpers) => void) {
    if (!options.helpers) return refuseHelpers(command, HELPERS_OFF);
    try {
      change(options.helpers);
    } catch (error) {
      return refuseHelpers(command, describe(error));
    }
    sendHelpers();
  }
  /** B3.5: a hub command that uses the network: a store refusal is an error for the window; a network one is a message in the list. */
  async function runHub(command: string, run: (hub: HubCommands) => Promise<void>) {
    const hub = options.helpers?.hub;
    if (!hub) return refuseHelpers(command, HELPERS_OFF);
    try {
      await run(hub);
    } catch (error) {
      refuseHelpers(command, describe(error));
    }
    sendHelpers();
  }
  function hubOf(helpers: IslandHelpers): HubCommands {
    if (!helpers.hub) throw new Error(HELPERS_OFF);
    return helpers.hub;
  }
  async function setHelperApp(helper: string, app: string) {
    if (!options.helpers) return refuseHelpers("helper.set", HELPERS_OFF);
    if (app && !(await appNames()).includes(app)) return refuseHelpers("helper.set", "That app is not installed.");
    changeHelpers("helper.set", (helpers) => helpers.setApp(helper, app));
  }
  // B3.1: the thread the window asked for last is sent again after each change (new tool calls reach its timeline).
  let openThread: number | undefined;
  const stopHelperUpdates = options.helpers?.onChange(() => {
    if (helpersWatched) sendHelpers();
    if (openThread === undefined) return;
    const thread = options.helpers?.thread(openThread);
    if (thread) send({ type: "thread", ...thread });
    else openThread = undefined;
  });

  /** ADR-098: one search over chats, tasks and reports. Logs the counts only, never the query. */
  function search(query: string) {
    const empty = { tasks: [], reports: [] };
    let found: { chats: SearchHitItem<string>[]; tasks: SearchHitItem<number>[]; reports: SearchHitItem<number>[] };
    try {
      found = query.trim() ? { chats: options.chats?.search?.(query) ?? [], ...(options.helpers?.search?.(query) ?? empty) } : { chats: [], ...empty };
    } catch (error) {
      options.log?.warn("search.failed", { error: error instanceof Error ? error.name : typeof error });
      return send({ type: "error", stage: "settings", message: "The search did not work. Try other words." });
    }
    options.log?.info("search", { chats: found.chats.length, tasks: found.tasks.length, reports: found.reports.length });
    send({ type: "search.results", query, ...found });
  }

  function sendMemory() {
    const memory = options.memory;
    send(
      memory
        ? { type: "memory", enabled: true, count: memory.count(), memories: memory.list(), episodes: memory.episodes(), ...(memory.chats ? { chats: memory.chats() } : {}) }
        : { type: "memory", enabled: false, count: 0, memories: [], episodes: [] },
    );
  }
  let memoryWatched = false;

  // ADR-091: the chats, sent once asked for and again after each saved exchange.
  let chatsWatched = false;
  function sendChats() {
    const current = core.sessionId ?? "";
    const own = current ? options.chats?.modelOf?.(current) : undefined; // ADR-097
    const currentProjectId = current ? options.chats?.projectOf?.(current) : undefined; // ADR-107
    send({
      type: "chats",
      chats: (options.chats?.list() ?? []).map((c) => (chatWriter(c.id) ? { ...c, readOnly: true as const } : c)),
      current,
      ...(own ? { currentProvider: own.provider, currentModel: own.model } : {}),
      ...(options.projects ? { projects: options.projects.list() } : {}),
      ...(currentProjectId ? { currentProjectId } : {}),
    });
  }
  /** `conversation.reset` and `chat.new`: forget the conversation; a project chat starts inside its project. */
  function newChat(projectId: string | undefined) {
    options.computer?.cancelAll();
    loop.cancel();
    core.reset();
    options.screen?.clear();
    if (projectId && core.sessionId) options.projects?.assign(core.sessionId, projectId);
    send({ type: "conversation.reset", ...(projectId ? { projectId } : {}) });
    if (chatsWatched) sendChats(); // ADR-091: a new chat is now the current one
  }
  const stopChatUpdates = options.chats?.onChange(() => {
    if (chatsWatched) sendChats();
  });
  /** ADR-091: shows a saved chat's turns in the window. */
  function sendOpened(id: string, turns: readonly Message[], trimmed: boolean) {
    const projectId = options.chats?.projectOf?.(id);
    send({
      type: "chat.opened",
      id,
      messages: turns.map((m) => ({ role: m.role as "user" | "assistant", text: m.content })),
      ...(projectId ? { projectId } : {}),
      ...(trimmed ? { trimmed: true as const } : {}),
    });
  }
  // ADR-109: a goal's result was posted into a chat. If that chat is open, show it now (the Core already has the turn).
  const stopPosted = options.chats?.onPosted?.((chatId) => {
    if (chatId !== core.sessionId) return;
    const turns = options.chats?.messages(chatId) ?? [];
    sendOpened(chatId, turns, options.chats?.replay?.(chatId, [...turns]).trimmed ?? false);
  });

  // ADR-061: a timer ended. Shown at once; spoken now if ATOM is idle, else as soon as it is. Task 3.5: a goal's line
  // waits its turn the same way.
  const timerQueue: { message: string; timer?: { id: number; label: string; message: string }; after?: () => void }[] = [];
  let announcing = false;
  let speech = { reports: true, updates: true, chime: true };
  async function announce() {
    if (announcing || quitting) return;
    announcing = true;
    try {
      while (timerQueue.length && !quitting) {
        if (loop.state !== "idle") {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        const { message, timer, after } = timerQueue.shift()!;
        const spoken = timer ? speech.updates : speech.reports;
        if (spoken && speech.chime) await options.chime?.();
        // Task 3.15: Pal flies over with the line while ATOM says it.
        if (!timer) send({ type: "worker.line", line: message });
        if (spoken) {
          send({ type: "state", state: "speaking" });
          try {
            await tts.speak(message);
          } catch (error) {
            options.log?.warn(timer ? "timer.speak_failed" : "goal.speak_failed", { message: describe(error) });
          }
          if (loop.state === "idle") send({ type: "state", state: "idle" });
        }
        // Last, so the island's "Timer done" stays up after the speaking ends.
        if (timer) send({ type: "timer", ...timer });
        after?.();
      }
    } finally {
      announcing = false;
    }
  }
  const stopTimers = options.onTimer?.((timer) => {
    const message = timer.label ? `Your ${timer.label} timer is done.` : `Your ${spokenDuration(timer.seconds)} timer is done.`;
    timerQueue.push({ message, timer: { id: timer.id, label: timer.label, message } });
    void announce();
  });
  const stopGoalLines = options.onGoalLine?.((line, after) => {
    timerQueue.push({ message: line, ...(after ? { after } : {}) });
    void announce();
  });
  const stopMemoryUpdates = options.memory?.onChange(() => {
    if (memoryWatched) sendMemory();
  });
  const stopPlanUsage = options.onPlanUsage?.((usage) => {
    const event = planUsageEvent(usage);
    if (event) send(event);
  });

  /** The model in use, then what can be asked of it. */
  function sendInfo() {
    if (options.settings) send({ type: "info", ...options.settings.info() });
    if (options.capabilities) send({ type: "capabilities", items: options.capabilities() });
  }

  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (quitting) return;
    const parsed = parseCommand(line);
    if ("blank" in parsed) return;
    if ("error" in parsed) {
      options.log?.warn("island.bad_command", { reason: parsed.error });
      send({ type: "error", stage: "protocol", message: parsed.error });
      return;
    }
    handle(parsed.command);
  });
  // The island closing our stdin means it has gone away: leave too.
  lines.on("close", () => quit());

  function quit() {
    if (quitting) return;
    quitting = true;
    stopMemoryUpdates?.();
    stopChatUpdates?.();
    stopPosted?.();
    stopHelperUpdates?.();
    stopPlanUsage?.();
    stopTimers?.();
    stopGoalLines?.();
    options.log?.info("app.quit");
    options.computer?.cancelAll();
    loop.cancel();
    tts.close();
    lines.close();
    options.onQuit();
  }

  // Load the voice now so the first reply is not delayed; report readiness either way.
  const started = Date.now();
  tts
    .warmUp()
    .then(
      () => {
        options.log?.info("tts.ready", { ms: Date.now() - started });
        return true;
      },
      (error: unknown) => {
        options.log?.error("tts.load_failed", { message: describe(error) });
        send({ type: "error", stage: "speech", message: describe(error) });
        return false;
      },
    )
    .then((voice) => {
      // The model may have been switched before the voice finished loading: report the one in use.
      const model = options.settings?.info();
      const llm = model ? { provider: model.provider, model: model.model } : {};
      send({ type: "ready", protocol: PROTOCOL_VERSION, ...options.info, ...llm, voice });
      sendInfo();
      // ADR-093: find the AI tools on this Mac, then send the choices again with them.
      void options.settings?.scanTools?.().then(sendInfo, (error: unknown) => options.log?.warn("tools.scan_failed", { message: describe(error) }));
      // ADR-097: the Claude plan's live model list, then the choices again with it.
      void options.settings?.refreshModels?.().then(sendInfo, (error: unknown) => options.log?.warn("models.refresh_failed", { message: describe(error) }));
    });

  return { loop, quit };
}
