import { FULL_ACCESS_CONFIRMATION } from "./chat-access.ts";
import { runChatControl } from "./chat-controls.ts";
import { createChatWork, type ChatWorkBridge } from "./chat-work.ts";
// The parts of the Mac runtime shared by both interfaces (terminal and island):
// Microphone → Whisper → ATOM Core → LLM Gateway → provider → Kokoro → speaker.

import { createChatTurns, type ChatTurns } from "./chat-turns.ts";
import { dirname, join, resolve } from "node:path";
import type { Core } from "@atom/core";
import { createComputerBridge, type ComputerBridge } from "./computer-bridge.ts";
import {
  calendarRunner,
  capabilityItems,
  createCalendarTools,
  createComputerTool,
  createCuaTransport,
  createLookAtScreenTool,
  createTimers,
  createAppTools,
  createIslandTools,
  createShortcuts,
  installedApps,
  createMediaTools,
  createFrontWindowTool,
  createNoteTools,
  createToolEngine,
  timeTool,
  weatherTool,
  type Capability,
  type ScreenShot,
  type TimerInfo,
} from "@atom/tool-engine";
import { createGateway, createProviderAdapter, createSwitchableModel, createCodexSessionAdapter, listCodexModels, listPlanModels, runBrief, runChatDigest, runEdit, type ChatSession, type ChatSessions, type PlanUsage } from "@atom/llm-gateway";
import { createCodexToolRouter } from "./codex-tools.ts";
import { createNoteModel, createNotes } from "./notes.ts";
import { createChatUsageRecorder, createOverheadRecorder } from "./usage-report.ts";
import { makePrivate, ownFolders } from "./private-files.ts";
import { createNativeCore, type NativeCore } from "./native-core.ts";
import { randomUUID } from "node:crypto";
import { createTinkerRun } from "./tinker.ts";
import { startTinkerRunner, TINKER_TIME_LIMIT_MS, type TinkerRunner } from "./tinker-runner.ts";
import { agentModel, createAgentTool } from "./native-agents.ts";
import { browserServer } from "./browser.ts";
import { CLAUDE_PLAN, createLogger, readEnv, type Config, type LlmChoice, type Logger, type LogFields, type ProviderKeys } from "@atom/shared";
import {
  createMemoryTools,
  DEFAULT_MAX_EPISODES,
  DEFAULT_MAX_MEMORIES,
  episodeContext,
  MEMORY_GUIDANCE,
  memoryContext,
} from "@atom/memory";
import {
  createScheduleTool,
  tieredModels,
  modelForTier,
  isFinal,
  type TestKind,
  type HelperView,
} from "@atom/helpers";
import { createLayaEngine } from "@atom/decision-engine";
import type { InputSource, Message, ZenoInput } from "@atom/contracts";
import type { IslandBrain, IslandChats, IslandGit, IslandHelpers, IslandMemory, IslandOptions, IslandProjects } from "./island.ts";
import { islandHelpers } from "./island-helpers.ts";
import { createHubCommands } from "./hub-commands.ts";
import { listCommands, useCommand, userCommandsDir } from "./slash-commands.ts";
import { SKILLS_PLUGIN, listSkills, prepareSkills, readSkill, readSkillFile, useSkill, userSkillsDir, writeSkillFile } from "./skills.ts";
import { createUseSkillTool } from "./skill-tool.ts";
import { runTestCases } from "./test-runs.ts";
import { createEmbedder } from "./embedder.ts";
import { createKeptChats } from "./kept-chats.ts";
import { createAttachments } from "./attachments.ts";
import { searchEverything } from "./everything-search.ts";
import { BRIEF_INSTRUCTIONS, createBriefRunner } from "./brief.ts";
import { EDIT_INSTRUCTIONS, createTextEditor, providerTextWriter } from "./text-edit.ts";
import type { BriefChange } from "./island-commands.ts";
import { createProjectWorkspace } from "./project-workspace.ts";
import { createProjects } from "./projects-wiring.ts";
import { createIslandGit, withPaperclip } from "./island-wiring.ts";
import { nowLine, createEchoCore, describe, errorFields, findCalendarHelper, openHelpers, openMemory, warmOnOpen } from "./runtime-support.ts";

export { describe, errorFields, nowLine, seconds, withLogging } from "./runtime-support.ts";
import { TELEGRAM_CHAT, startTelegramBot, type TelegramBot } from "./telegram-bot.ts";
import { createApiTurnRunner } from "./api-turns.ts";
import { createApiServer, type ApiServer } from "./api-server.ts";
import { SCHEDULER_TICK_MS, scheduleTick } from "./scheduler.ts";
import { createBrainWiring, type BrainWiring } from "./brain-wiring.ts";
import { createImproveSkillTool, createProposeSkillTool, createSearchChatsTool } from "./reach-tools.ts";
import { nativeSteering, nativeRetryStarter, retrySourceChat, routeWake, routineStarter, taskStarter } from "./native-entry.ts";
import { defaultOpenDeps, openInApp } from "./open-in-app.ts";
import { testMcpServer } from "./mcp-servers.ts";
import { scanAiTools } from "./ai-tools.ts";
import { checkIssues, createPaperclip, createPaperclipTools, issueTracker, paperclipBase } from "./paperclip.ts";
import { createWindowPointer, type WindowPointer } from "./screen-context.ts";
import { withPointing } from "./pointing.ts";
import { defaultInputDevice, startRecording } from "./audio.ts";
import { createWhisperStt, type SpeechToText } from "./stt.ts";
import { createModelSettings, writeSavedChoice, type ModelSettings } from "./model-settings.ts";
import { createKokoroSynthesizer, createSpeaker, type TextToSpeech } from "./tts.ts";
import type { VoiceLoopOptions } from "./voice-loop.ts";

/** One request on the plan provider can take several tool turns, each a model call; this is its whole-request limit. */
const PLAN_TIMEOUT_MS = 120_000;

/** Points around a spot from a screenshot marker (ADR-080), about the size of a menu-bar icon. */
const POINT_BOX = 20;

/** Claude Code's own web search on the Claude plan (ADR-069): not a ATOM tool, so listed here (ADR-076). */
const WEB_SEARCH: Capability = { title: "Search the web", examples: ["What's in the news today?", "Who won the match last night?"] };

export interface Runtime {
  config: Config;
  log: Logger;
  core: Core;
  /** The AI provider and model in use, switchable while running (island `model.set`). */
  settings: ModelSettings;
  stt: SpeechToText;
  tts: TextToSpeech;
  record: VoiceLoopOptions["record"];
  /** The microphone actually in use: with ":default" this follows macOS, which changes when devices are plugged in. */
  micName(): Promise<string>;
  /** Computer control's link to the island (steps and approvals). Used only when ATOM_COMPUTER=1. */
  computer: ComputerBridge;
  /** ADR-054: computer control is on in this run (ATOM_COMPUTER=1); the island's switch shows it. */
  computerOn: boolean;
  /** The memory as Settings sees it (list, forget, clear, change updates). Undefined when memory is off. */
  islandMemory?: IslandMemory;
  /** The second brain as the window sees it (Memory → Graph). Undefined when memory is off. */
  islandBrain?: IslandBrain;
  /** Plugins → Skills: open and save a skill's SKILL.md on Keshab's click (skills.ts). */
  islandSkillFiles: NonNullable<IslandOptions["skillFiles"]>;
  /** The "/" picker: Keshab's Claude commands (ADR-117). */
  islandSlashCommands: NonNullable<IslandOptions["slashCommands"]>;
  /** ADR-091: Keshab's chat sessions as the ATOM window sees them. Undefined when memory is off. */
  islandChats?: IslandChats;
  /** Who is answering in which chat (the window and the Local API share chats). */
  chatTurns: ChatTurns;
  /** ADR-107: projects as the ATOM window sees them. Undefined when memory is off. */
  islandProjects?: IslandProjects;
  islandWorkspace?: IslandOptions["workspace"];
  /** Search everything (upgrades.md C1). */
  everything?: IslandOptions["everything"];
  /** Remembering by itself (upgrades.md C2). Undefined when memory is off. */
  islandSuggestions?: IslandOptions["suggestions"];
  /** Ask ATOM (upgrades.md B3). Undefined when the Claude plan is not in use. */
  islandTextEdit?: IslandOptions["textEdit"];
  /** Daily brief (upgrades.md C3). Undefined when memory is off. */
  islandBrief?: IslandOptions["dailyBrief"];
  /** ADR-113: files attached to a typed message. Undefined in tests. */
  islandAttachments?: IslandOptions["attachments"];
  /** The helpers as the ATOM window sees them. Undefined when the store could not open. */
  islandHelpers?: IslandHelpers;
  taskActivity: NonNullable<IslandOptions["taskActivity"]>;
  chatWork: ChatWorkBridge;
  foreground?: IslandOptions["foreground"];
  /** ADR-091: ATOM's task branches, and Keshab's push. Undefined when the helpers store could not open. */
  islandGit?: IslandGit;
  /** Pal dropped on a window (ADR-074): that app's read, held for the next request only. */
  screen: WindowPointer;
  /** Called when a timer ends; returns a function that stops listening. */
  onTimer(listener: (timer: TimerInfo) => void): () => void;
  /** "What can I ask?" (ADR-076): the tools that are on, plus web search when the Claude plan is in use. */
  capabilities(): Capability[];
  /** Called when the Claude plan reports usage (ADR-076); returns a function that stops listening. */
  onPlanUsage(listener: (usage: PlanUsage) => void): () => void;
  /**
   * Called with a line to say when a goal Pal handed out has ended (Task 3.5), or a plan waits for Keshab (Task 3.8,
   * then `after` asks on Pal's approval card). Returns a function that stops listening.
   */
  onGoalLine(listener: (line: string, after?: () => void) => void): () => void;
  /** ADR-098: ATOM's Telegram bot. Undefined unless ATOM_TELEGRAM_BOT_TOKEN and ATOM_TELEGRAM_CHAT_ID are both set. */
  telegram?: TelegramBot;
  /** ADR-098 item 3: Keshab's messages to running tasks, and interrupts. Undefined when the helpers store could not open. */
  /** ADR-098 item 5: the local HTTP API, off until Settings turns it on. Undefined with ATOM_VOICE_ONLY=1. */
  api?: ApiServer;
  /** ADR-108: writes the notes that wait for a quiet chat. Called when the app quits; may take a few seconds. */
  flushNotes(): Promise<void>;
  /** Shutdown: stops running helper jobs (they are marked failed at the next start) and Laya's server. */
  close(): void;
}

