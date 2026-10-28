import type { ZenoInput } from "@atom/contracts";
import { peakLevel, type AudioClip, type AudioError, type Recording } from "./audio.ts";
import type { SpeechToText } from "./stt.ts";
import type { SpeakHooks, TextToSpeech } from "./tts.ts";

/** The parts of ATOM Core the voice loop uses. */
export interface CoreLike {
  handle(input: ZenoInput, signal?: AbortSignal, hooks?: { onText?: (delta: string) => void }): Promise<{ text: string; requestId?: string }>;
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
  /** From Core dispatch to the first nonempty text chunk (or completed reply for a nonstreaming provider). */
  firstText?: number;
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
  /** ADR-106: false (the chat is Quiet) keeps a typed turn's reply silent. Absent: typed replies are spoken. */
  speakTyped?: () => boolean;
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
  ask(text: string, delivery?: Pick<ZenoInput, "deliveryId" | "deliveryChat">): void;
  /** Abandons the current turn (recording, request or speech) and returns to idle. */
  cancel(): void;
}

/**
 * Connects Microphone → Whisper → ATOM Core → (LLM Gateway → remote LLM) → TTS → speaker.
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
    speakTyped,
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
    delivery?: Pick<ZenoInput, "deliveryId" | "deliveryChat">,
  ) {
    setState("thinking");
    const started = now();
    // ADR-065: speech starts on the reply's first sentence while the model is still writing the rest.
    const queue = textQueue();
    const endQueue = () => queue.end();
    signal.addEventListener("abort", endQueue, { once: true });
    let firstSound: number | undefined;
    let firstText: number | undefined;
    const silent = source === "text" && speakTyped?.() === false;
    const speakStream = silent
      ? async (pieces: AsyncIterable<string>) => {
          for await (const _ of pieces); // drain: the reply only shows
        }
      : tts.speakStream?.bind(tts) ??
      (async (pieces: AsyncIterable<string>, s?: AbortSignal, hooks?: SpeakHooks) => {
        let all = "";
        for await (const piece of pieces) all += piece; // cannot stream: wait for the whole reply
        if (!all.trim()) return;
        setState("speaking"); // as before streaming: speaking from the moment the whole reply is handed over
        await tts.speak(all, s, hooks);
      });
    const speaking = speakStream(queue.pieces, signal, {
      onStart: () => {
        firstSound = now() - started;
        setState("speaking");
      },
    });
    speaking.catch(() => {}); // awaited below; a failure before then must not go unhandled
    try {
      let answer;
      try {
        answer = await core.handle({ text, source, ...delivery }, signal, { onText: (delta) => {
          if (delta.length && firstText === undefined) firstText = now() - started;
          queue.push(delta);
        } });
      } catch (error) {
        queue.end();
        await speaking.catch(() => {});
        throw error;
      }
      const model = now() - started;
      if (firstText === undefined && answer.text.length) firstText = model;
      if (signal.aborted) return;
      if (!queue.received) queue.push(answer.text); // a model that cannot stream: speak the whole reply now
      queue.end();
      events.onReply?.(answer.text);

      onStage("speech");
      await speaking;
      if (signal.aborted) return;
      events.onTurnComplete?.({ requestId: answer.requestId, ...heard, model, firstSound, firstText });
    } finally {
      signal.removeEventListener("abort", endQueue);
    }
  }

  async function typed(text: string, delivery?: Pick<ZenoInput, "deliveryId" | "deliveryChat">) {
    const controller = new AbortController();
    turn = controller;
    const { signal } = controller;
    let stage: LoopStage = "model";
    try {
      events.onTranscript?.(text);
      await reply(text, "text", signal, { speechMs: 0, transcription: 0 }, (s) => (stage = s), delivery);
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
    ask(text: string, delivery?: Pick<ZenoInput, "deliveryId" | "deliveryChat">) {
      const clean = text.trim();
      if (!clean) return;
      abandonTurn(); // typing over ATOM, like talking over it, starts a new turn
      void typed(clean, delivery);
    },
    press() {
      if (state === "listening" && recording) {
        const current = recording;
        recording = null;
        clearTimeout(silenceTimer);
        void answer(current, micReady);
        return;
      }
      // Idle, or interrupting a turn in progress: talking over ATOM starts a new turn.
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

/** Text pieces handed from the model to speech as they arrive (ADR-065). */
function textQueue() {
  const items: string[] = [];
  let done = false;
  let received = false;
  let wake: (() => void) | null = null;
  return {
    get received() {
      return received;
    },
    push(text: string) {
      if (done || !text) return;
      if (text.trim()) received = true;
      items.push(text);
      wake?.();
    },
    end() {
      done = true;
      wake?.();
    },
    pieces: (async function* () {
      for (;;) {
        if (items.length) {
          yield items.shift()!;
          continue;
        }
        if (done) return;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
    })(),
  };
}
