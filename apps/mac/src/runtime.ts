// The parts of the Mac runtime shared by both interfaces (terminal and island):
// Microphone → Whisper → ATOM Core → LLM Gateway → provider → Kokoro → speaker.

import { rmSync } from "node:fs";
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
  type Timers,
} from "@atom/tool-engine";
import { createGateway, createProviderAdapter, createSwitchableModel, listPlanModels, runChatDigest, type ChatSession, type ChatSessions, type PlanUsage } from "@atom/llm-gateway";
import { createNoteModel, createNotes } from "./notes.ts";
import { createChatUsageRecorder } from "./usage-report.ts";
import { createNativeCore, type NativeCore } from "./native-core.ts";
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
  type MemoryStore,
} from "@atom/memory";
import {
  createScheduleTool,
  tieredModels,
  modelForTier,
  isFinal,
  type TestKind,
  type HelperStore,
  type HelperView,
} from "@atom/helpers";
import { createLayaEngine } from "@atom/decision-engine";
import type { InputSource, LanguageModel, Message, RequestContext, ZenoInput } from "@atom/contracts";
import type { IslandChats, IslandGit, IslandHelpers, IslandMemory, IslandProjects } from "./island.ts";
import { islandHelpers } from "./island-helpers.ts";
import { createHubCommands } from "./hub-commands.ts";
import { SKILLS_PLUGIN, listSkills, prepareSkills, userSkillsDir } from "./skills.ts";
import { runTestCases } from "./test-runs.ts";
import { createEmbedder } from "./embedder.ts";
import { createKeptChats } from "./kept-chats.ts";
import { MAX_PROJECT_MESSAGES, createProjects } from "./projects-wiring.ts";
import { createIslandGit, withPaperclip } from "./island-wiring.ts";
import { nowLine, createEchoCore, describe, errorFields, findCalendarHelper, openHelpers, openMemory, warmOnOpen } from "./runtime-support.ts";

