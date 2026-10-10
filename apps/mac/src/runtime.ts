// The parts of the Mac runtime shared by both interfaces (terminal and island):
// Microphone → Whisper → ZENO Core → LLM Gateway → provider → Kokoro → speaker.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCore, CoreError, type Core } from "@zeno/core";
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
} from "@zeno/tool-engine";
import { createGateway, createProviderAdapter, createSwitchableModel, GatewayError, runPlan, runResearch, type PlanUsage } from "@zeno/llm-gateway";
import { CLAUDE_PLAN, createLogger, type Config, type LlmChoice, type Logger, type ProviderKeys } from "@zeno/shared";
import {
  createEpisodeRecorder,
  createMemoryTools,
  DEFAULT_MAX_EPISODES,
  DEFAULT_MAX_MEMORIES,
  episodeContext,
  MEMORY_GUIDANCE,
  memoryContext,
  openMemoryStore,
  type EpisodeRecorder,
  type MemoryStore,
} from "@zeno/memory";
import {
  briefFor,
  chooseJobModel,
  createDelegateTool,
  createScheduleTool,
  createWorkerShortcut,
  holdFor,
  followUpBrief,
  handOffTool,
  teamContext,
  watchGoals,
  findHelper,
  instructionsFor,
  openHelperStore,
  startJobRunner,
  tieredModels,
  withRoleNotice,
  type HelperStore,
  type Job,
  type JobRun,
  type JobRunner,
} from "@zeno/helpers";
import { createLayaEngine } from "@zeno/decision-engine";
import type { InputSource, Message } from "@zeno/contracts";
import type { IslandHelpers, IslandMemory } from "./island.ts";
import { islandHelpers } from "./island-helpers.ts";
import { createWindowPointer, type WindowPointer } from "./screen-context.ts";
import { withPointing } from "./pointing.ts";
import { AudioError, defaultInputDevice, startRecording } from "./audio.ts";
import { SttError, createWhisperStt, type SpeechToText } from "./stt.ts";
import { createModelSettings, writeSavedChoice, type ModelSettings } from "./model-settings.ts";
import { TtsError, createKokoroSynthesizer, createSpeaker, type TextToSpeech } from "./tts.ts";
import type { VoiceLoopEvents, VoiceLoopOptions } from "./voice-loop.ts";

/** One request on the plan provider can take several tool turns, each a model call; this is its whole-request limit. */
const PLAN_TIMEOUT_MS = 120_000;

/** Points around a spot from a screenshot marker (ADR-080), about the size of a menu-bar icon. */
const POINT_BOX = 20;

/** Claude Code's own web search on the Claude plan (ADR-069): not a ZENO tool, so listed here (ADR-076). */
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
  /** Computer control's link to the island (steps and approvals). Used only when ZENO_COMPUTER=1. */
  computer: ComputerBridge;
  /** What the user asked ZENO to keep (ADR-058). Undefined when ZENO_MEMORY=0 or the store could not open. */
  memory?: MemoryStore;
  /** The memory as Settings sees it (list, forget, clear, change updates). Undefined when memory is off. */
  islandMemory?: IslandMemory;
  /** Helpers' apps, jobs and reports (ADR-081). Undefined when the store could not open. */
  helpers?: HelperStore;
  /** The helpers as the Helpers window sees them. Undefined when the store could not open. */
  islandHelpers?: IslandHelpers;
  /** Wisp dropped on a window (ADR-074): that app's read, held for the next request only. */
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
   * Called with a line to say when a goal Wisp handed out has ended (Task 3.5), or a plan waits for Keshab (Task 3.8,
   * then `after` asks on Wisp's approval card). Returns a function that stops listening.
   */
  onGoalLine(listener: (line: string, after?: () => void) => void): () => void;
  /** Shutdown: stops running helper jobs (they are marked failed at the next start) and Laya's server. */
  close(): void;
}

