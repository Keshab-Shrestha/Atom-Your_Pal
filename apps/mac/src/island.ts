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
  type MemoryItem,
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
      case "quit":
        quit();
        return;
    }
  }

  function sendMemory() {
    const memory = options.memory;
    send(
      memory
        ? { type: "memory", enabled: true, count: memory.count(), memories: memory.list(), episodes: memory.episodes() }
        : { type: "memory", enabled: false, count: 0, memories: [], episodes: [] },
    );
  }
  let memoryWatched = false;

  // ADR-061: a timer ended. Shown at once; spoken now if ZENO is idle, else as soon as it is.
  const timerQueue: { id: number; label: string; message: string }[] = [];
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
        const timer = timerQueue.shift()!;
        await options.chime?.();
        send({ type: "state", state: "speaking" });
        try {
          await tts.speak(timer.message);
        } catch (error) {
          options.log?.warn("timer.speak_failed", { message: describe(error) });
        }
        if (loop.state === "idle") send({ type: "state", state: "idle" });
        // Last, so the island's "Timer done" stays up after the speaking ends.
        send({ type: "timer", ...timer });
      }
    } finally {
      announcing = false;
    }
  }
  const stopTimers = options.onTimer?.((timer) => {
    const message = timer.label ? `Your ${timer.label} timer is done.` : `Your ${spokenDuration(timer.seconds)} timer is done.`;
    timerQueue.push({ id: timer.id, label: timer.label, message });
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
    stopPlanUsage?.();
    stopTimers?.();
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
