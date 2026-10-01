import { peakLevel, type AudioClip, type AudioError, type Recording } from "./audio.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";

/** The parts of ZENO Core the voice loop uses. */
export interface CoreLike {
  handle(input: { text: string; source: "voice" }, signal?: AbortSignal): Promise<{ text: string; requestId?: string }>;
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
  let micReady = false; // the current recording has started capturing
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
      },
      onFailure: (error) => {
        if (recording !== current) return;
        recording = null;
        setState("idle");
        events.onError?.("microphone", error);
      },
    });
    recording = current;
    micReady = false;
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
        if (!signal.aborted) events.onNotice?.(`The microphone was still starting. Wait for "Listening… speak now", then speak.`);
        return;
      }
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
        events.onNotice?.(
          `No speech recognized (loudest sound ${decibels(peakLevel(clip.pcm))}). Speak close to the microphone; ` +
            `if this keeps happening, press d to check which microphone ZENO is using.`,
        );
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
      events.onTurnComplete?.({ requestId: reply.requestId, speechMs: clip.durationMs, transcription, model, firstSound });
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
