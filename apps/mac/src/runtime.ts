// The parts of the Mac runtime shared by both interfaces (terminal and island):
// Microphone → Whisper → ATOM Core → LLM Gateway → provider → Kokoro → speaker.

import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createCore, type Core } from "@atom/core";
import { turnChat, withTurnChat } from "./turn-chat.ts";
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
import { createNativeCore } from "./native-core.ts";
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
  createDelegateTool,
  createScheduleTool,
  createTeamTaskTool,
  createWorkerShortcut,
  holdFor,
  JOB_TIME_LIMIT_MS,
  teamContext,
  watchGoals,
  startJobRunner,
  tieredModels,
  modelForTier,
  isOver,
  type TestKind,
  type HelperStore,
  type Job,
  type JobRun,
  type JobRunner,
} from "@atom/helpers";
import { createLayaEngine } from "@atom/decision-engine";
import type { InputSource, LanguageModel, Message, RequestContext, ZenoInput } from "@atom/contracts";
import type { IslandChats, IslandGit, IslandHelpers, IslandMemory, IslandProjects } from "./island.ts";
import { islandHelpers } from "./island-helpers.ts";
import { taskSteering, type TaskSteering } from "./task-steering.ts";
import { createHubCommands } from "./hub-commands.ts";
import { listSkills, userSkillsDir } from "./skills.ts";
import { NOT_RUN_PLAN_LIMIT, runTestCases } from "./test-runs.ts";
import { createEmbedder } from "./embedder.ts";
import { createKeptChats } from "./kept-chats.ts";
import { startGoalPosts } from "./goal-post.ts";
import { createProjects } from "./projects-wiring.ts";
import { createRunOne } from "./run-job.ts";
import { createIslandGit, withPaperclip } from "./island-wiring.ts";
import { nowLine, createEchoCore, describe, errorFields, findCalendarHelper, openHelpers, openMemory, warmOnOpen } from "./runtime-support.ts";

