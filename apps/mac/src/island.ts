// Island mode (`main.ts --island`): ZENO Island drives the voice loop with JSON-line commands on
// stdin and receives JSON-line events on stdout. Specification: docs/island-protocol.md.

import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Logger } from "@zeno/shared";
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
  type ModelItem,
  type MemoryItem,
  type ReportEvent,
  type SoulItem,
  type ThreadEvent,
} from "./island-protocol.ts";
import type { ComputerBridge } from "./computer-bridge.ts";
import type { WindowPointer } from "./screen-context.ts";
import type { ModelSettings } from "./model-settings.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";
import { spokenDuration, type Capability } from "@zeno/tool-engine";
import { createVoiceLoop, type CoreLike, type LoopNotice, type VoiceLoop, type VoiceLoopEvents, type VoiceLoopOptions } from "./voice-loop.ts";

export interface IslandOptions {
  /** Commands from the island, one JSON object per line. */
  input: Readable;
  /** Writes one encoded event line to the island. */
  write(line: string): void;
  record: VoiceLoopOptions["record"];
  stt: SpeechToText;
  core: CoreLike & { reset(): void };
  tts: TextToSpeech;
  /** Reported in the `ready` event. */
  info: { provider: string; model: string; microphone: string };
  /** The AI model choice: sent as `info` after `ready`, changed by `model.set`. Without it, `model.set` is refused. */
  settings?: Pick<ModelSettings, "info" | "setModel">;
  /** Computer control (ADR-054): shows what ZENO is doing and asks before risky actions. Absent when it is off. */
  computer?: Pick<ComputerBridge, "attach" | "answer" | "cancelAll">;
  /** What ZENO keeps (ADR-058), for Settings. Absent when memory is off: `memory.*` answers `enabled: false`. */
  memory?: IslandMemory;
  /** Helpers and their jobs (ADR-081). Absent when their file could not be opened: no helpers are listed. */
  helpers?: IslandHelpers;
  /** Wisp dropped on a window (ADR-074): reads that app once for the next request. Absent: `context.window` is refused. */
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
  /** Goals Wisp handed out (Task 3.5) and plans waiting (Task 3.8): a line to say when idle, then `after`. */
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
  /** Called after ZENO keeps or forgets something by itself (the remember / forget tools). Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
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
  /** Task 3.14: opens a task's report in its worker's app. Absent: `job.open` is refused. Rejects with words for the user. */
  openReport?(id: number): Promise<string>;
  /** Task 3.13: rate a finished task ("not good" asks Tinker to review it); answer Tinker's proposals. Each throws with words for the user. */
  rate(id: number, good: boolean, comment?: string): void;
  acceptProposal(id: number): void;
  rejectProposal(id: number): void;
  undoProposal(id: number): void;
  /** Task 3.12: Keshab's skills, and a worker's choice of them. Throws, with words for the user, for an unknown skill. */
  skills(): { name: string; description: string }[];
  setSkills(helper: string, skills: string[]): void;
  /** Task 3.11: grants a folder. Throws, with words for the user, for a folder that cannot be granted. */
  addGrant(helper: string, path: string): void;
  removeGrant(helper: string, path: string): boolean;
  /** Task 3.9: removes a routine. False when there is none. */
  removeRoutine(id: number): boolean;
  /** Changes what a queued task waits for (ADR-087). Throws, with words for the user, for a started task or a circle. */
  setBlockers(id: number, blockedBy: number[]): void;
  /** Adds Keshab's note to a task, which wakes it (Task 3.6). Throws, with words for the user, for an unknown task or an empty or long note. */
  addComment(id: number, text: string): void;
  /** Forgets a task's session; an ended task runs again, fresh (Task 3.6). Throws, with words for the user, for a running task. */
  startFresh(id: number): void;
  /** A task's thread, or undefined for an unknown task. */
  thread(id: number): Omit<ThreadEvent, "type"> | undefined;
  /** Pins a helper to an offered model ("" unpins). Throws, with words for the user, for an unknown helper or model. */
  pin(helper: string, model: string): void;
  /** Saves an edited soul as a new version (Task 3.3). Throws, with words for the user, for an unknown helper or a bad soul. */
  saveSoul(helper: string, soul: SoulItem): void;
  /** Makes an older soul version current again, as a new version. Throws, with words for the user, for an unknown one. */
  restoreSoul(helper: string, version: number): void;
  /** Task 3.7: the team's cap and today's spend, and the plan limit. */
  budgets(): { team: { cap: number | null; spent: number }; planLimit: number };
  /** Throws, with words for the user, for an unknown worker or a bad amount. "team" sets the team's cap. */
  setBudget(helper: string, cap: number | null): void;
  /** Throws, with words for the user, outside 10 to 100. */
  setPlanLimit(percent: number): void;
  /** Whether worker jobs may use the large model (ADR-083). */
  allowLarge(): boolean;
  setAllowLarge(allowed: boolean): void;
  /** The plan's models offered to worker jobs; empty when the provider is not the Claude plan. */
  models(): ModelItem[];
  stop(id: number): boolean;
  remove(id: number): boolean;
  report(id: number): Omit<ReportEvent, "type"> | undefined;
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
    core,
    tts,
    silenceWarnMs: options.silenceWarnMs,
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
          requestId: t.requestId,
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
        options.computer?.cancelAll();
        loop.cancel();
        core.reset();
        options.screen?.clear();
        send({ type: "conversation.reset" });
        return;
      case "context.window": {
        const app = command.name;
        const pointed = options.screen?.point(command.bundleId, app) ?? Promise.resolve({ ok: false as const, message: "Reading the screen is turned off." });
        void pointed.then(
          (result) => send({ type: "context.ready", app, ...result }),
          (error: unknown) => send({ type: "context.ready", app, ok: false, message: describe(error) }),
        );
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
        memoryWatched = true; // from now on, changes ZENO makes by itself are sent too
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
      case "helper.planFirst":
        changeHelpers(command.type, (helpers) => helpers.setPlanFirst(command.helper, command.on));
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
          if (command.planLimit !== undefined) helpers.setPlanLimit(command.planLimit);
          if (command.allowLarge !== undefined) helpers.setAllowLarge(command.allowLarge);
        });
        return;
      case "helper.budget":
        changeHelpers(command.type, (helpers) => helpers.setBudget(command.helper, command.cap));
        return;
      case "job.block":
        changeHelpers(command.type, (helpers) => helpers.setBlockers(command.id, command.blockedBy));
        return;
      case "comment.add":
        changeHelpers(command.type, (helpers) => helpers.addComment(command.id, command.text));
        return;
      case "job.fresh":
        changeHelpers(command.type, (helpers) => helpers.startFresh(command.id));
        return;
      case "thread.get": {
        const thread = options.helpers?.thread(command.id);
        if (thread) send({ type: "thread", ...thread });
        else refuseHelpers(command.type, options.helpers ? "That task is gone." : HELPERS_OFF);
        return;
      }
      case "soul.set":
        changeHelpers(command.type, (helpers) => helpers.saveSoul(command.helper, command.soul));
        return;
      case "soul.restore":
        changeHelpers(command.type, (helpers) => helpers.restoreSoul(command.helper, command.version));
        return;
      case "report.get": {
        const report = options.helpers?.report(command.id);
        if (report) send({ type: "report", ...report });
        else refuseHelpers(command.type, options.helpers ? "That job has no report." : HELPERS_OFF);
        return;
      }
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
      send({ type: "helpers", helpers: helpers?.list() ?? [], apps, ...(helpers ? { allowLarge: helpers.allowLarge(), models: helpers.models(), ...helpers.budgets(), skills: helpers.skills() } : {}) });
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
  async function setHelperApp(helper: string, app: string) {
    if (!options.helpers) return refuseHelpers("helper.set", HELPERS_OFF);
    if (app && !(await appNames()).includes(app)) return refuseHelpers("helper.set", "That app is not installed.");
    changeHelpers("helper.set", (helpers) => helpers.setApp(helper, app));
  }
  const stopHelperUpdates = options.helpers?.onChange(() => {
    if (helpersWatched) sendHelpers();
  });

  function sendMemory() {
    const memory = options.memory;
    send(
      memory
        ? { type: "memory", enabled: true, count: memory.count(), memories: memory.list(), episodes: memory.episodes() }
        : { type: "memory", enabled: false, count: 0, memories: [], episodes: [] },
    );
  }
  let memoryWatched = false;

  // ADR-061: a timer ended. Shown at once; spoken now if ZENO is idle, else as soon as it is. Task 3.5: a goal's line
  // waits its turn the same way.
  const timerQueue: { message: string; timer?: { id: number; label: string; message: string }; after?: () => void }[] = [];
  let announcing = false;
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
        await options.chime?.();
        // Task 3.15: Wisp flies over with the line while ZENO says it.
        if (!timer) send({ type: "worker.line", line: message });
        send({ type: "state", state: "speaking" });
        try {
          await tts.speak(message);
        } catch (error) {
          options.log?.warn(timer ? "timer.speak_failed" : "goal.speak_failed", { message: describe(error) });
        }
        if (loop.state === "idle") send({ type: "state", state: "idle" });
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
    });

  return { loop, quit };
}