export interface RuntimeOptions {
  /** Every provider key in .env, so the model can be switched to any of them. Default: the configured one only. */
  keys?: ProviderKeys;
  /** Where a model switch is saved (config/island.json). */
  settingsPath?: string;
  /** The memory file (ADR-058). Default: ATOM_MEMORY_FILE or data/memory.db; ":memory:" for tests. */
  memoryPath?: string;
  /** The helpers file (ADR-081). Default: ATOM_HELPERS_FILE or data/helpers.db; ":memory:" for tests. */
  helpersPath?: string;
}

export function createRuntime(
  config: Config,
  log: Logger = createLogger({ level: config.log.level, file: config.log.file }),
  options: RuntimeOptions = {},
): Runtime {
  const stt = createWhisperStt({
    modelPath: config.stt.modelPath,
    language: config.stt.language,
    vocabulary: config.stt.vocabulary,
  });
  const computer = createComputerBridge();
  const memory = openMemory(options.memoryPath ?? readEnv(process.env, "ATOM_MEMORY_FILE") ?? "data/memory.db", log);
  let foregroundReady = Boolean(memory);
  try { memory?.foreground.recover(); }
  catch { foregroundReady = false; log.error("foreground.unavailable", {}); }
  const chatWork = createChatWork({ persistAnswer: (turn, card, question, answer) => {
    if (!memory || !foregroundReady) throw new Error("Recovery storage is unavailable.");
    memory.foreground.answer(turn, card, question, answer);
  } });
  // The request a memory tool is running for, for provenance. Set by the Core's context hook, which runs first.
  let current: { source: InputSource; requestId?: string } = { source: "voice" };
  const memoryListeners = new Set<() => void>();
  // The second brain: memory mirrored into linked notes (brain-wiring.ts). Mirrored again when memory changes.
  const brainWiring: BrainWiring | undefined = memory && createBrainWiring({ memory, log });
  if (brainWiring) {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const soon = (ms: number) => {
      clearTimeout(pending);
      pending = setTimeout(() => brainWiring.sync(), ms);
      pending.unref?.();
    };
    memoryListeners.add(() => soon(1500));
    soon(3000); // at start, once the window is up
  }
  // ADR-097: chats kept in memory. The digest is one no-tools run of the plan's small model; on any other provider, or
  // if it fails, the deterministic digest is used.
  const keptChats =
    memory &&
    createKeptChats({
      memory,
      embedder: createEmbedder({ log }),
      digest: async (brief) => {
        const small = modelForTier(planModels(), "small");
        if (!small) throw new Error("The Claude plan is not the model in use.");
        const { digest, tokens } = await runChatDigest({
          claudePath: keys["claude-plan"] ?? "",
          model: small,
          task: brief,
          instructions: "You are ATOM's memory keeper.",
          signal: AbortSignal.timeout(120_000),
          onUsage: reportUsage,
        });
        if (tokens) helpers?.addUsage({ source: "chat", model: small, ...tokens, ...(tokens.costUsd ? { dollars: tokens.costUsd } : {}) });
        return digest;
      },
      changed: () => {
        for (const listener of memoryListeners) listener();
      },
      log,
    });
  const islandMemory: IslandMemory | undefined = memory && {
    list: () => memory.recent(DEFAULT_MAX_MEMORIES).map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt.toISOString(), source: m.source })),
    count: () => memory.count(),
    forget: (id) => memory.remove(id),
    clear: () => memory.clear(),
    episodes: () => memory.episodes(DEFAULT_MAX_EPISODES).map((e) => ({ id: e.id, summary: e.summary, endedAt: e.endedAt.toISOString(), exchanges: e.exchanges })),
    forgetEpisode: (id) => memory.removeEpisode(id),
    clearEpisodes: () => memory.clearEpisodes(),
    chats: () => keptChats!.chats(),
    keepChat: (id) => keptChats!.keep(id),
    dropChat: (id) => keptChats!.drop(id),
    onChange: (listener) => {
      memoryListeners.add(listener);
      return () => memoryListeners.delete(listener);
    },
  };
  // ADR-091: Keshab's chat sessions: saved after every exchange, listed, opened and deleted from the ATOM window.
  const chatListeners = new Set<() => void>();
  // ADR-109: a goal's result was posted into a chat; the window refreshes that chat if it is open.
  const postedListeners = new Set<(chatId: string) => void>();
  // ADR-098 item 9: each chat's Claude Code session. A chat's first answer comes before its first save, so its session
  // waits here until then.
  const unsavedChatSessions = new Map<string, ChatSession>();
  const chatSessions: ChatSessions | undefined = memory && {
    get: (id) => memory.chats.session(id) ?? unsavedChatSessions.get(id),
    set: (id, session) => {
      if (memory.chats.setSession(id, session)) unsavedChatSessions.delete(id);
      else unsavedChatSessions.set(id, session);
    },
  };
  const chatTurns = createChatTurns(); // who is answering in which chat (window or phone); a deleted chat is not saved back
  const saveChat = (sessionId: string, turns: readonly Message[], completion?: { requestId: string; reply: string }) => {
    if (!memory) return;
    if (chatTurns.wasDeleted(sessionId)) return; // the chat was deleted while this turn ran: it stays deleted
    try {
      memory.chats.save(sessionId, projects ? projects.fullTurns(sessionId, turns) : turns, completion); // archive and foreground completion commit together
      projects?.saved(sessionId);
      const session = unsavedChatSessions.get(sessionId);
      if (session && memory.chats.setSession(sessionId, session)) unsavedChatSessions.delete(sessionId);
    } catch (error) {
      log.error("chat.save_failed", { message: describe(error) });
      return;
    }
    for (const listener of chatListeners) listener();
  };
  const islandChats: IslandChats | undefined = memory && {
    lastOpened: () => memory.chats.lastOpened(),
    rememberOpened: (id) => memory.chats.rememberOpened(id),
    list: () => [...new Map([...(projects?.chatSummaries() ?? memory.chats.list()), ...memory.chats.list({ pinned: true, limit: 500 }), ...memory.chats.list({ archived: true, limit: 500 })].map((c) => [c.id, c])).values()]
      .map((c) => ({ id: c.id, title: c.id === TELEGRAM_CHAT ? "Telegram" : c.title, updatedAt: c.updatedAt.toISOString(), messages: c.messages, ...(c.projectId ? { projectId: c.projectId } : {}), ...(c.pinned ? { pinned: true as const } : {}), ...(c.archived ? { archived: true as const } : {}), ...(c.flagsVersion ? { flagsVersion: c.flagsVersion } : {}) })),
    metadataOf: (id) => memory.chats.metadata(id),
    control: (command) => {
      const result = runChatControl(memory.chats, command, (id) => {
        const checked = projects?.island.startChat(id);
        return checked && "ok" in checked ? {} : { error: checked && "error" in checked ? checked.error : "Projects are unavailable." };
      });
      if (result.ok && result.info) {
        const choice = chatChoice(command.id, "text");
        const projectId = projects?.projectOf(command.id);
        const project = projectId ? projects?.island.list().find((p) => p.id === projectId) : undefined;
        const mode = memory.chats.access(command.id);
        result.info.access = { mode, provider: choice.provider, hostTools: mode !== "chat-only" && (choice.provider === CLAUDE_PLAN || choice.provider === "codex"),
          project: Boolean(projectId), fileGrants: memory.filePermissions.forChat(command.id).list().length,
          computer: mode !== "chat-only" && computerOn, web: mode !== "chat-only" && readEnv(process.env, "ATOM_WEB") !== "0" && (!project || project.web) };
      }
      return result;
    },
    messages: (id) => memory.chats.messages(id),
    remove: (id) => {
      chatTurns.markDeleted(id); // a turn running in it must not save it back
      episodes?.discard(id); // ADR-108: no note for a deleted chat
      attachments?.remove(id); // ADR-113: and none of its files
      return memory.chats.remove(id);
    },
    modelOf: (id) => memory.chats.model(id) ?? projects?.modelOf(id), // ADR-107: the chat's own, else its project's
    rename: (id, title) => projects?.renameChat(id, title) ?? { error: "Projects are off." },
    projectOf: (id) => projects?.projectOf(id),
    replay: (id, turns) => projects?.replay(id, turns) ?? { turns, trimmed: false },
    search: (query) => memory.chats.search(query).map((c) => ({ id: c.id, title: c.title, snippet: c.snippet, at: c.updatedAt.toISOString() })),
    confirmFullAccess: async (id, expected, signal) => {
      const choice = chatChoice(id, "text");
      if (![CLAUDE_PLAN, "codex"].includes(choice.provider) || memory.chats.access(id) !== expected || signal.aborted) return false;
      return computer.approve({ summary: "Enable Full access for this chat?", reason: FULL_ACCESS_CONFIRMATION, reasonMax: 600, accessChange: true, timeoutMs: 120_000 }, signal);
    },
    accessOf: (id) => memory.chats.access(id),
    setAccess: (id, mode, expected) => {
      if (mode === "full" && ![CLAUDE_PLAN, "codex"].includes(chatChoice(id, "text").provider)) return { error: "Full access requires Claude or Codex." };
      if (helpers?.list().some((h) => h.jobs.some((j) => j.chatId === id && !isFinal(j.state)))) return { error: "Finish or stop this chat's tasks before changing access." };
      try {
        if (memory.chats.access(id) !== expected) return { error: "Chat access changed. Reopen its selector." };
        memory.chats.setAccess(id, mode);
      } catch { return { error: "Could not save this chat's access preference." }; }
      return { ok: true };
    },
    reasoningOf: (id) => {
      const choice = chatChoice(id, "text");
      const capability = settings.reasoning!(choice.provider, choice.model);
      const selected = memory.chats.reasoning(id, choice.provider, choice.model);
      return { ...capability, ...(selected ? { selected } : {}), effective: selected ?? capability.default };
    },
    setReasoning: (id, provider, model, effort) => {
      const choice = chatChoice(id, "text");
      if (choice.provider !== provider || choice.model !== model) return { error: "The chat model changed. Reopen the thinking selector." };
      const capability = settings.reasoning!(provider, model);
      if (effort && !capability.levels.includes(effort)) return { error: "That thinking level is unavailable for this model. Refresh its catalog." };
      try { memory.chats.setReasoning(id, provider, model, effort || undefined); }
      catch { return { error: "Could not save this chat's thinking preference." }; }
      return { ok: true };
    },
    setModel: (id, provider, modelId) => {
      if (!id) return { error: "There is no chat to give a model to." };
      let own: LlmChoice | undefined;
      if (provider || modelId) {
        const checked = settings.check(provider, modelId);
        if ("error" in checked) return checked;
        own = checked.choice;
      }
      memory.chats.setModel(id, own); // persisted before the first answer too: interruption must not change providers
      log.info("chat.model", { provider: own?.provider ?? "default", model: own?.model ?? "default" });
      return { ok: true };
    },
    onChange: (listener) => {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
    onPosted: (listener) => {
      postedListeners.add(listener);
      return () => postedListeners.delete(listener);
    },
  };
  const helpersPath = options.helpersPath ?? readEnv(process.env, "ATOM_HELPERS_FILE") ?? "data/helpers.db";
  // ADR-088: agents Keshab adds live beside the helpers file, each data/agents/<id>/soul.md.
  const agentsDir = join(dirname(resolve(helpersPath === ":memory:" ? "data/x" : helpersPath)), "agents");
  // ADR-094: ATOM's own skills, approved by Keshab, live beside it too: data/skills/<name>/SKILL.md.
  const skillsDir = helpersPath === ":memory:" ? undefined : join(dirname(resolve(helpersPath)), "skills");
  const checkpointsDir = helpersPath === ":memory:" ? undefined : join(dirname(resolve(helpersPath)), "checkpoints"); // B3.4
  // ADR-113: files attached to a chat are copied here (data/attachments/<chat>); none in tests.
  const attachments = helpersPath === ":memory:" ? undefined : createAttachments({ dir: join(dirname(resolve(helpersPath)), "attachments"), log: { info: (event, fields) => log.info(event, fields as LogFields) } });
  let retryTask: ((id: number) => void) | undefined;
  const helpers = openHelpers(helpersPath, log, helpersPath === ":memory:" ? undefined : agentsDir, skillsDir, checkpointsDir, (id) => {
    if (!retryTask) throw new Error("Task retries are not ready yet.");
    retryTask(id);
  });
  // 2026-10-15: the databases hold MCP secrets and every chat; keep them (and the log) owner-only. Files always; a folder only when it is
  // ATOM's own data or logs folder (private-files.ts), and never ":memory:", which is not a path.
  {
    const memoryPath = options.memoryPath ?? readEnv(process.env, "ATOM_MEMORY_FILE") ?? "data/memory.db";
    const databases = [helpersPath, memoryPath].filter((p) => p !== ":memory:").map((p) => resolve(p));
    const logFile = resolve(config.log.file);
    const failed = makePrivate({ dirs: ownFolders([...databases, logFile]), databases, files: [logFile] });
    if (failed.length) log.warn("files.not_private", { count: failed.length });
  }
  // ADR-107: projects (a named folder and its chats); the chat code above reads this lazily.
  const projects = memory
    ? createProjects({
        memory,
        ...(helpers ? { helpers } : {}),
        log,
        checkModel: (provider, model) => settings.check(provider, model),
        onChatsDeleted: (chatIds) => chatIds.forEach((chatId) => { chatTurns.markDeleted(chatId); memory.foreground.forgetChat(chatId); }),
      })
    : undefined;
  // ADR-091: ATOM's task branches in the repositories Keshab granted; pushing one is his alone, asked from the window.
  // Task 3.11: the tasks' git worktrees live beside the helpers file, never inside a granted repository.
  const worktrees = join(dirname(resolve(helpersPath === ":memory:" ? "data/x" : helpersPath)), "worktrees");
  const islandGit: IslandGit | undefined = helpers && createIslandGit(helpers, { worktrees, ...(projects ? { projectFolders: () => projects.gitFolders() } : {}) });
  // ADR-087, Task 3.16: Keshab's own Paperclip, only when ATOM_PAPERCLIP_URL names a loopback address. Anything else
  // sends nothing. ATOM never installs or starts it.
  const paperclipApi = paperclipBase(readEnv(process.env, "ATOM_PAPERCLIP_URL"));
  if (readEnv(process.env, "ATOM_PAPERCLIP_URL") && !paperclipApi) log.warn("paperclip.refused", { reason: "not_loopback_http" });
  const paperclip = paperclipApi
    ? { client: createPaperclip(paperclipApi, { company: readEnv(process.env, "ATOM_PAPERCLIP_COMPANY") || undefined }), tracker: issueTracker(join(dirname(worktrees), "paperclip.json")) }
    : undefined;
  const paperclipListeners = new Set<() => void>();
  const paperclipChanged = () => {
    for (const listener of paperclipListeners) listener();
  };
  /** Daily brief: set below, once the runner exists; the "brief me" tool reaches it through this. */
  let briefNow: (() => Promise<{ lines: string[] }>) | undefined;
  const timerListeners = new Set<(timer: TimerInfo) => void>();
  const timers = createTimers({
    onFire: (timer) => {
      log.info("timer.fired", { id: timer.id, seconds: timer.seconds });
      for (const listener of timerListeners) listener(timer);
    },
  });
  // ADR-062: Open-Meteo, no key. ATOM_WEATHER=0 turns it off; ATOM_HOME sets "here" (default: the time zone's city).
  // Home's forecast is fetched at start and every 30 minutes, so "what's the weather" needs no network wait.
  const weather = readEnv(process.env, "ATOM_WEATHER") === "0" ? undefined : weatherTool(readEnv(process.env, "ATOM_HOME") ? { home: () => readEnv(process.env, "ATOM_HOME")! } : {});
  if (weather) {
    void weather.warm();
    setInterval(() => void weather.warm(), 30 * 60_000).unref();
  }
  // ADR-074: off with the front window tool (ATOM_FRONT_WINDOW=0), whose limits it shares.
  const screen = createWindowPointer({ enabled: readEnv(process.env, "ATOM_FRONT_WINDOW") !== "0", log });
  // ADR-080: the screenshot the model was given this turn, so the reply's [POINT:…] marker can be checked against it.
  const computerOn = readEnv(process.env, "ATOM_COMPUTER") === "1";
  let lastShot: ScreenShot | undefined;
  const cua = computerOn ? createCuaTransport({ onTiming: (timing) => log.info("computer.transport", { ...timing }) }) : undefined;
  const calendarHelper = findCalendarHelper();
  log.info("calendar.helper", { available: Boolean(calendarHelper) });
  // The tools ATOM can use. Built before the model because "Claude (my plan)" runs the tool loop itself and
  // needs them; the other providers get them from the Core.
  const tools = [
    // Task 3.16: only with Keshab's own Paperclip on this Mac. Approvals are answered only after his OK on the card.
    ...(paperclip
      ? createPaperclipTools({ ...paperclip, confirm: (request) => computer.approve(request), onChange: paperclipChanged, onCall: (e) => log.info("paperclip.call", e) })
      : []),
    timeTool(),
    // ADR-066: open apps and web pages. Always on: no screen access, no clicks. ATOM_APPS=0 turns it off.
    ...(readEnv(process.env, "ATOM_APPS") === "0" ? [] : createAppTools()),
    // ADR-068: music (Spotify or Music) and the Mac's volume. ATOM_MEDIA=0 turns it off.
    ...(readEnv(process.env, "ATOM_MEDIA") === "0" ? [] : createMediaTools()),
    // Task 2.x: open ATOM's Settings and press the play/pause key, both done by the island.
    ...createIslandTools({ openSettings: () => computer.openSettings(), playPause: () => computer.playPause() }),
    // ADR-070: "take a note" into Apple Notes (adding only). ATOM_NOTES=0 turns it off.
    ...(readEnv(process.env, "ATOM_NOTES") === "0" ? [] : createNoteTools()),
    // ADR-072: the app in front and, in Chrome/Arc/Edge/Brave, the tab title and address. Read-only, on request.
    // Logs the bundle id and field names only. ATOM_FRONT_WINDOW=0 turns it off.
    ...(readEnv(process.env, "ATOM_FRONT_WINDOW") === "0" ? [] : [createFrontWindowTool({ onRead: (e) => log.info("front_window.read", { ...e, fields: e.fields.join(",") }) })]),
    ...timers.tools,
    // ADR-062: Open-Meteo, no key. ATOM_WEATHER=0 turns it off; ATOM_HOME sets "here" (default: the time zone's city).
    ...(weather ? [weather] : []),
    // ADR-060: Calendar and Reminders when the helper is there (inside ZENO.app). ATOM_CALENDAR=0 turns it off.
    ...(calendarHelper ? createCalendarTools({ run: calendarRunner(calendarHelper) }) : []),
    ...(memory
      ? createMemoryTools({
          store: memory,
          provenance: () => current,
          onChange: (e) => {
            log.info("memory.change", e);
            for (const listener of memoryListeners) listener();
          },
        })
      : []),
    // ADR-054: off unless ATOM_COMPUTER=1. Steps and approvals go through the bridge to the island;
    // with no island, or no answer, an approval is a refusal.
    ...(cua
      ? [
          createComputerTool({
            cua,
            approve: (request, signal) => {
              log.info("computer.approval_asked");
              return computer.approve(request, signal);
            },
            onStep: (step) => computer.step(step),
            onPoint: (target) => computer.point(target),
            onAction: (event) => log.info("computer.action", { ...event }),
          }),
          // ADR-080: a screenshot through Cua (which holds Screen Recording), on request only. Never stored or logged.
          createLookAtScreenTool({ cua, onShot: (shot) => (lastShot = shot), onStep: (step) => computer.step(step) }),
        ]
      : []),
    // Task 3.9: routines by voice in any wording. Logs the routine id and worker only.
    ...(helpers ? [createScheduleTool({ store: helpers, onScheduled: (e) => log.info("routine.scheduled", e) })] : []),
    // docs/v2-plan.md items 1 and 2: past chats by words; a skill proposed from a finished task. Logs counts and ids only.
    ...(brainWiring ? brainWiring.tools : []),
    ...(memory ? [createSearchChatsTool({ search: (query) => memory.chats.search(query), onSearch: (e) => log.info("chats.search", e) })] : []),
    ...(helpers
      ? [
          createProposeSkillTool({
            store: helpers,
            latestDone: () => helpers.list().flatMap((h) => (h.id === "tinker" ? [] : h.jobs)).filter((j) => j.state === "done").reduce<number | undefined>((best, j) => (best === undefined || j.id > best ? j.id : best), undefined),
            onProposed: (e) => log.info("skill.proposed", e),
          }),
          createImproveSkillTool({ store: helpers, onProposed: (e) => log.info("skill.edit_proposed", e) }),
        ]
      : []),
    // Daily brief: "brief me" by voice or text makes one now and returns its lines for the model to say.
    ...(memory
      ? [
          {
            spec: { name: "brief_me", description: "Make the user's daily brief now (weather, today's events, reminders, finished tasks, what waits for them) and return its lines. Use it when the user asks for their brief or morning update.", inputSchema: { type: "object" as const, properties: {} } },
            capability: { title: "Daily brief", examples: ["Brief me", "What does my day look like?"] },
            run: async () => {
              if (!briefNow) throw new Error("The daily brief is not ready.");
              return (await briefNow()).lines.join("\n");
            },
          },
        ]
      : []),
    // ADR-113: the model reads one of Keshab's skills by name; he can also pick one in the composer (`/name`).
    createUseSkillTool({
      list: () => listSkills(userSkillsDir(), skillsDir, new Set(helpers?.skillHubInstalled().map((i) => i.name) ?? [])),
      read: (name) => readSkill(name, userSkillsDir(), skillsDir),
      onUse: (e) => log.info("skill.used", e),
    }),
  ];
  // ADR-110: the main agent's tools. A sub-agent does the delegating (the Agent tool); `create_agent` adds one. A new
  // agent is ready once each open session restarts.
  const nativeCores = new Set<NativeCore>();
  const toolEngine = createToolEngine({
    tools: [
      ...tools,
      ...(helpers
        ? [
            createAgentTool({
              store: helpers,
              approve: (request, signal) => computer.approve(request, signal),
              restartWhenIdle: () => nativeCores.forEach((c) => c.restartWhenIdle()),
              onCreated: (e) => log.info("agent.created", e),
            }),
          ]
        : []),
    ],
    onCall: (e) => log.info("tool.call", e),
  });
  const planUsageListeners = new Set<(usage: PlanUsage) => void>();
  // Plan use goes in the log so it is visible how much of the plan a day of ATOM takes. No keys, no text.
  // ADR-076: and to the island's meters. Helper jobs report theirs here too.
  const reportUsage = (usage: PlanUsage) => {
    log.info("plan.usage", { ...usage });
    for (const listener of planUsageListeners) listener(usage);
  };
  const recordChatUsage = createChatUsageRecorder(helpers, log); // Job 1 (token cost)
  const recordOverhead = createOverheadRecorder(helpers, log); // 2026-10-15: the calls Claude Code makes itself

  // ADR-110 N5: ATOM answers on the Claude plan in its native sessions. The gateway stays only for the model switch of
  // Settings (ADR-092): `ModelSettings` replaces it when Keshab picks a provider.
  const createModel = (choice: LlmChoice, apiKey: string) =>
    createGateway({ provider: createProviderAdapter({ ...choice, apiKey }), timeoutMs: config.llm.timeoutMs });
  const initial = { provider: config.llm.provider, model: config.llm.model };
  const model = createSwitchableModel(createModel(initial, config.llm.apiKey));
  // ADR-059: a short summary of each conversation, written in the background. ADR-108: on the small model of the Claude
  // plan, whatever model the chat has; it never joins the chat's session (no tools).
  const noteModel = createNoteModel({
    claudePath: () => keys[CLAUDE_PLAN] ?? "",
    smallModel: () => modelForTier(planModels(), "small"),
    onUsage: reportUsage,
    onTokens: (tokens, model, meta) => recordChatUsage(tokens, model, meta),
    // Remembering by itself (upgrades.md C2): the same run may notice lasting facts; they wait for Accept. Logs the count only.
    ...(memory
      ? {
          wantsFacts: () => memory.suggestions.enabled(),
          onFacts: (chatId: string, facts: string[]) => log.info("suggestion.added", { count: memory.suggestions.suggest(facts, chatId).length }),
        }
      : {}),
  });
  const episodes = createNotes({ memory, model: noteModel, env: process.env, log, changed: () => memoryListeners.forEach((listener) => listener()) });
  // ADR-071: plain commands run in code, before any model. ATOM_SHORTCUTS=0 turns these off. Logs the name only.
  const toolShortcuts =
    readEnv(process.env, "ATOM_SHORTCUTS") === "0"
      ? undefined
      : createShortcuts({
          tools: toolEngine,
          apps: installedApps,
          onHit: (e) => log.info("shortcut.hit", e),
          onFallback: (e) => log.info("shortcut.fallback", e),
        });
  // Task 3.14: a finished report opens in its worker's app (tabs, a note, or a text file), by code.
  const openDeps = defaultOpenDeps(join(dirname(resolve(helpersPath === ":memory:" ? "data/x" : helpersPath)), "reports"));
  const openReport = async (taskId: number): Promise<string> => {
    const job = helpers?.get(taskId);
    const report = helpers?.report(taskId);
    if (!helpers || !job || !report) throw new Error("That task has no report.");
    const worker = helpers.list().find((h) => h.id === job.helper)!;
    if (!worker.app) throw new Error(`Choose where ${worker.name} opens things in the ATOM window first.`);
    const said = await openInApp(worker.app, taskId, report, openDeps);
    log.info("report.opened", { helper: job.helper, job: taskId });
    return said;
  };
  // ATOM_VOICE_ONLY=1: test speech in and out without the AI. ATOM reads back what Whisper heard, and no
  // request is made to any model. (Typed as `Core` so every caller treats it the same.)
  const keys = { ...options.keys, [config.llm.provider]: config.llm.apiKey };
  // ADR-110: each open chat has one long-lived Claude Code session (native-core.ts). One Core setup serves the window's
  // Core, the Telegram chat's, the API's and each routine's.
  // `composed`: Telegram and the API, whose text goes to Claude Code as written.
  // Phase N2: the sub-agents of each native chat session; their Board rows, safety, worktrees and skills.
  const nativeTeam = helpers && {
    helpers,
    approve: (request: { summary: string; reason: string; reasonMax?: number }, signal?: AbortSignal) => computer.approve(request, signal),
    approveFile: (request: { summary: string; reason: string }, signal?: AbortSignal) => computer.approveFile(request, signal),
    approveFileEdit: (request: import("./computer-bridge.ts").FileEditReview & { summary: string }, signal?: AbortSignal) => computer.approveFileEdit(request, signal),
    ...(memory ? { filePermissions: memory.filePermissions } : {}),
    // `decisions` and `planModels` are made further down: read only when an Agent call runs.
    chooseModel: async (task: string, member: HelperView) =>
      (await agentModel({ member, task, engine: decisions, allowLarge: helpers.allowLarge(), models: planModels() })).model,
    worktrees,
    browser: (helper: string) => browserServer(dirname(worktrees), helper),
    readAssignedSkill: (name: string) => readSkill(name, userSkillsDir(), skillsDir),
    skills: (chatId: string) => {
      const names = [...new Set(helpers.list().flatMap((h) => h.skills))];
      if (!names.length) return undefined;
      const dir = join(dirname(worktrees), "skill-plugins", "chats", chatId.replace(/[^\w.-]/g, "_"));
      return { ...prepareSkills(dir, names, userSkillsDir(), skillsDir), plugin: SKILLS_PLUGIN };
    },
    onWake: (chatId: string, text: string, saved: boolean) => {
      log.info("agent.woke", { chatId, saved });
      if (!saved && memory) {
        const stored = memory.chats.messages(chatId);
        if (!stored.length) return;
        const all: Message[] = [...stored, { role: "assistant", content: text }];
        memory.chats.save(chatId, all);
      }
      for (const listener of postedListeners) listener(chatId);
      for (const listener of chatListeners) listener();
      // Phase N3: said in the voice chat (ADR-106 rules), sent to Telegram for its chat or a routine with the flag.
      routeWake(chatId, text, {
        voiceChat: () => core.sessionId,
        speak: (line) => goalLineListeners.forEach((listener) => listener(line)),
        telegram: (line, pushed) => telegram?.send(line, pushed),
        routine: (id) => helpers.list().flatMap((h) => h.routines).find((r) => r.id === id),
      });
    },
  };
  // Phase N2: a native job stopped anywhere (the window, Telegram) stops its sub-agent in the session that runs it.
  helpers?.onChange((change) => {
    if (change.action !== "job" || change.state !== "stopped") return;
    for (const native of nativeCores) void native.stopJob(change.job).catch(() => log.warn("agent.stop_failed", { job: change.job }));
  });
  /** The provider and model of a chat: its own choice (a text chat), else the one in Settings. */
  const taskContextChat = (chatId: string) => helpers ? retrySourceChat(helpers, chatId) ?? chatId : chatId;
  const chatChoice = (chatId: string, source: InputSource) => {
    const own = source === "text" ? islandChats?.modelOf?.(chatId) ?? islandChats?.modelOf?.(taskContextChat(chatId)) : undefined;
    const checked = own && settings.check(own.provider, own.model);
    return checked && !("error" in checked) ? checked.choice : settings.current();
  };
  const otherModels = new Map<string, ReturnType<typeof createModel>>();
  const codexModels = new Set<ReturnType<typeof createGateway>>();
  const codexRouters = new Set<ReturnType<typeof createCodexToolRouter>>();
  const makeCore = (composed = false): Core => {
    const models = new Map<string, ReturnType<typeof createGateway>>();
    const routers = new Map<string, ReturnType<typeof createCodexToolRouter>>();
    const native = createNativeCore({
            accessFor: (chat) => memory?.chats.access(taskContextChat(chat)) ?? "checked",
            approveAccess: (request, signal) => computer.approve(request, signal),
            claudePath: keys[CLAUDE_PLAN] ?? "",
            tools: toolEngine,
            ...(!composed ? { windowTools: chatWork.tools, onSdkEvent: chatWork.sdk, clarifications: chatWork.clarifications } : {}),
            ...(nativeTeam ? { team: nativeTeam } : {}),
            reasoningFor: (chatId: string, source: InputSource) => {
              if (source !== "text" || composed) return undefined;
              const choice = chatChoice(chatId, source);
              const selected = memory?.chats.reasoning(chatId, choice.provider, choice.model);
              if (selected && !settings.reasoning!(choice.provider, choice.model).levels.includes(selected)) {
                throw new Error("This chat's thinking level is no longer available. Refresh models or choose Default in its thinking selector.");
              }
              return selected ?? (choice.provider === "codex" ? settings.reasoning!(choice.provider, choice.model).default : undefined);
            },
            modelFor: (chatId: string, source: InputSource) => {
              const choice = chatChoice(chatId, source);
              return choice.provider === CLAUDE_PLAN ? choice.model : undefined;
            },
            toolModel: (chatId: string, source: InputSource) => {
              const choice = chatChoice(chatId, source);
              const program = keys.codex;
              if (choice.provider !== "codex" || !program) return undefined;
              let gateway = models.get(choice.model);
              if (!gateway) {
                const onUsage = (u: { input: number; output: number; cacheRead: number; cacheWrite: number }, request: import("@atom/contracts").ModelRequest, actualModel: string) => {
                  const match = /^job:(\d+)$/.exec(request.context.requestId);
                  if (match && helpers) {
                    const job = Number(match[1]);
                    const row = helpers.get(job);
                    if (row) { helpers.setModel(job, actualModel, "The model Codex ran this agent on."); helpers.addUsage({ source: "job", helper: row.helper, job, model: actualModel, chatId: request.context.sessionId, ...u }); }
                  } else recordChatUsage(u, actualModel, { chatId: request.context.sessionId });
                };
                const router = createCodexToolRouter({ program, model: choice.model, tools: toolEngine,
                  accessFor: (chat) => memory?.chats.access(taskContextChat(chat)) ?? "checked",
                  approveAccess: (request, signal) => computer.approve(request, signal),
                  workerModelAllowed: (model) => codexWorkerModels().some((m) => m.id === model),
                  projectCommandsAllowed: (chat, root) => {
                    const source = taskContextChat(chat);
                    if (chatTurns.wasDeleted(chat) || chatTurns.wasDeleted(source)) return false;
                    const id = projects?.projectOf(source);
                    if (!id || memory?.projects.get(id)?.archived !== false) return false;
                    return projects?.turn(source)?.files?.cwd === root;
                  },
                  webAllowed: (chat) => {
                    if (chatTurns.wasDeleted(chat) || chatTurns.wasDeleted(taskContextChat(chat))) return false;
                    if (readEnv(process.env, "ATOM_WEB") === "0") return false;
                    const projectId = projects?.projectOf(taskContextChat(chat));
                    return !projectId || memory?.projects.get(projectId)?.web === true;
                  },
                  ...(!composed ? { observe: chatWork.observe } : {}), ...(nativeTeam ? { team: nativeTeam } : {}), onUsage });
                routers.set(choice.model, router); codexRouters.add(router);
                gateway = createGateway({ provider: createCodexSessionAdapter({ program, model: choice.model, runner: (request) => router.forRequest(request), onUsage, onDiagnostic: (data, request) => log.info("codex.turn", { requestId: request.context.requestId, ...data, setup: JSON.stringify(data.setup), context: JSON.stringify(data.context), usage: data.usage ? JSON.stringify(data.usage) : undefined }) }), timeoutMs: Math.max(config.llm.timeoutMs, PLAN_TIMEOUT_MS), maxRetries: 0 });
                models.set(choice.model, gateway); codexModels.add(gateway);
              }
              return gateway;
            },
            stopToolJob: (job) => [...routers.values()].some((router) => router.stopJob(job)),
            revokeToolPermissions: (chat) => { for (const router of routers.values()) router.revoke(chat); },
            // Text-only provider adapters share the saved transcript. Codex normally uses toolModel above.
            otherModel: (chatId: string, source: InputSource) => {
              const choice = chatChoice(chatId, source);
              const apiKey = keys[choice.provider];
              if (choice.provider === CLAUDE_PLAN || !apiKey) return undefined;
              const id = `${choice.provider}:${choice.model}`;
              let other = otherModels.get(id);
              if (!other) otherModels.set(id, (other = createModel(choice, apiKey)));
              return other;
            },
            context: (input: ZenoInput) => [nowLine(), memory ? memoryContext(input.text, { store: memory }) : undefined, screen.take()].filter(Boolean).join("\n\n"),
            // Phase N3: no team line: the agents reach Claude Code as its agent listing ("Name: role"), and the
            // line named the legacy delegate tool, which the native engine does not have.
            opening: async (chatId: string, text: string) =>
              [
                memory ? MEMORY_GUIDANCE : undefined,
                await keptChats?.context(text).catch((error: unknown) => void log.warn("memory.kept_search_failed", { message: describe(error) })),
                memory && episodes ? episodeContext(memory, taskContextChat(chatId)) : undefined,
                projects?.digest(taskContextChat(chatId)),
              ].filter(Boolean).join("\n\n"),
            ...(projects ? { project: (chatId: string) => projects.turn(taskContextChat(chatId)) } : {}),
            ...(attachments ? { attachments: { turn: (chatId: string) => attachments.turn(taskContextChat(chatId)), expand: (chatId: string, text: string) => attachments.expand(taskContextChat(chatId), text) } } : {}),
            // A skill of the name first, then one of Keshab's Claude commands (ADR-117): both are "/name words".
            skills: { use: (text: string) => useSkill(text, userSkillsDir(), skillsDir) ?? useCommand(text, userCommandsDir()) },
            // Phase N2: no worker shortcut: "Sid, …" is a main-agent turn that hands the request to Sid.
            ...(toolShortcuts ? { shortcuts: toolShortcuts } : {}),
            onExchange: (sessionId: string, turns: readonly Message[], completion?: { requestId: string; reply: string }) => {
              saveChat(sessionId, turns, !composed ? completion : undefined);
              episodes?.update(sessionId, turns);
            },
            onLeave: (sessionId: string) => void episodes?.flush(sessionId),
            ...(memory ? { archived: (chatId: string) => memory.chats.messages(chatId), chatBrief: (chatId: string) => memory.chats.brief(chatId) } : {}),
            ...(chatSessions ? { chatSessions } : {}),
            clientComposed: composed,
            screenReplies: !composed,
            web: readEnv(process.env, "ATOM_WEB") !== "0",
            timeoutMs: Math.max(config.llm.timeoutMs, PLAN_TIMEOUT_MS),
            ...(Number(readEnv(process.env, "ATOM_SESSION_IDLE_MS")) > 0 ? { idleMs: Number(readEnv(process.env, "ATOM_SESSION_IDLE_MS")) } : {}),
            onUsage: reportUsage,
            onTokens: (tokens, model, meta) => recordChatUsage(tokens, model, meta),
            onModelTotals: recordOverhead,
            log: (event, fields) => log.info(event, fields as LogFields),
          });
    nativeCores.add(native);
    return native;
  };
  const baseCore: Core = readEnv(process.env, "ATOM_VOICE_ONLY") === "1" ? createEchoCore() : makeCore();
  // ADR-080: with computer control on, replies lose their [POINT:…] marker before speech, and a valid one points.
  const core: Core = computerOn
    ? withPointing(baseCore, {
        takeShot: () => {
          const shot = lastShot;
          lastShot = undefined;
          return shot;
        },
        // A box around the spot, so Pal stands on it as it does on an element (computer.point wants w and h above 0).
        point: (t) => void computer.point({ x: t.x - POINT_BOX / 2, y: t.y - POINT_BOX / 2, w: POINT_BOX, h: POINT_BOX, label: t.label }),
        log: (e) => log.info("pointing.marker", e),
      })
    : baseCore;
  // ADR-064: start the model up now (the Claude plan pre-starts Claude Code), and again after a model switch.
  core.prepare();
  const settingsPath = options.settingsPath;
  const settings = createModelSettings({
    initial,
    keys,
    model,
    createModel: (choice, apiKey) => {
      const next = createModel(choice, apiKey);
      queueMicrotask(() => core.prepare()); // runs once the switch has put `next` in place
      return next;
    },
    save: (choice) => {
      if (settingsPath) writeSavedChoice(settingsPath, choice);
    },
    log,
    scan: () => scanAiTools(), // ADR-093
    listCodexModels: (program) => listCodexModels(program),
    listPlanModels: (claudePath) => listPlanModels(claudePath), // ADR-097
  });
  // ADR-083: Laya rates each job's difficulty. Its server starts on the first job, stays warm, and stops in close().
  // ATOM_LAYA=0 turns it off (every job then gets the role's default tier).
  const decisions = createLayaEngine({ log });
  // ADR-098 item 3: Keshab's messages to running tasks (the ATOM window; Telegram calls the same). ADR-110 N5: a note to a
  // task is a message to the main agent of the chat that runs it.
  const steering = helpers ? nativeSteering(() => nativeCores) : undefined;
  /** The Claude plan's models for worker jobs, by tier; empty on any other provider. */
  const planModels = () =>
    settings.current().provider === CLAUDE_PLAN ? tieredModels(settings.info().providers.find((p) => p.id === CLAUDE_PLAN)?.models ?? []) : [];
  const codexWorkerModels = () => {
    const provider = settings.info().providers.find((p) => p.id === "codex");
    return provider?.available ? provider.models : [];
  };
  /** Runs a soul proposal's or skill edit's test cases on Sonnet at most; the cost counts on the Tinker task that made it. */
  const runTests = async (kind: TestKind, id: number, signal: AbortSignal, tinkerJob = helpers?.tinkerTaskOf(kind, id)) => {
    if (!helpers) throw new Error("Test cases need the helpers file.");
    if (settings.current().provider !== CLAUDE_PLAN) throw new Error("Test cases run on the Claude plan.");
    const model = modelForTier(planModels(), "medium") ?? settings.current().model;
    try {
      await runTestCases({
        store: helpers,
        kind,
        id,
        run: { claudePath: keys["claude-plan"] ?? "", model, signal, onUsage: reportUsage },
        count: (_costUsd, tokens) => {
          if (tokens) helpers.addUsage({ source: "job", helper: "tinker", ...(tinkerJob !== undefined ? { job: tinkerJob } : {}), model, ...tokens, ...(tokens.costUsd ? { dollars: tokens.costUsd } : {}) });
        },
        onEvent: (e) => log.info("test.run", e),
      });
    } catch (error) {
      log.warn("test.failed", { ...errorFields(error), testKind: kind, id });
      throw error;
    }
  };
  // ADR-110 N5: Tinker's tasks have no chat; they keep a small runner of their own (tinker-runner.ts).
  const tinker: TinkerRunner | undefined =
    helpers &&
    startTinkerRunner({
      store: helpers,
      run: createTinkerRun({ helpers, settings, keys, decisions, planModels, reportUsage, log, runTests: (kind, id, signal, tinkerJob) => runTests(kind, id, signal, tinkerJob) }),
      onRun: (e) => log.info("job.run", e),
    });
  // Task 3.16: the Paperclip tasks ATOM handed over are looked at every minute; a finished one is said once.
  if (paperclip) {
    const look = () =>
      void checkIssues(paperclip.client, paperclip.tracker)
        .then((lines) => {
          if (!lines.length) return;
          log.info("paperclip.done", { count: lines.length });
          paperclipChanged();
          for (const line of lines) for (const listener of goalLineListeners) listener(line);
        })
        .catch(() => log.warn("paperclip.check_failed", {})); // an unhandled rejection ends the whole app
    setInterval(look, 60_000).unref();
  }
  // Lines to say aloud (the island's goal lines): a sub-agent's report in the voice chat (routeWake), a Paperclip task.
  const goalLineListeners = new Set<(line: string, after?: () => void) => void>();
  const tts = createSpeaker(createKokoroSynthesizer({ voice: config.tts.voice, dtype: config.tts.dtype }));
  // ADR-098: ATOM's own Telegram bot, only when both .env values are set. Its turns go to a Core of their own, saved as
  // the chat "Telegram". The token and the messages are never logged.
  const telegramToken = readEnv(process.env, "ATOM_TELEGRAM_BOT_TOKEN")?.trim();
  const telegramChat = readEnv(process.env, "ATOM_TELEGRAM_CHAT_ID")?.trim();
  const telegramUser = readEnv(process.env, "ATOM_TELEGRAM_USER_ID")?.trim(); // the one person obeyed in a group; a private chat needs none
  let telegram: TelegramBot | undefined;
  if (telegramToken && telegramChat && readEnv(process.env, "ATOM_VOICE_ONLY") !== "1") {
    const telegramCore = makeCore(true);
    telegramCore.resume(TELEGRAM_CHAT, memory?.chats.messages(TELEGRAM_CHAT) ?? []);
    telegram = startTelegramBot({
      token: telegramToken,
      chatId: telegramChat,
      ...(telegramUser ? { userId: telegramUser } : {}),
      log,
      ask: async (text) => (await telegramCore.handle({ text, source: "text" })).text,
      ...(helpers ? { helpers } : {}),
      approvals: computer,
      describe,
      ...(steering ? { steering } : {}),
    });
  }
  // ADR-110 (N3): a routine (due, or started by webhook) is a main-agent turn in its own chat, after the Telegram bot
  // exists (its flag sends the result there).
  const nativeStart =
    helpers
      ? routineStarter({
          core: makeCore(true),
          messages: (chatId) => memory?.chats.messages(chatId) ?? [],
          busy: (chatId) => helpers.list().some((h) => h.jobs.some((j) => j.chatId === chatId && !isFinal(j.state))),
          name: (helper) => helpers.list().find((h) => h.id === helper)?.name,
          telegram: (line, pushed) => telegram?.send(line, pushed),
          failed: (line) => goalLineListeners.forEach((listener) => listener(line)),
          log,
        })
      : undefined;
  // ADR-110 N5: a task from a worker's page, or its Retry button, is a main-agent turn in a chat of its own ("task-<n>").
  let taskActive = false;
  const taskActivityListeners = new Set<() => void>();
  const taskActivity = {
    busy: () => taskActive,
    onChange: (listener: () => void) => { taskActivityListeners.add(listener); return () => void taskActivityListeners.delete(listener); },
  };
  const startTask =
    helpers
      ? taskStarter({ core: makeCore(true), name: (helper) => helpers.list().find((h) => h.id === helper && h.available)?.name, failed: (line) => goalLineListeners.forEach((listener) => listener(line)), activity: (active) => { taskActive = active; for (const listener of taskActivityListeners) listener(); }, retryPending: (id) => { const job = helpers.get(id); return job?.state === "queued" && job.retryOf !== undefined; }, retrySettled: (id, reason) => helpers.failQueuedRetry(id, reason ?? "The retry turn ended without starting its worker. Review this attempt before trying again."), log })
      : undefined;
  retryTask = helpers && startTask ? nativeRetryStarter({ store: helpers, start: startTask }) : undefined;
  // ADR-098 item 5: the local API. Its turns go to a singleton Core, saved as the chat "api" (or "api-<chatId>"). It
  // listens only after Settings' "Local API" switch is on.
  const apiAsk = createApiTurnRunner({
    chatTurns,
    makeCore: () => makeCore(true),
    ...(memory ? { messages: (chat: string) => memory.chats.messages(chat) } : {}),
  });
  const api: ApiServer | undefined =
    readEnv(process.env, "ATOM_VOICE_ONLY") === "1"
      ? undefined
      : createApiServer({
          log,
          port: readEnv(process.env, "ATOM_API_PORT"),
          host: readEnv(process.env, "ATOM_API_HOST"),
          ask: apiAsk,
          ...(helpers ? { helpers } : {}),
          approvals: computer,
          describe,
          // ADR-110 (N3): a goal is a turn in its own chat "api-goal-<id>"; its status reads that chat's Board rows.
          said: (chatId: string) => memory?.chats.messages(chatId).find((m) => m.role === "user")?.content,
          ...(nativeStart ? { startRoutine: nativeStart } : {}),
        });
  // Task 3.9: routines come due on the clock. At start, one catch-up for each that came due while ATOM was closed. A
  // routine starts by `nativeStart` (ADR-110 N3).
  if (helpers && nativeStart) {
    const tick = () => scheduleTick(helpers, log, (error) => ({ ...errorFields(error) }), nativeStart);
    tick();
    setInterval(tick, SCHEDULER_TICK_MS).unref();
  }
  // Daily brief (upgrades.md C3): the day gathered by code, written by one model run without tools, saved, and delivered as
  // the settings say. Off until the user turns it on. Logs counts only, never the lines.
  const briefStore = memory?.briefs;
  const briefListeners = new Set<() => void>();
  let briefRunning = false;
  const briefCalendar = calendarHelper ? createCalendarTools({ run: calendarRunner(calendarHelper) }) : [];
  const toolText = async (tools: readonly { spec: { name: string }; run(input: Record<string, unknown>): unknown }[], name: string, input: Record<string, unknown> = {}) => {
    const tool = tools.find((t) => t.spec.name === name);
    return tool ? String(await tool.run(input)) : "";
  };
  const dailyBrief =
    briefStore &&
    createBriefRunner({
      briefs: briefStore,
      log: { info: (event, fields) => log.info(event, fields as LogFields), warn: (event, fields) => log.warn(event, fields as LogFields) },
      sources: {
        ...(briefCalendar.length
          ? {
              events: () => {
                const from = new Date();
                from.setHours(0, 0, 0, 0);
                const to = new Date(from);
                to.setDate(to.getDate() + 1);
                return toolText(briefCalendar, "calendar_events", { from: from.toISOString(), to: to.toISOString() });
              },
              reminders: () => toolText(briefCalendar, "reminders_list"),
            }
          : {}),
        ...(weather ? { weather: () => Promise.resolve(weather.run({ days: 1 })).then(String) } : {}),
        ...(helpers
          ? {
              tasks: (since: string) =>
                helpers
                  .list()
                  .flatMap((h) => h.jobs.filter((j) => j.state === "done" && j.endedAt && j.endedAt.toISOString() > since).map((j) => `${h.name}: ${j.title ?? "a task"}`)),
              needsYou: () => {
                const lines: string[] = [];
                const awaiting = helpers.list().flatMap((h) => h.jobs).filter((j) => j.planStatus === "awaiting").length;
                const proposals = helpers.list().flatMap((h) => h.proposals).filter((p) => p.state === "pending").length;
                const drafts = helpers.skillDrafts().filter((d) => d.state === "pending").length;
                if (awaiting) lines.push(`${awaiting} plan${awaiting === 1 ? "" : "s"} to approve`);
                if (proposals) lines.push(`${proposals} suggested change${proposals === 1 ? "" : "s"} to an agent`);
                if (drafts) lines.push(`${drafts} skill draft${drafts === 1 ? "" : "s"} to review`);
                return lines;
              },
            }
          : {}),
        timers: () => timers.list().map((t) => `${t.label || "Timer"}, ${Math.max(1, Math.round((t.endsAt.getTime() - Date.now()) / 60_000))} min left`),
      },
      write: async (task, signal) => {
        const small = modelForTier(planModels(), "small");
        if (!small) throw new Error("The brief needs the Claude plan.");
        const { lines, tokens } = await runBrief({ claudePath: keys[CLAUDE_PLAN] ?? "", model: small, task, instructions: BRIEF_INSTRUCTIONS, signal, onUsage: reportUsage });
        if (tokens) recordChatUsage(tokens, small, { background: true });
        return lines;
      },
      deliver: (brief, settings) => {
        if (settings.telegram) telegram?.send(brief.lines.join("\n"), true);
        if (settings.spoken) for (const line of brief.lines) for (const listener of goalLineListeners) listener(line);
      },
    });
  if (dailyBrief && briefStore) {
    briefStore.onChange(() => briefListeners.forEach((listener) => listener()));
    setInterval(() => void dailyBrief.tick(), SCHEDULER_TICK_MS).unref();
  }
  /** "Brief me" now (the window's button, or the voice tool): one run at a time. */
  const runBriefNow = async () => {
    if (!dailyBrief) throw new Error("The daily brief needs memory.");
    briefRunning = true;
    briefListeners.forEach((listener) => listener());
    try {
      return await dailyBrief.run("manual");
    } finally {
      briefRunning = false;
      briefListeners.forEach((listener) => listener());
    }
  };
  briefNow = dailyBrief ? runBriefNow : undefined;
  // The helpers as the window lists them, for the search (agents, routines, skills).
  const searchHelpers = helpers ? islandHelpers(helpers, installedApps, planModels, () => listSkills(userSkillsDir(), skillsDir, new Set(helpers.skillHubInstalled().map((i) => i.name))), undefined, codexWorkerModels) : undefined;
  return {
    config,
    log,
    chatTurns,
    core,
    settings,
    stt,
    tts,
    computer,
    ...(attachments
      ? {
          islandAttachments: {
            add: (chatId: string, paths: readonly string[]) => {
              // A project chat reads its folder, not attachments: the file belongs in the project's folder.
              if (projects?.projectOf(chatId)) return { error: "A project chat reads the project's folder. Put the file in that folder, or attach it in a chat outside the project." };
              return attachments.add(chatId, paths);
            },
          },
        }
      : {}),
    // Search everything (upgrades.md C1): local sources only; nothing goes to a model. Logs counts, never the words.
    everything: {
      search: (query: string) =>
        searchEverything(
          {
            ...(brainWiring ? { brain: (q: string) => brainWiring.island.search(q) } : {}),
            ...(islandMemory ? { facts: () => islandMemory.list(), episodes: () => islandMemory.episodes() } : {}),
            ...(projects ? { projects: () => projects.island.list() } : {}),
            ...(searchHelpers ? { agents: () => searchHelpers.list(), skills: () => searchHelpers.skills() } : {}),
          },
          query,
          (group) => log.warn("search.group_failed", { group }),
        ),
    },
    // Text editing follows the active chat's provider; no tools, memory or history, and no provider fallback.
    islandTextEdit: createTextEditor({
      log: { info: (event, fields) => log.info(event, fields as LogFields) },
      write: providerTextWriter({
        choice: () => chatChoice(core.sessionId, "text"),
        context: () => ({ requestId: randomUUID(), sessionId: core.sessionId, source: "text", receivedAt: new Date(), background: true }),
        other: (choice) => {
          const key = keys[choice.provider as keyof typeof keys];
          if (!key) throw new Error("The selected model is not signed in. Choose a model in this chat.");
          if (choice.provider === "codex") return createGateway({
            provider: createCodexSessionAdapter({ program: key, model: choice.model, runner: () => ({ specs: () => [], run: async (call) => ({ callId: call.id, content: "Text editing has no tools.", isError: true }) }), onUsage: (usage, _request, model) => recordChatUsage(usage, model, { background: true }) }),
            timeoutMs: config.llm.timeoutMs, maxRetries: 0,
          });
          return createModel(choice as LlmChoice, key);
        },
        claude: async (task, signal) => {
          const small = modelForTier(planModels(), "small");
          if (!small) throw new Error("Ask ATOM needs the Claude plan.");
          const { text, tokens } = await runEdit({ claudePath: keys[CLAUDE_PLAN] ?? "", model: small, task, instructions: EDIT_INSTRUCTIONS, signal, onUsage: reportUsage });
          if (tokens) recordChatUsage(tokens, small, { background: true });
          return text;
        },
      }),
    }),
    ...(briefStore
      ? {
          islandBrief: {
            state: () => ({
              settings: briefStore.settings(),
              history: briefStore.history().map((b) => ({ id: b.id, day: b.day, createdAt: b.createdAt.toISOString(), lines: b.lines, source: b.source })),
              running: briefRunning,
            }),
            run: () => void runBriefNow().catch((error) => log.warn("brief.failed", { ...errorFields(error) })),
            update: (change: BriefChange) => void briefStore.update(change),
            onChange: (listener: () => void) => (briefListeners.add(listener), () => briefListeners.delete(listener)),
          },
        }
      : {}),
    ...(memory
      ? {
          islandSuggestions: {
            list: () => memory.suggestions.pending().map((x) => ({ id: x.id, text: x.text, createdAt: x.createdAt.toISOString() })),
            enabled: () => memory.suggestions.enabled(),
            setEnabled: (on: boolean) => memory.suggestions.setEnabled(on),
            accept: (id: number, text?: string) => {
              const kept = memory.suggestions.accept(id, text);
              log.info("memory.change", { action: "remember", id: kept.id, count: memory.count(), by: "suggestion" });
              for (const listener of memoryListeners) listener(); // Memory page and the Second brain follow
            },
            deny: (id: number) => memory.suggestions.deny(id),
            onChange: (listener: () => void) => memory.suggestions.onChange(listener),
          },
        }
      : {}),
    ...(memory ? { islandMemory, islandChats, islandProjects: projects!.island, ...(brainWiring ? { islandBrain: brainWiring.island } : {}) } : {}),
    ...(projects && memory ? { islandWorkspace: createProjectWorkspace({ helpers, project: (id) => {
      const p = memory.projects.list().find((p) => p.id === id);
      return p ? { folder: p.folders[0] ?? "", archived: p.archived } : undefined;
    } }) } : {}),
    ...(islandGit ? { islandGit } : {}),
    islandSlashCommands: { list: () => listCommands(userCommandsDir()) },
    islandSkillFiles: { read: (name) => readSkillFile(name, userSkillsDir(), skillsDir), write: (name, text) => writeSkillFile(name, text, userSkillsDir(), skillsDir) },
    ...(helpers ? { islandHelpers: warmOnOpen(withPaperclip(paperclip, paperclipListeners, {
            ...islandHelpers(helpers, installedApps, planModels, () => listSkills(userSkillsDir(), skillsDir, new Set(helpers.skillHubInstalled().map((i) => i.name))), undefined, codexWorkerModels),
            hub: createHubCommands({ store: helpers, log }), // B3.5
            // ADR-110 N5: no legacy runner starts a queued task, so the page's task field and Retry hand it to the main agent.
            addJob: (helper: string, task: string) => {
              if (!startTask) throw new Error("Tasks need the helpers file.");
              startTask(helper, task);
            },
            openReport,
            // ADR-110 N5: a note to a task is a message to the main agent of its chat.
            ...(steering ? { steer: steering.steer, interrupt: steering.interrupt } : {}),
            // ADR-098 item 8: "Run tests" on a pending soul proposal or skill edit.
            runTests: (kind: TestKind, id: number) => runTests(kind, id, AbortSignal.timeout(TINKER_TIME_LIMIT_MS)),
            // ADR-090: a test starts the server (or connects), lists its tools, and records the outcome. Logs ids only.
            testMcp: async (id: number) => {
              const server = helpers.mcpServers().find((s) => s.id === id);
              if (!server) throw new Error("There is no such server.");
              const outcome = await testMcpServer(server);
              helpers.recordMcpTest(id, outcome);
              log.info("mcp.test", { server: id, ok: "tools" in outcome, tools: "tools" in outcome ? outcome.tools.length : 0 });
            },
          }), decisions) } : {}),
    screen,
    onTimer(listener) {
      timerListeners.add(listener);
      return () => timerListeners.delete(listener);
    },
    capabilities: () =>
      capabilityItems(settings.info().provider === "claude-plan" && readEnv(process.env, "ATOM_WEB") !== "0" ? [...tools, { capability: WEB_SEARCH }] : tools),
    onPlanUsage(listener) {
      planUsageListeners.add(listener);
      return () => planUsageListeners.delete(listener);
    },
    onGoalLine(listener) {
      goalLineListeners.add(listener);
      return () => goalLineListeners.delete(listener);
    },
    /** ADR-054: computer control is on in this run (ATOM_COMPUTER=1). Reported to the island, whose switch shows it. */
    computerOn,
    taskActivity,
    chatWork,
    ...(memory && foregroundReady ? { foreground: { ...memory.foreground, profile: (chat: string, source: InputSource) => chatChoice(chat, source) } } : {}),
    ...(telegram ? { telegram } : {}),
    ...(api ? { api } : {}),
    flushNotes: () => episodes?.flush() ?? Promise.resolve(),
    close: () => {
      for (const router of codexRouters) router.close();
      for (const gateway of codexModels) gateway.close?.();
      for (const gateway of otherModels.values()) gateway.close?.();
      telegram?.stop();
      api?.stop();
      tinker?.close();
      void decisions.close();
    },
    record: (handlers) => startRecording(config.audio, handlers),
    async micName() {
      if (config.audio.inputDevice !== ":default") return config.audio.inputDevice;
      const name = await defaultInputDevice();
      return name ? `macOS default: ${name}` : "macOS default";
    },
  };
}