export interface RuntimeOptions {
  /** Every provider key in .env, so the model can be switched to any of them. Default: the configured one only. */
  keys?: ProviderKeys;
  /** Where a model switch is saved (config/island.json). */
  settingsPath?: string;
  /** The memory file (ADR-058). Default: ZENO_MEMORY_FILE or data/memory.db; ":memory:" for tests. */
  memoryPath?: string;
  /** The helpers file (ADR-081). Default: ZENO_HELPERS_FILE or data/helpers.db; ":memory:" for tests. */
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
  const memory = openMemory(options.memoryPath ?? process.env.ZENO_MEMORY_FILE ?? "data/memory.db", log);
  // The request a memory tool is running for, for provenance. Set by the Core's context hook, which runs first.
  let current: { source: InputSource; requestId?: string } = { source: "voice" };
  const memoryListeners = new Set<() => void>();
  const islandMemory: IslandMemory | undefined = memory && {
    list: () => memory.recent(DEFAULT_MAX_MEMORIES).map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt.toISOString(), source: m.source })),
    count: () => memory.count(),
    forget: (id) => memory.remove(id),
    clear: () => memory.clear(),
    episodes: () => memory.episodes(DEFAULT_MAX_EPISODES).map((e) => ({ id: e.id, summary: e.summary, endedAt: e.endedAt.toISOString(), exchanges: e.exchanges })),
    forgetEpisode: (id) => memory.removeEpisode(id),
    clearEpisodes: () => memory.clearEpisodes(),
    onChange: (listener) => {
      memoryListeners.add(listener);
      return () => memoryListeners.delete(listener);
    },
  };
  const helpers = openHelpers(options.helpersPath ?? process.env.ZENO_HELPERS_FILE ?? "data/helpers.db", log);
  const timerListeners = new Set<(timer: TimerInfo) => void>();
  const timers = createTimers({
    onFire: (timer) => {
      log.info("timer.fired", { id: timer.id, seconds: timer.seconds });
      for (const listener of timerListeners) listener(timer);
    },
  });
  // ADR-062: Open-Meteo, no key. ZENO_WEATHER=0 turns it off; ZENO_HOME sets "here" (default: the time zone's city).
  // Home's forecast is fetched at start and every 30 minutes, so "what's the weather" needs no network wait.
  const weather = process.env.ZENO_WEATHER === "0" ? undefined : weatherTool(process.env.ZENO_HOME ? { home: () => process.env.ZENO_HOME! } : {});
  if (weather) {
    void weather.warm();
    setInterval(() => void weather.warm(), 30 * 60_000).unref();
  }
  // ADR-074: off with the front window tool (ZENO_FRONT_WINDOW=0), whose limits it shares.
  const screen = createWindowPointer({ enabled: process.env.ZENO_FRONT_WINDOW !== "0", log });
  // ADR-080: the screenshot the model was given this turn, so the reply's [POINT:…] marker can be checked against it.
  const computerOn = process.env.ZENO_COMPUTER === "1";
  let lastShot: ScreenShot | undefined;
  const cua = computerOn ? createCuaTransport() : undefined;
  const calendarHelper = findCalendarHelper();
  log.info("calendar.helper", { available: Boolean(calendarHelper) });
  // The tools ZENO can use. Built before the model because "Claude (my plan)" runs the tool loop itself and
  // needs them; the other providers get them from the Core.
  const tools = [
    timeTool(),
    // ADR-066: open apps and web pages. Always on: no screen access, no clicks. ZENO_APPS=0 turns it off.
    ...(process.env.ZENO_APPS === "0" ? [] : createAppTools()),
    // ADR-068: music (Spotify or Music) and the Mac's volume. ZENO_MEDIA=0 turns it off.
    ...(process.env.ZENO_MEDIA === "0" ? [] : createMediaTools()),
    // Task 2.x: open ZENO's Settings and press the play/pause key, both done by the island.
    ...createIslandTools({ openSettings: () => computer.openSettings(), playPause: () => computer.playPause() }),
    // ADR-070: "take a note" into Apple Notes (adding only). ZENO_NOTES=0 turns it off.
    ...(process.env.ZENO_NOTES === "0" ? [] : createNoteTools()),
    // ADR-072: the app in front and, in Chrome/Arc/Edge/Brave, the tab title and address. Read-only, on request.
    // Logs the bundle id and field names only. ZENO_FRONT_WINDOW=0 turns it off.
    ...(process.env.ZENO_FRONT_WINDOW === "0" ? [] : [createFrontWindowTool({ onRead: (e) => log.info("front_window.read", { ...e, fields: e.fields.join(",") }) })]),
    ...timers.tools,
    // ADR-062: Open-Meteo, no key. ZENO_WEATHER=0 turns it off; ZENO_HOME sets "here" (default: the time zone's city).
    ...(weather ? [weather] : []),
    // ADR-060: Calendar and Reminders when the helper is there (inside ZENO.app). ZENO_CALENDAR=0 turns it off.
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
    // ADR-054: off unless ZENO_COMPUTER=1. Steps and approvals go through the bridge to the island;
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
    // ADR-082/087, Task 3.5: Wisp hands work to the team. Logs the goal id and task count only.
    ...(helpers ? [createDelegateTool({ store: helpers, onDelegated: (e) => log.info("goal.delegated", e) })] : []),
    // Task 3.9: routines by voice in any wording. Logs the routine id and worker only.
    ...(helpers ? [createScheduleTool({ store: helpers, onScheduled: (e) => log.info("routine.scheduled", e) })] : []),
  ];
  const toolEngine = createToolEngine({ tools, onCall: (e) => log.info("tool.call", e) });
  const planUsageListeners = new Set<(usage: PlanUsage) => void>();
  // Plan use goes in the log so it is visible how much of the plan a day of ZENO takes. No keys, no text.
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
  const createModel = (choice: LlmChoice, apiKey: string) =>
    createGateway({
      provider: createProviderAdapter({
        ...choice,
        apiKey,
        tools: toolEngine,
        onUsage: reportUsage,
      }),
      // Claude Code starts its own process and may take several tool turns, so it gets longer than one API call.
      timeoutMs: choice.provider === "claude-plan" ? Math.max(config.llm.timeoutMs, PLAN_TIMEOUT_MS) : config.llm.timeoutMs,
    });
  const initial = { provider: config.llm.provider, model: config.llm.model };
  const model = createSwitchableModel(createModel(initial, config.llm.apiKey));
  // ADR-059: a short summary of each conversation, written in the background with the same model (no tools).
  const episodes: EpisodeRecorder | undefined =
    memory && process.env.ZENO_EPISODES !== "0"
      ? createEpisodeRecorder({
          store: memory,
          model,
          onSaved: (e) => {
            log.info("episode.saved", e);
            for (const listener of memoryListeners) listener();
          },
          onError: (error) => log.warn("episode.failed", { ...errorFields(error) }),
        })
      : undefined;
  // ADR-071: plain commands run in code, before any model. ZENO_SHORTCUTS=0 turns these off. Logs the name only.
  const toolShortcuts =
    process.env.ZENO_SHORTCUTS === "0"
      ? undefined
      : createShortcuts({
          tools: toolEngine,
          apps: installedApps,
          onHit: (e) => log.info("shortcut.hit", e),
          onFallback: (e) => log.info("shortcut.fallback", e),
        });
  // ADR-081, Task 3.5: "Sid, …" goes straight to that worker, in code. Logs the worker and action only.
  const workerShortcut = helpers && createWorkerShortcut(helpers, (e) => log.info("worker.command", e));
  const shortcuts =
    toolShortcuts || workerShortcut
      ? async (text: string, signal?: AbortSignal) => workerShortcut?.(text) ?? toolShortcuts?.(text, signal)
      : undefined;
  // ZENO_VOICE_ONLY=1: test speech in and out without the AI. ZENO reads back what Whisper heard, and no
  // request is made to any model. (Typed as `Core` so every caller treats it the same.)
  const baseCore: Core = process.env.ZENO_VOICE_ONLY === "1" ? createEchoCore() : createCore({
        model,
        tools: toolEngine,
        context: (input, context) => {
          current = { source: input.source, requestId: context.requestId };
          const pointed = screen.take(); // ADR-074: the window Wisp was dropped on, for this request only
          const team = helpers ? teamContext(helpers.list()) : undefined; // Task 3.5: who Wisp can delegate to
          if (!memory) return [nowLine(), team, pointed].filter(Boolean).join("\n\n");
          const facts = memoryContext(input.text, { store: memory });
          const past = episodes ? episodeContext(memory, context.sessionId) : undefined;
          log.debug("memory.context", {
            requestId: context.requestId,
            kept: memory.count(),
            used: facts ? facts.split("\n").length - 1 : 0,
            episodes: past ? past.split("\n").length - 1 : 0,
          });
          return [nowLine(), team, MEMORY_GUIDANCE, facts, past, pointed].filter(Boolean).join("\n\n");
        },
        ...(shortcuts ? { shortcuts } : {}),
        ...(episodes ? { onExchange: (sessionId: string, turns: readonly Message[]) => episodes.update(sessionId, turns) } : {}),
      });
  // ADR-080: with computer control on, replies lose their [POINT:…] marker before speech, and a valid one points.
  const core: Core = computerOn
    ? withPointing(baseCore, {
        takeShot: () => {
          const shot = lastShot;
          lastShot = undefined;
          return shot;
        },
        // A box around the spot, so Wisp stands on it as it does on an element (computer.point wants w and h above 0).
        point: (t) => void computer.point({ x: t.x - POINT_BOX / 2, y: t.y - POINT_BOX / 2, w: POINT_BOX, h: POINT_BOX, label: t.label }),
        log: (e) => log.info("pointing.marker", e),
      })
    : baseCore;
  // ADR-064: start the model up now (the Claude plan pre-starts Claude Code), and again after a model switch.
  core.prepare();
  const settingsPath = options.settingsPath;
  const keys = { ...options.keys, [config.llm.provider]: config.llm.apiKey };
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
  });
  // ADR-083: Laya rates each job's difficulty. Its server starts on the first job, stays warm, and stops in close().
  // ZENO_LAYA=0 turns it off (every job then gets the role's default tier).
  const decisions = createLayaEngine({ log });
  /** The Claude plan's models for worker jobs, by tier; empty on any other provider. */
  const planModels = () =>
    settings.current().provider === CLAUDE_PLAN ? tieredModels(settings.info().providers.find((p) => p.id === CLAUDE_PLAN)?.models ?? []) : [];
  // ADR-081/082, Task 3.2: helper jobs run beside the Core, on the Claude plan in use at the time each job starts.
  const runJob: JobRun = async (job, { signal, onStep }) => {
    const { provider, model: current } = settings.current();
    const helper = findHelper(job.helper);
    // ADR-082, Task 3.3: the soul is read when the job starts, so an edit applies from the next job.
    const soul = helpers?.soul(job.helper) ?? helper?.soul;
    const name = soul?.name ?? job.helper;
    const role = helper?.role ?? "";
    if (provider !== CLAUDE_PLAN) throw new Error(`${name} needs the Claude plan for research.`);
    // ADR-083: pin, else Laya; then the role's floor and the large-model switch. Stored first so the window shows it.
    const pick = await chooseJobModel({
      engine: decisions,
      task: job.task,
      role,
      pinnedModel: helpers?.list().find((h) => h.id === job.helper)?.pinnedModel,
      allowLarge: helpers?.allowLarge() ?? true,
      models: planModels(),
    });
    const model = pick.model ?? current;
    helpers?.setModel(job.id, model, pick.reason);
    // Never the task text.
    log.info("job.model", {
      helper: job.helper,
      job: job.id,
      model,
      tier: pick.tier,
      ...(pick.score !== undefined ? { score: Math.round(pick.score * 100) / 100 } : {}),
      source: pick.source,
    });
    if (!soul) throw new Error(`There is no worker called ${job.helper}.`);
    const instructions = instructionsFor(soul, role);
    // ADR-087: the task with its goal, Keshab's notes and the reports of the tasks it waited for.
    const fresh = () => briefFor(job.task, helpers?.context(job.id) ?? { comments: [], earlier: [] });
    // Task 3.10: a top-level task may hand sub-tasks to the workers its role allows; the store checks each one.
    const handOff = helpers && handOffTool(helpers, job);
    const research = (task: string, resume?: string) =>
      runResearch({
        claudePath: keys["claude-plan"] ?? "",
        model,
        task,
        instructions,
        signal,
        onStep,
        onUsage: reportUsage,
        ...(resume ? { resume } : {}),
        ...(handOff ? { handOff } : {}),
      });
    // Task 3.8: a plan-first task's first run only plans (no tools); the plan then waits for Keshab.
    if (job.planFirst && job.planStatus !== "approved") {
      const { plan, costUsd } = await runPlan({ claudePath: keys["claude-plan"] ?? "", model, task: fresh(), instructions, signal, onStep, onUsage: reportUsage });
      if (costUsd) helpers?.addSpend(job.id, costUsd);
      return { plan };
    }
    // Task 3.6: asked again, the run continues its last session with only what is new. A session Claude Code no
    // longer has (or any other failure to resume, except the plan's limits) falls back to one fresh run.
    const resume = helpers?.resumeOf(job.id);
    let result;
    try {
      result = await research(resume ? followUpBrief(resume.notes, helpers?.handOffs(job.id)) : fresh(), resume?.sessionId);
    } catch (error) {
      const kind = error instanceof GatewayError || (error instanceof Error && "kind" in error) ? (error as { kind?: string }).kind : undefined;
      if (!resume || signal.aborted || kind === "rate_limit" || kind === "auth" || kind === "cancelled") throw error;
      log.warn("job.resume_failed", { helper: job.helper, job: job.id, kind });
      result = await research(fresh());
    }
    if (result.sessionId) helpers?.setSession(job.id, result.sessionId);
    if (result.costUsd) helpers?.addSpend(job.id, result.costUsd); // Task 3.7: counts toward the day's budgets
    log.info("job.session", { helper: job.helper, job: job.id, resumed: Boolean(resume) });
    return { ...result, report: withRoleNotice(role, result.report) };
  };
  // Logs ids, states, timings and page counts only: never the task, report or addresses.
  // Task 3.7: a task waits while its worker's or the team's budget is used up, or the plan is above its limit.
  const held = (job: Job) => (helpers ? holdFor(job, helpers.budgets(), helpers.soul(job.helper).name, planUsed) : undefined);
  const runner: JobRunner | undefined =
    helpers && startJobRunner({ store: helpers, run: runJob, onRun: (e) => log.info("job.run", e), mayStart: (job) => !held(job) });
  // A new day (budgets) or an older plan window (its use falls) frees held tasks without any change in the store.
  if (runner) setInterval(() => runner.poke(), 60_000).unref();
  // Task 3.9: routines come due on the clock. At start, one catch-up for each that came due while ZENO was closed.
  if (helpers) {
    const runRoutines = () => {
      try {
        helpers.runRoutines();
      } catch (error) {
        log.warn("routines.failed", { ...errorFields(error) });
      }
    };
    runRoutines();
    setInterval(runRoutines, 30_000).unref();
  }
  // Task 3.5: a goal whose tasks have all ended gets its combined report (one model call, no tools) and one line.
  const goalLineListeners = new Set<(line: string, after?: () => void) => void>();
  // Task 3.8: a plan waits for Keshab: one line, then Wisp's approval card. Allow approves; Decline or no answer leaves
  // it waiting in the window (never a rejection). Logs ids only.
  helpers?.onChange((change) => {
    if (change.action !== "plan" || change.status !== "awaiting") return;
    const job = helpers.get(change.job);
    if (!job?.planSummary) return;
    const name = helpers.soul(job.helper).name;
    const ask = () =>
      void computer
        .approve({ summary: `${name}'s plan: ${job.planSummary}`, reason: "Allow starts the work. Decline leaves the plan waiting in the Helpers window." })
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
  const tts = createSpeaker(createKokoroSynthesizer({ voice: config.tts.voice, dtype: config.tts.dtype }));
  return {
    config,
    log,
    core,
    settings,
    stt,
    tts,
    computer,
    ...(memory ? { memory, islandMemory } : {}),
    ...(helpers ? { helpers, islandHelpers: warmOnOpen(islandHelpers(helpers, installedApps, planModels, held), decisions) } : {}),
    screen,
    timers,
    onTimer(listener) {
      timerListeners.add(listener);
      return () => timerListeners.delete(listener);
    },
    capabilities: () =>
      capabilityItems(settings.info().provider === "claude-plan" && process.env.ZENO_WEB !== "0" ? [...tools, { capability: WEB_SEARCH }] : tools),
    onPlanUsage(listener) {
      planUsageListeners.add(listener);
      return () => planUsageListeners.delete(listener);
    },
    onGoalLine(listener) {
      goalLineListeners.add(listener);
      return () => goalLineListeners.delete(listener);
    },
    close: () => {
      stopGoals?.();
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

/** Opens the memory store, or returns undefined (memory off, or the file cannot be opened: ZENO still runs). */
function openMemory(path: string, log: Logger): MemoryStore | undefined {
  if (process.env.ZENO_MEMORY === "0") return undefined;
  try {
    const store = openMemoryStore({ path });
    log.info("memory.open", { kept: store.count() });
    return store;
  } catch (error) {
    log.error("memory.unavailable", { ...errorFields(error) });
    return undefined;
  }
}

/**
 * Opens the helper store (ADR-081), or returns undefined if the file cannot be opened (ZENO still runs; the
 * island is told there are no helpers). Every change is logged by ids, state and timing only, never task or report text.
 */
function openHelpers(path: string, log: Logger): HelperStore | undefined {
  try {
    const store = openHelperStore({ path });
    store.onChange((change) => log.info("helpers.change", change));
    log.info("helpers.open");
    return store;
  } catch (error) {
    log.error("helpers.unavailable", { ...errorFields(error) });
    return undefined;
  }
}

/** Machine-readable error details for the log (messages are already free of credentials). */
export function errorFields(error: unknown) {
  return {
    error: error instanceof Error ? error.name : typeof error,
    kind: error instanceof GatewayError ? error.kind : undefined,
    retryable: error instanceof GatewayError ? error.retryable : undefined,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** A plain-language description of an error for the user. */
export function describe(error: unknown): string {
  if (error instanceof GatewayError) return `${error.message}${error.retryable ? " (try again in a moment)" : ""}`;
  if (error instanceof AudioError || error instanceof SttError || error instanceof TtsError || error instanceof CoreError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Adds operational logging to an interface's voice-loop events. The log records timings, stages and
 * error kinds, never what was said or replied (SECURITY.md).
 */
export function withLogging(log: Logger, micName: () => Promise<string>, events: VoiceLoopEvents): VoiceLoopEvents {
  return {
    ...events,
    onMicSilent: () => {
      void micName().then((microphone) => log.warn("mic.silent", { microphone }));
      events.onMicSilent?.();
    },
    onTurnComplete: (t) => {
      log.info("turn.complete", {
        requestId: t.requestId,
        speechMs: t.speechMs,
        transcriptionMs: t.transcription,
        modelMs: t.model,
        firstSoundMs: t.firstSound,
      });
      events.onTurnComplete?.(t);
    },
    onNotice: (notice) => {
      log.info("turn.skipped", { reason: notice.kind, loudest: notice.kind === "no_speech" ? notice.loudest : undefined });
      events.onNotice?.(notice);
    },
    onError: (stage, error) => {
      log.error("turn.failed", { stage, ...errorFields(error) });
      events.onError?.(stage, error);
    },
  };
}

/** A stand-in for ZENO Core that replies with the words it was given, for testing the voice parts alone. */
function createEchoCore(): Core {
  return {
    async handle(input: { text: string }) {
      return { text: `I heard: ${input.text}`, requestId: "voice-only" };
    },
    prepare() {},
  } as unknown as Core;
}

/** The Calendar and Reminders helper: the one the island passes, else a development build. */
function findCalendarHelper(): string | undefined {
  if (process.env.ZENO_CALENDAR === "0") return undefined;
  const candidates = [
    process.env.ZENO_CALENDAR_HELPER,
    fileURLToPath(new URL("../island/build/ZENO.app/Contents/MacOS/zeno-calendar", import.meta.url)),
  ];
  return candidates.find((p): p is string => Boolean(p) && existsSync(p!));
}

/** The date, time and zone, so the model can turn "tomorrow at 3" into a real time for the calendar tools. */
export function nowLine(now = new Date()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const minutes = -now.getTimezoneOffset();
  const offset = `${minutes >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
  const text = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short" }).format(now);
  return `It is now ${text} (${zone}, UTC${offset}).`;
}

/** ADR-083: Laya takes about 5 s to start, so it starts when the Helpers window opens, not on the first job. */
function warmOnOpen(island: IslandHelpers, decisions: { warm(): void }): IslandHelpers {
  return {
    ...island,
    list: () => {
      decisions.warm();
      return island.list();
    },
  };
}