export { describe, errorFields, nowLine, seconds, withLogging } from "./runtime-support.ts";
import { TELEGRAM_CHAT, startTelegramBot, type TelegramBot } from "./telegram-bot.ts";
import { createApiServer, type ApiServer } from "./api-server.ts";
import { SCHEDULER_TICK_MS, scheduleTick } from "./scheduler.ts";
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
    // ADR-082/087, Task 3.5: Pal hands work to the team. Logs the goal id and task count only.
    ...(helpers ? [createDelegateTool({ store: helpers, source: () => turnChat.getStore(), project: () => projects?.delegate(turnChat.getStore()), onDelegated: (e) => log.info("goal.delegated", e) })] : []),
    // Task 3.9: routines by voice in any wording. Logs the routine id and worker only.
    ...(helpers ? [createScheduleTool({ store: helpers, onScheduled: (e) => log.info("routine.scheduled", e) })] : []),
    // ADR-094: work no single worker fits waits for whoever wakes. Logs the team task id only.
    ...(helpers ? [createTeamTaskTool({ store: helpers, onPosted: (e) => log.info("team.posted", e) })] : []),
  ];
  const toolEngine = createToolEngine({ tools, onCall: (e) => log.info("tool.call", e) });
  const planUsageListeners = new Set<(usage: PlanUsage) => void>();
  // Plan use goes in the log so it is visible how much of the plan a day of ATOM takes. No keys, no text.
  // ADR-076: and to the island's meters. Helper jobs report theirs here too.
  // Task 3.7: the plan's five-hour use in percent, last reported, so new worker runs can wait above the set limit.
  let planUsed: number | undefined;
  const reportUsage = (usage: PlanUsage) => {
    log.info("plan.usage", { ...usage });
    if (typeof usage.fiveHour === "number") {
      planUsed = usage.fiveHour * 100;
      queueMicrotask(() => runner?.poke()); // after start-up: the runner is made below
    }
    for (const listener of planUsageListeners) listener(usage);
  };
  const recordChatUsage = createChatUsageRecorder(helpers, log); // Job 1 (token cost)
  const createModel = (choice: LlmChoice, apiKey: string) =>
    createGateway({
      provider: createProviderAdapter({
        ...choice,
        apiKey,
        tools: toolEngine,
        onUsage: reportUsage,
        // ADR-091: ATOM's own answers count on the Dashboard too.
        onTokens: (tokens, model, meta) => recordChatUsage(tokens, model, meta),
        ...(chatSessions ? { chatSessions } : {}), // ADR-098 item 9
      }),
      // Claude Code starts its own process and may take several tool turns, so it gets longer than one API call.
      timeoutMs: choice.provider === "claude-plan" ? Math.max(config.llm.timeoutMs, PLAN_TIMEOUT_MS) : config.llm.timeoutMs,
    });
  const initial = { provider: config.llm.provider, model: config.llm.model };
  const model = createSwitchableModel(createModel(initial, config.llm.apiKey));
  // ADR-097: a typed turn in a chat with its own model uses that model; voice, new chats and the rest use the default.
  // One gateway per chosen model, made when first needed and kept.
  const chatGateways = new Map<string, LanguageModel>();
  const modelForTurn = (context: RequestContext): LanguageModel => {
    if (context.source !== "text") return model;
    const own = islandChats?.modelOf?.(context.sessionId);
    if (!own) return model;
    const checked = settings.check(own.provider, own.model);
    if ("error" in checked) {
      log.warn("chat.model_unusable", { reason: checked.error });
      return model;
    }
    const { choice } = checked;
    const fallback = settings.current();
    if (choice.provider === fallback.provider && choice.model === fallback.model) return model;
    const key = `${choice.provider}\n${choice.model}`;
    let gateway = chatGateways.get(key);
    if (!gateway) {
      gateway = createModel(choice, keys[choice.provider]!);
      chatGateways.set(key, gateway);
    }
    return gateway;
  };
  const coreModel: LanguageModel = {
    complete: (request, signal) => modelForTurn(request.context).complete(request, signal),
    prepare: (request) => model.prepare?.(request),
    close: () => model.close?.(),
  };
  // ADR-059: a short summary of each conversation, written in the background with the same model (no tools).
  // ADR-097: the chat's own model when it has one; it never joins the chat's session (`background`).
  // ADR-108: on the Claude plan the note runs on the small model (as the chat digest does), whatever the chat's model.
  const noteGateways = new Map<string, LanguageModel>();
  const noteModel = createNoteModel({
    fallback: coreModel,
    smallModel: () => modelForTier(planModels(), "small"),
    gatewayFor: (id) => {
      let gateway = noteGateways.get(id);
      if (!gateway) {
        gateway = createModel({ provider: CLAUDE_PLAN, model: id }, keys[CLAUDE_PLAN]!);
        noteGateways.set(id, gateway);
      }
      return gateway;
    },
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
  // ADR-081, Task 3.5: "Sid, …" goes straight to that worker, in code. Logs the worker and action only.
  const workerShortcut = helpers && createWorkerShortcut(helpers, (e) => log.info("worker.command", e), openReport);
  const shortcuts =
    toolShortcuts || workerShortcut
      ? async (text: string, signal?: AbortSignal) => (await workerShortcut?.(text)) ?? toolShortcuts?.(text, signal)
      : undefined;
  // ATOM_VOICE_ONLY=1: test speech in and out without the AI. ATOM reads back what Whisper heard, and no
  // request is made to any model. (Typed as `Core` so every caller treats it the same.)
  // ADR-098: one Core setup, used for the window's Core and the Telegram chat's own Core.
  // The chat of the turn that runs now. The Claude plan runs ATOM's tools through one shared runner, so the delegate tool
  // reads the chat from the turn (AsyncLocalStorage), not from a Core: two surfaces never share one value.
  const keys = { ...options.keys, [config.llm.provider]: config.llm.apiKey };
  const makeLegacyCore = (): Core => withTurnChat(createCore({
        model: coreModel,
        tools: toolEngine,
        context: async (input, context) => {
          current = { source: input.source, requestId: context.requestId };
          const pointed = screen.take(); // ADR-074: the window Pal was dropped on, for this request only
          if (!memory) return [nowLine(), pointed].filter(Boolean).join("\n\n");
          const facts = memoryContext(input.text, { store: memory });
          const past = episodes ? episodeContext(memory, context.sessionId) : undefined;
          const earlier = projects?.digest(context.sessionId); // ADR-107: a long project chat, replayed trimmed
          const keptLines = await keptChats?.context(input.text).catch((error: unknown) => {
            log.warn("memory.kept_search_failed", { requestId: context.requestId, message: describe(error) });
            return undefined;
          }); // ADR-097
          log.debug("memory.context", {
            requestId: context.requestId,
            kept: memory.count(),
            used: facts ? facts.split("\n").length - 1 : 0,
            episodes: past ? past.split("\n").length - 1 : 0,
          });
          return [nowLine(), facts, keptLines, past, earlier, pointed].filter(Boolean).join("\n\n");
        },
        // ADR-098 item 9: what rarely changes goes with the system prompt, where Claude caches it.
        // Task 3.5, ADR-095: who ATOM can hand work to; ADR-058: how to use memory.
        ...(projects ? { project: (sessionId: string) => projects.turn(sessionId) } : {}), // ADR-107
        standing: () => [helpers ? teamContext(helpers.list(), helpers.managers()) : undefined, memory ? MEMORY_GUIDANCE : undefined].filter(Boolean).join("\n\n"),
        ...(shortcuts ? { shortcuts } : {}),
        onExchange: (sessionId: string, turns: readonly Message[]) => {
          saveChat(sessionId, turns); // ADR-091
          episodes?.update(sessionId, turns);
        },
        onLeave: (sessionId: string) => void episodes?.flush(sessionId), // ADR-108: a chat that is left gets its note now
      }));
  // ADR-110 (Phase N1): ATOM_ENGINE=native gives each open chat one long-lived Claude Code session; legacy is the default.
  // `composed`: Telegram and the API, whose text goes to Claude Code as written.
  const makeCore = (composed = false): Core =>
    readEnv(process.env, "ATOM_ENGINE") !== "native"
      ? makeLegacyCore()
      : withTurnChat(
          createNativeCore({
            claudePath: keys[CLAUDE_PLAN] ?? "",
            tools: toolEngine,
            legacy: makeLegacyCore(),
            modelFor: (chatId: string, source: InputSource) => {
              const own = source === "text" ? islandChats?.modelOf?.(chatId) : undefined;
              const checked = own && settings.check(own.provider, own.model);
              const choice = checked && !("error" in checked) ? checked.choice : settings.current();
              return choice.provider === CLAUDE_PLAN ? choice.model : undefined;
            },
            context: (input: ZenoInput) => [nowLine(), memory ? memoryContext(input.text, { store: memory }) : undefined, screen.take()].filter(Boolean).join("\n\n"),
            opening: async (chatId: string, text: string) =>
              [
                helpers ? teamContext(helpers.list(), helpers.managers()) : undefined,
                memory ? MEMORY_GUIDANCE : undefined,
                await keptChats?.context(text).catch((error: unknown) => void log.warn("memory.kept_search_failed", { message: describe(error) })),
                memory && episodes ? episodeContext(memory, chatId) : undefined,
                projects?.digest(chatId),
              ].filter(Boolean).join("\n\n"),
            ...(projects ? { project: (chatId: string) => projects.turn(chatId) } : {}),
            ...(shortcuts ? { shortcuts } : {}),
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
          }),
        );
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
  // ADR-098 item 3: Keshab's messages to running tasks, and interrupts (the ATOM window; Telegram may call the same).
  const steering = helpers ? taskSteering(helpers, log) : undefined;
  /** The Claude plan's models for worker jobs, by tier; empty on any other provider. */
  const planModels = () =>
    settings.current().provider === CLAUDE_PLAN ? tieredModels(settings.info().providers.find((p) => p.id === CLAUDE_PLAN)?.models ?? []) : [];
  // ADR-095: a worker may run several tasks at once, so each run links its skills in a folder of its own, removed after.
  const skillPlugin = (job: Job) => join(dirname(worktrees), "skill-plugins", job.helper, String(job.id));
  // ADR-081/082, Task 3.2: helper jobs run beside the Core, on the Claude plan in use at the time each job starts.
  const runJob: JobRun = (job, context) =>
    runOne(job, context).finally(() => {
      rmSync(skillPlugin(job), { recursive: true, force: true });
      // B3.4: the files a run changed are noted as the run left them (a failure here never fails the task).
      try {
        helpers?.finishCheckpoints(job.id);
      } catch {
        log.warn("job.checkpoint_failed", { helper: job.helper, job: job.id, tool: "finish" });
      }
    });
  /** Tasks the runner let start on Codex; runOne takes each id out as it starts. */
  const codexJobs = new Set<number>();
  const runOne: JobRun = createRunOne({
    helpers,
    settings,
    keys,
    decisions,
    planModels,
    reportUsage,
    steering,
    computer,
    log,
    worktrees,
    skillsDir,
    skillPlugin,
    codexJobs,
    runTests: (kind, id, signal, tinkerJob) => runTests(kind, id, signal, tinkerJob),
  });
  // Logs ids, states, timings and page counts only: never the task, report or addresses.
  // Task 3.7: a task waits while its worker's or the team's budget is used up, or the plan is above its limit.
  let codexReady = false;
  const holdOf = (job: Job) => (helpers ? holdFor(job, helpers.budgets(), helpers.soul(job.helper).name, planUsed) : undefined);
  // ADR-098 item 7: with the switch on and Codex signed in, a worker task held only by the Claude plan's limit (not a
  // budget, not a plan waiting for Keshab; never Tinker or a Manager) starts on Codex instead, in a normal run slot.
  const codexMay = (job: Job) => {
    if (!helpers || !codexReady || !keys.codex || !helpers.codexFallback()) return false;
    if (job.planFirst && job.planStatus !== "approved") return false;
    const role = helpers.list().find((h) => h.id === job.helper)?.role;
    if (!role || role === "improver" || helpers.managers().some((m) => m.id === job.helper)) return false;
    return !holdFor(job, helpers.budgets(), helpers.soul(job.helper).name); // without the plan's use: held by nothing else
  };
  const held = (job: Job) => {
    const why = holdOf(job);
    return why && codexMay(job) ? undefined : why;
  };
  // ADR-098 item 8: test runs wait for the plan's limit and Tinker's (or the team's) budget like any run.
  const testHeld = () => {
    if (!helpers) return undefined;
    const b = helpers.budgets();
    if (planUsed !== undefined && b.planLimit < 100 && planUsed >= b.planLimit) return NOT_RUN_PLAN_LIMIT;
    const own = b.workers["tinker"];
    return (own && isOver(own)) || isOver(b.team) ? "Not run: budget used up" : undefined;
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
        held: testHeld,
        count: (costUsd, tokens) => {
          if (costUsd && tinkerJob !== undefined) helpers.addSpend(tinkerJob, costUsd);
          if (tokens) helpers.addUsage({ source: "job", helper: "tinker", ...(tinkerJob !== undefined ? { job: tinkerJob } : {}), model, ...tokens, ...(tokens.costUsd ? { dollars: tokens.costUsd } : {}) });
        },
        onEvent: (e) => log.info("test.run", e),
      });
    } catch (error) {
      log.warn("test.failed", { ...errorFields(error), testKind: kind, id });
      throw error;
    }
  };
  const runner: JobRunner | undefined =
    helpers &&
    startJobRunner({
      store: helpers,
      run: runJob,
      maxRunning: () => helpers.maxRunning(),
      onRun: (e) => log.info("job.run", e),
      mayStart: (job) => {
        if (!holdOf(job)) return true;
        if (!codexMay(job)) return false;
        codexJobs.add(job.id); // the runner starts it at once (it asks only with a free slot)
        return true;
      },
    });
  /** Codex found (keys.codex) and signed in: looked at on start and when the switch is turned on. Logs the answer only. */
  function checkCodex() {
    if (!keys.codex) return;
    void scanAiTools().then(
      (items) => {
        codexReady = items.some((item) => item.id === "codex" && item.signedIn === true);
        log.info("codex.ready", { ready: codexReady });
        runner?.poke();
      },
      () => (codexReady = false),
    );
  }
  checkCodex();
  // A new day (budgets) or an older plan window (its use falls) frees held tasks without any change in the store.
  if (runner) setInterval(() => runner.poke(), 60_000).unref();
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
  // Task 3.9, ADR-094: routines come due and workers wake on the clock. At start, one catch-up for each that came due
  // while ATOM was closed.
  if (helpers) {
    const tick = () => scheduleTick(helpers, planUsed, log, (error) => ({ ...errorFields(error) }));
    tick();
    setInterval(tick, SCHEDULER_TICK_MS).unref();
  }
  // Task 3.5: a goal whose tasks have all ended gets its combined report (one model call, no tools) and one line.
  const goalLineListeners = new Set<(line: string, after?: () => void) => void>();
  // Task 3.8: a plan waits for Keshab: one line, then Pal's approval card. Allow approves; Decline or no answer leaves
  // it waiting in the window (never a rejection). Logs ids only.
  helpers?.onChange((change) => {
    if (change.action !== "plan" || change.status !== "awaiting") return;
    const job = helpers.get(change.job);
    if (!job?.planSummary) return;
    const name = helpers.soul(job.helper).name;
    const ask = () =>
      void computer
        .approve({ summary: `${name}'s plan: ${job.planSummary}`, reason: "Allow starts the work. Decline leaves the plan waiting in the ATOM window." })
        .then((ok) => {
          log.info("plan.answer", { helper: job.helper, job: job.id, approved: ok });
          if (!ok) return;
          try {
            helpers.approvePlan(job.id);
          } catch {
            // answered in the window meanwhile
          }
        });
    for (const listener of goalLineListeners) listener(`${name} has a plan ready for your OK.`, ask);
  });
  const stopGoals =
    helpers &&
    watchGoals({
      store: helpers,
      write: async (system, input) =>
        (
          await model.complete({
            system,
            messages: [{ role: "user", content: input }],
            context: { requestId: `goal-${Date.now()}`, sessionId: "goals", source: "text", receivedAt: new Date() },
          })
        ).text,
      onEnded: ({ goal, tasks, line }) => {
        log.info("goal.ended", { goal, tasks, spoken: Boolean(line) });
        if (line) for (const listener of goalLineListeners) listener(line);
      },
      onFallback: (e) => log.warn("goal.report_fallback", e),
    });
  // ADR-109: a finished goal's result comes back into the chat that asked (a window chat), as one typed assistant turn.
  const stopGoalPosts =
    helpers &&
    memory &&
    startGoalPosts({
      helpers,
      chats: memory.chats,
      currentChat: () => core.sessionId,
      resume: (id, turns) => core.resume(id, turns),
      posted: (chatId) => {
        for (const listener of postedListeners) listener(chatId);
        for (const listener of chatListeners) listener();
      },
      log,
    });
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
      held,
      approvals: computer,
      describe,
      ...(steering ? { steering } : {}),
    });
  }
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
          held,
          approvals: computer,
          describe,
        });
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
            ...islandHelpers(helpers, installedApps, planModels, held, () => listSkills(userSkillsDir(), skillsDir, new Set(helpers.skillHubInstalled().map((i) => i.name)))),
            hub: createHubCommands({ store: helpers, log }), // B3.5
            openReport,
            ...(steering ? { steer: steering.steer, interrupt: steering.interrupt } : {}),
            // ADR-098 item 8: "Run tests" on a pending soul proposal or skill edit.
            runTests: (kind: TestKind, id: number) => runTests(kind, id, AbortSignal.timeout(JOB_TIME_LIMIT_MS)),
            // ADR-098 item 7: the Codex switch, and whether Codex is found and signed in (the switch shows only then).
            codex: () => ({ codexFallback: helpers.codexFallback(), codexReady: codexReady && Boolean(keys.codex) }),
            setCodexFallback: (on: boolean) => {
              helpers.setCodexFallback(on);
              if (on) checkCodex();
            },
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
      stopGoals?.();
      stopGoalPosts?.();
      runner?.close();
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
