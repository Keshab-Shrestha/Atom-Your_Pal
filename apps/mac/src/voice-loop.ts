import { peakLevel, type AudioClip, type AudioError, type Recording } from "./audio.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";

/** The parts of ZENO Core the voice loop uses. */
export interface CoreLike {
  handle(input: { text: string; source: "voice" | "text" }, signal?: AbortSignal): Promise<{ text: string; requestId?: string }>;
}

export type LoopState = "idle" | "listening" | "transcribing" | "thinking" | "speaking";
export type LoopStage = "microphone" | "transcription" | "model" | "speech";

/** Milliseconds spent in each stage of one turn. */
export interface TurnTimings {
  /** The Core's id for this request, to match log lines. */
  requestId?: string;
  /** Length of the recorded speech. */
  speechMs: number;
  transcription: number;
  model: number;
  /** From the reply arriving until audio started playing. */
  firstSound?: number;
}

/**
 * Why a turn ended without a request. Not a failure: each interface words it for its own controls.
 * - `too_short`: the clip was shorter than `minClipMs` (an accidental press)
 * - `mic_starting`: sent before the microphone was capturing, so nothing was recorded
 * - `no_speech`: Whisper heard no words; `loudest` is the peak level heard, e.g. "-38 dB" or "silence"
 */
export type LoopNotice = { kind: "too_short" } | { kind: "mic_starting" } | { kind: "no_speech"; loudest: string };

export interface VoiceLoopEvents {
  onState?(state: LoopState): void;
  /** The microphone is capturing: speech from now on is recorded. */
  onMicReady?(): void;
  onTranscript?(text: string): void;
  onReply?(text: string): void;
  onTurnComplete?(timings: TurnTimings): void;
  onNotice?(notice: LoopNotice): void;
  /** Peak level (0–1) of each chunk of microphone audio, for the current recording only. */
  onLevel?(peak: number): void;
  onError?(stage: LoopStage, error: unknown): void;
  /** The microphone has delivered only near-silence for a while during listening (once per turn). */
  onMicSilent?(): void;
}

export interface VoiceLoopOptions {
  /** Starts the microphone; the loop calls `onReady`/`onFailure` handlers it passes in. */
  record(handlers: { onReady: () => void; onFailure: (error: AudioError) => void; onLevel: (peak: number) => void }): Recording;
  stt: SpeechToText;
  core: CoreLike;
  tts: TextToSpeech;
  events?: VoiceLoopEvents;
  /** Clips shorter than this are treated as accidental presses. */
  minClipMs?: number;
  /** Warn if the microphone stays below `silencePeak` this long after it starts capturing. */
  silenceWarnMs?: number;
  /** Peak level (0–1) below which audio counts as silence: 0.003 ≈ -50 dB, far below speech. */
  silencePeak?: number;
  now?: () => number;
}

export interface VoiceLoop {
  readonly state: LoopState;
  /**
   * The talk button (Space in the terminal). Idle: start listening. Listening: stop and answer.
   * Transcribing, thinking or speaking: interrupt and start listening again.
   */
  press(): void;
  /** A typed request: answered and spoken like a voice turn, without the microphone. */
  ask(text: string): void;
  /** Abandons the current turn (recording, request or speech) and returns to idle. */
  cancel(): void;
}

/**
 * Connects Microphone → Whisper → ZENO Core → (LLM Gateway → remote LLM) → TTS → speaker.
 * One turn at a time; every turn can be interrupted at any stage.
 */