export { describe, errorFields, nowLine, seconds, withLogging } from "./runtime-support.ts";
import { TELEGRAM_CHAT, startTelegramBot, type TelegramBot } from "./telegram-bot.ts";
import { createApiServer, type ApiServer } from "./api-server.ts";
import { SCHEDULER_TICK_MS, scheduleTick } from "./scheduler.ts";
import { nativeSteering, routeWake, routineStarter, type TaskSteering } from "./native-entry.ts";
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
  /** What the user asked ATOM to keep (ADR-058). Undefined when ATOM_MEMORY=0 or the store could not open. */
  memory?: MemoryStore;
  /** The memory as Settings sees it (list, forget, clear, change updates). Undefined when memory is off. */
  islandMemory?: IslandMemory;
  /** ADR-091: Keshab's chat sessions as the ATOM window sees them. Undefined when memory is off. */
  islandChats?: IslandChats;
  /** ADR-107: projects as the ATOM window sees them. Undefined when memory is off. */
  islandProjects?: IslandProjects;
  /** Helpers' apps, jobs and reports (ADR-081). Undefined when the store could not open. */
  helpers?: HelperStore;
  /** The helpers as the ATOM window sees them. Undefined when the store could not open. */
  islandHelpers?: IslandHelpers;
  /** ADR-091: ATOM's task branches, and Keshab's push. Undefined when the helpers store could not open. */
  islandGit?: IslandGit;
  /** Pal dropped on a window (ADR-074): that app's read, held for the next request only. */
  screen: WindowPointer;
  /** Countdown timers (ADR-061). */
  timers: Timers;
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
  steering?: TaskSteering;
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
  // The request a memory tool is running for, for provenance. Set by the Core's context hook, which runs first.
  let current: { source: InputSource; requestId?: string } = { source: "voice" };
  const memoryListeners = new Set<() => void>();
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
  // ADR-097: a model chosen for a chat that is not saved yet; it goes into the chat's row at its first save.
  const unsavedChatModels = new Map<string, LlmChoice>();
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
  const saveChat = (sessionId: string, turns: readonly Message[]) => {
    if (!memory) return;
    try {
      memory.chats.save(sessionId, projects ? projects.fullTurns(sessionId, turns) : turns); // ADR-107: a project chat keeps all its turns
      projects?.saved(sessionId);
      const own = unsavedChatModels.get(sessionId);
      if (own && memory.chats.setModel(sessionId, own)) unsavedChatModels.delete(sessionId);
      const session = unsavedChatSessions.get(sessionId);
      if (session && memory.chats.setSession(sessionId, session)) unsavedChatSessions.delete(sessionId);
    } catch (error) {
      log.error("chat.save_failed", { message: describe(error) });
      return;
    }
    for (const listener of chatListeners) listener();
  };
  const islandChats: IslandChats | undefined = memory && {
    list: () => (projects?.chatSummaries() ?? memory.chats.list()).map((c) => ({ id: c.id, title: c.id === TELEGRAM_CHAT ? "Telegram" : c.title, updatedAt: c.updatedAt.toISOString(), messages: c.messages, ...(c.projectId ? { projectId: c.projectId } : {}) })),
    messages: (id) => memory.chats.messages(id),
    remove: (id) => {
      episodes?.discard(id); // ADR-108: no note for a deleted chat
      return memory.chats.remove(id);
    },
    modelOf: (id) => memory.chats.model(id) ?? unsavedChatModels.get(id) ?? projects?.modelOf(id), // ADR-107: the chat's own, else its project's
    rename: (id, title) => projects?.renameChat(id, title) ?? { error: "Projects are off." },
    projectOf: (id) => projects?.projectOf(id),
    replay: (id, turns) => projects?.replay(id, turns) ?? { turns, trimmed: false },
    search: (query) => memory.chats.search(query).map((c) => ({ id: c.id, title: c.title, snippet: c.snippet, at: c.updatedAt.toISOString() })),
    setModel: (id, provider, modelId) => {
      if (!id) return { error: "There is no chat to give a model to." };
      let own: LlmChoice | undefined;
      if (provider || modelId) {
        const checked = settings.check(provider, modelId);
        if ("error" in checked) return checked;
        own = checked.choice;
      }
      if (!memory.chats.setModel(id, own)) {
        if (own) unsavedChatModels.set(id, own);
        else unsavedChatModels.delete(id);
      }
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
  const helpers = openHelpers(helpersPath, log, helpersPath === ":memory:" ? undefined : agentsDir, skillsDir, checkpointsDir);
  // ADR-107: projects (a named folder and its chats); the chat code above reads this lazily.
  const projects = memory ? createProjects({ memory, ...(helpers ? { helpers } : {}), log, checkModel: (provider, model) => settings.check(provider, model) }) : undefined;
  // ADR-091: ATOM's task branches in the repositories Keshab granted; pushing one is his alone, asked from the window.
  const islandGit: IslandGit | undefined = helpers && createIslandGit(helpers);
  // Task 3.11: the tasks' git worktrees live beside the helpers file, never inside a granted repository.
  const worktrees = join(dirname(resolve(helpersPath === ":memory:" ? "data/x" : helpersPath)), "worktrees");
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
  const cua = computerOn ? createCuaTransport() : undefined;
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
    approve: (request: { summary: string; reason: string }) => computer.approve(request),
    // `decisions` and `planModels` are made further down: read only when an Agent call runs.
    chooseModel: async (task: string, member: HelperView) =>
      (await agentModel({ member, task, engine: decisions, allowLarge: helpers.allowLarge(), models: planModels() })).model,
    worktrees,
    browser: (helper: string) => browserServer(dirname(worktrees), helper),
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
        memory.chats.save(chatId, memory.chats.project(chatId) ? all.slice(-MAX_PROJECT_MESSAGES) : all);
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
    if (change.action !== "job" || change.state !== "stopped" || !helpers.get(change.job)?.sdkTaskId) return;
    for (const native of nativeCores) void native.stopJob(change.job).catch(() => log.warn("agent.stop_failed", { job: change.job }));
  });
  const makeCore = (composed = false): Core => {
    const native = createNativeCore({
            claudePath: keys[CLAUDE_PLAN] ?? "",
            tools: toolEngine,
            ...(nativeTeam ? { team: nativeTeam } : {}),
            modelFor: (chatId: string, source: InputSource) => {
              const own = source === "text" ? islandChats?.modelOf?.(chatId) : undefined;
              const checked = own && settings.check(own.provider, own.model);
              const choice = checked && !("error" in checked) ? checked.choice : settings.current();
              return choice.provider === CLAUDE_PLAN ? choice.model : undefined;
            },
            context: (input: ZenoInput) => [nowLine(), memory ? memoryContext(input.text, { store: memory }) : undefined, screen.take()].filter(Boolean).join("\n\n"),
            // Phase N3: no team line: the agents reach Claude Code as its agent listing ("Name: role"), and the
            // line named the legacy delegate tool, which the native engine does not have.
            opening: async (chatId: string, text: string) =>
              [
                memory ? MEMORY_GUIDANCE : undefined,
                await keptChats?.context(text).catch((error: unknown) => void log.warn("memory.kept_search_failed", { message: describe(error) })),
                memory && episodes ? episodeContext(memory, chatId) : undefined,
                projects?.digest(chatId),
              ].filter(Boolean).join("\n\n"),
            ...(projects ? { project: (chatId: string) => projects.turn(chatId) } : {}),
            // Phase N2: no worker shortcut: "Sid, …" is a main-agent turn that hands the request to Sid.
            ...(toolShortcuts ? { shortcuts: toolShortcuts } : {}),
            onExchange: (sessionId: string, turns: readonly Message[]) => {
              saveChat(sessionId, turns);
              episodes?.update(sessionId, turns);
            },
            onLeave: (sessionId: string) => void episodes?.flush(sessionId),
            ...(chatSessions ? { chatSessions } : {}),
            clientComposed: composed,
            web: readEnv(process.env, "ATOM_WEB") !== "0",
            timeoutMs: Math.max(config.llm.timeoutMs, PLAN_TIMEOUT_MS),
            ...(Number(readEnv(process.env, "ATOM_SESSION_IDLE_MS")) > 0 ? { idleMs: Number(readEnv(process.env, "ATOM_SESSION_IDLE_MS")) } : {}),
            onUsage: reportUsage,
            onTokens: (tokens, model, meta) => recordChatUsage(tokens, model, meta),
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
      void checkIssues(paperclip.client, paperclip.tracker).then((lines) => {
        if (!lines.length) return;
        log.info("paperclip.done", { count: lines.length });
        paperclipChanged();
        for (const line of lines) for (const listener of goalLineListeners) listener(line);
      });
    setInterval(look, 60_000).unref();
  }
  // Lines to say aloud (the island's goal lines): a sub-agent's report in the voice chat (routeWake), a Paperclip task.
  const goalLineListeners = new Set<(line: string, after?: () => void) => void>();
  const tts = createSpeaker(createKokoroSynthesizer({ voice: config.tts.voice, dtype: config.tts.dtype }));
  // ADR-098: ATOM's own Telegram bot, only when both .env values are set. Its turns go to a Core of their own, saved as
  // the chat "Telegram". The token and the messages are never logged.
  const telegramToken = readEnv(process.env, "ATOM_TELEGRAM_BOT_TOKEN")?.trim();
  const telegramChat = readEnv(process.env, "ATOM_TELEGRAM_CHAT_ID")?.trim();
  let telegram: TelegramBot | undefined;
  if (telegramToken && telegramChat && readEnv(process.env, "ATOM_VOICE_ONLY") !== "1") {
    const telegramCore = makeCore(true);
    telegramCore.resume(TELEGRAM_CHAT, memory?.chats.messages(TELEGRAM_CHAT) ?? []);
    telegram = startTelegramBot({
      token: telegramToken,
      chatId: telegramChat,
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
          log,
        })
      : undefined;
  // ADR-098 item 5: the local API. Its turns go to a Core of their own, saved as the chat "api" (or "api-<chatId>"). It
  // listens only after Settings' "Local API" switch is on.
  let apiCore: Core | undefined;
  let apiChat = "";
  const api: ApiServer | undefined =
    readEnv(process.env, "ATOM_VOICE_ONLY") === "1"
      ? undefined
      : createApiServer({
          log,
          port: readEnv(process.env, "ATOM_API_PORT"),
          ask: async (text, chatId) => {
            const chat = chatId ? `api-${chatId}` : "api";
            apiCore ??= makeCore(true);
            if (apiChat !== chat) {
              apiCore.resume(chat, memory?.chats.messages(chat) ?? []);
              apiChat = chat;
            }
            return (await apiCore.handle({ text, source: "text" })).text;
          },
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
  return {
    config,
    log,
    core,
    settings,
    stt,
    tts,
    computer,
    ...(memory ? { memory, islandMemory, islandChats, islandProjects: projects!.island } : {}),
    ...(islandGit ? { islandGit } : {}),
    ...(helpers ? { helpers, islandHelpers: warmOnOpen(withPaperclip(paperclip, paperclipListeners, {
            ...islandHelpers(helpers, installedApps, planModels, () => listSkills(userSkillsDir(), skillsDir, new Set(helpers.skillHubInstalled().map((i) => i.name)))),
            hub: createHubCommands({ store: helpers, log }), // B3.5
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
    timers,
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
    ...(telegram ? { telegram } : {}),
    ...(steering ? { steering } : {}),
    ...(api ? { api } : {}),
    flushNotes: () => episodes?.flush() ?? Promise.resolve(),
    close: () => {
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
