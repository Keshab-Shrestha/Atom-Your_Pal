import type { AudioClip, AudioError, Recording } from "./audio.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";

/** The parts of ZENO Core the voice loop uses. */
export interface CoreLike {
  handle(input: { text: string; source: "voice" }, signal?: AbortSignal): Promise<{ text: string }>;
}

export type LoopState = "idle" | "listening" | "transcribing" | "thinking" | "speaking";
export type LoopStage = "microphone" | "transcription" | "model" | "speech";

/** Milliseconds spent in each stage of one turn. */
export interface TurnTimings {
  transcription: number;
  model: number;
  /** From the reply arriving until audio started playing. */
  firstSound?: number;
}

export interface VoiceLoopEvents {
  onState?(state: LoopState): void;
  /** The microphone is capturing: speech from now on is recorded. */
  onMicReady?(): void;
  onTranscript?(text: string): void;
  onReply?(text: string): void;
  onTurnComplete?(timings: TurnTimings): void;
  onNotice?(message: string): void;
  onError?(stage: LoopStage, error: unknown): void;
}

export interface VoiceLoopOptions {
  /** Starts the microphone; the loop calls `onReady`/`onFailure` handlers it passes in. */
  record(handlers: { onReady: () => void; onFailure: (error: AudioError) => void }): Recording;
  stt: SpeechToText;
  core: CoreLike;
  tts: TextToSpeech;
  events?: VoiceLoopEvents;
  /** Clips shorter than this are treated as accidental presses. */
  minClipMs?: number;
  now?: () => number;
}

export interface VoiceLoop {
  readonly state: LoopState;
  /**
   * The talk button (Space). Idle: start listening. Listening: stop and answer.
   * Transcribing, thinking or speaking: interrupt and start listening again.
   */
  press(): void;
  /** Abandons the current turn (recording, request or speech) and returns to idle. */
  cancel(): void;
}

/**
 * Connects Microphone → Whisper → ZENO Core → (LLM Gateway → remote LLM) → TTS → speaker.
 * One turn at a time; every turn can be interrupted at any stage.
 */
export function createVoiceLoop(options: VoiceLoopOptions): VoiceLoop {
  const { record, stt, core, tts, events = {}, minClipMs = 300, now = Date.now } = options;
  let state: LoopState = "idle";
  let recording: Recording | null = null;
  let turn: AbortController | null = null;

  const setState = (next: LoopState) => {
    if (state === next) return;
    state = next;
    events.onState?.(next);
  };

  function startListening() {
    const current = record({
      onReady: () => {
        if (recording === current) events.onMicReady?.();
      },
      onFailure: (error) => {
        if (recording !== current) return;
        recording = null;
        setState("idle");
        events.onError?.("microphone", error);
      },
    });
    recording = current;
    setState("listening");
  }

  function abandonTurn() {
    turn?.abort();
    turn = null;
    if (recording) {
      const stale = recording;
      recording = null;
      stale.stop().catch(() => {}); // release the microphone; the audio is discarded
    }
  }

  async function answer(current: Recording) {
    const controller = new AbortController();
    turn = controller;
    const { signal } = controller;
    let stage: LoopStage = "microphone";
    setState("transcribing");
    try {
      const clip: AudioClip = await current.stop();
      if (signal.aborted) return;
      if (clip.durationMs < minClipMs) {
        events.onNotice?.("Too short. Press Space, speak, then press Space again to send.");
        return;
      }

      stage = "transcription";
      let started = now();
      const text = await stt.transcribe(clip);
      const transcription = now() - started;
      if (signal.aborted) return;
      if (!text) {
        events.onNotice?.("No speech recognized.");
        return;
      }
      events.onTranscript?.(text);

      stage = "model";
      setState("thinking");
      started = now();
      const reply = await core.handle({ text, source: "voice" }, signal);
      const model = now() - started;
      if (signal.aborted) return;
      events.onReply?.(reply.text);

      stage = "speech";
      setState("speaking");
      started = now();
      let firstSound: number | undefined;
      await tts.speak(reply.text, signal, { onStart: () => (firstSound = now() - started) });
      if (signal.aborted) return;
      events.onTurnComplete?.({ transcription, model, firstSound });
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
    press() {
      if (state === "listening" && recording) {
        const current = recording;
        recording = null;
        void answer(current);
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