export function createVoiceLoop(options: VoiceLoopOptions): VoiceLoop {
  const {
    record,
    stt,
    core,
    tts,
    events = {},
    minClipMs = 300,
    silenceWarnMs = 2500,
    silencePeak = 0.003,
    now = Date.now,
  } = options;
  let state: LoopState = "idle";
  let recording: Recording | null = null;
  let micReady = false; // the current recording has started capturing
  let loudest = 0; // peak level heard in the current recording
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let turn: AbortController | null = null;

  const setState = (next: LoopState) => {
    if (state === next) return;
    state = next;
    events.onState?.(next);
  };

  function startListening() {
    const current = record({
      onReady: () => {
        if (recording !== current) return;
        micReady = true;
        events.onMicReady?.();
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (recording === current && loudest < silencePeak) events.onMicSilent?.();
        }, silenceWarnMs);
        silenceTimer.unref?.(); // only a warning: never keeps the process alive
      },
      onLevel: (peak) => {
        if (recording !== current) return;
        loudest = Math.max(loudest, peak);
        events.onLevel?.(peak);
      },
      onFailure: (error) => {
        if (recording !== current) return;
        recording = null;
        clearTimeout(silenceTimer);
        setState("idle");
        events.onError?.("microphone", error);
      },
    });
    recording = current;
    micReady = false;
    loudest = 0;
    setState("listening");
  }

  function abandonTurn() {
    clearTimeout(silenceTimer);
    turn?.abort();
    turn = null;
    if (recording) {
      const stale = recording;
      recording = null;
      stale.stop().catch(() => {}); // release the microphone; the audio is discarded
    }
  }

  async function answer(current: Recording, captured: boolean) {
    const controller = new AbortController();
    turn = controller;
    const { signal } = controller;
    let stage: LoopStage = "microphone";
    setState("transcribing");
    try {
      if (!captured) {
        // Sent before the microphone was capturing: nothing was recorded, which is not a fault.
        await current.stop().catch(() => {});
        if (!signal.aborted) events.onNotice?.({ kind: "mic_starting" });
        return;
      }
      const clip: AudioClip = await current.stop();
      if (signal.aborted) return;
      if (clip.durationMs < minClipMs) {
        events.onNotice?.({ kind: "too_short" });
        return;
      }

      stage = "transcription";
      let started = now();
      const text = await stt.transcribe(clip);
      const transcription = now() - started;
      if (signal.aborted) return;
      if (!text) {
        events.onNotice?.({ kind: "no_speech", loudest: decibels(peakLevel(clip.pcm)) });
        return;
      }
      events.onTranscript?.(text);
      stage = "model";
      await reply(text, "voice", signal, { speechMs: clip.durationMs, transcription }, (s) => (stage = s));
    } catch (error) {
      if (!signal.aborted) events.onError?.(stage, error);
    } finally {
      if (turn === controller) {
        turn = null;
        setState("idle");
      }
    }
  }

  /** From the model on: ask, show, speak, report. Shared by voice and typed turns. */
  async function reply(
    text: string,
    source: "voice" | "text",
    signal: AbortSignal,
    heard: { speechMs: number; transcription: number },
    onStage: (stage: LoopStage) => void,
  ) {
    setState("thinking");
    let started = now();
    const answer = await core.handle({ text, source }, signal);
    const model = now() - started;
    if (signal.aborted) return;
    events.onReply?.(answer.text);

    onStage("speech");
    setState("speaking");
    started = now();
    let firstSound: number | undefined;
    await tts.speak(answer.text, signal, { onStart: () => (firstSound = now() - started) });
    if (signal.aborted) return;
    events.onTurnComplete?.({ requestId: answer.requestId, ...heard, model, firstSound });
  }

  async function typed(text: string) {
    const controller = new AbortController();
    turn = controller;
    const { signal } = controller;
    let stage: LoopStage = "model";
    try {
      events.onTranscript?.(text);
      await reply(text, "text", signal, { speechMs: 0, transcription: 0 }, (s) => (stage = s));
    } catch (error) {
      if (!signal.aborted) events.onError?.(stage, error);
    } finally {
      if (turn === controller) {
        turn = null;
        setState("idle");
      }
    }
  }

  return {
    get state() {
      return state;
    },
    ask(text: string) {
      const clean = text.trim();
      if (!clean) return;
      abandonTurn(); // typing over ZENO, like talking over it, starts a new turn
      void typed(clean);
    },
    press() {
      if (state === "listening" && recording) {
        const current = recording;
        recording = null;
        clearTimeout(silenceTimer);
        void answer(current, micReady);
        return;
      }
      // Idle, or interrupting a turn in progress: talking over ZENO starts a new turn.
      abandonTurn();
      startListening();
    },
    cancel() {
      if (state === "idle") return;
      abandonTurn();
      setState("idle");
    },
  };
}

/** Peak level as dBFS for messages: 0 dB is full scale; speech close to a microphone is usually above -20 dB. */
function decibels(peak: number): string {
  return peak <= 0 ? "silence" : `${Math.round(20 * Math.log10(peak))} dB`;
}
