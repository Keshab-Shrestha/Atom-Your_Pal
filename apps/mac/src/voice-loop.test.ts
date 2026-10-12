import { test } from "node:test";
import assert from "node:assert/strict";
import type { AudioClip, AudioError, Recording } from "./audio.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";
import { createVoiceLoop, type CoreLike, type LoopStage, type LoopState } from "./voice-loop.ts";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const clip = (durationMs = 1500): AudioClip => ({ pcm: Buffer.alloc(4), sampleRate: 16_000, durationMs });

/** A deferred promise the test can resolve later, to hold a stage open. */
function gate<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

function harness(
  over: Partial<{ stt: SpeechToText; core: CoreLike; tts: TextToSpeech; clipMs: number; autoReady: boolean; silenceWarnMs: number }> = {},
) {
  const log: string[] = [];
  const states: LoopState[] = [];
  const errors: { stage: LoopStage; error: unknown }[] = [];
  const recordings: { stopped: boolean; fail: (e: AudioError) => void; ready: () => void; level: (peak: number) => void }[] = [];
  const signals: AbortSignal[] = [];

  const stt: SpeechToText = over.stt ?? { transcribe: async () => "what time is it" };
  const core: CoreLike = over.core ?? {
    handle: async (input, signal) => {
      signals.push(signal!);
      return { text: `reply to ${input.text}` };
    },
  };
  const tts: TextToSpeech = over.tts ?? {
    warmUp: async () => {},
    close: () => {},
    speak: async (text, _signal, hooks) => {
      hooks?.onStart?.();
      log.push(`speak:${text}`);
    },
  };

  const loop = createVoiceLoop({
    record: ({ onFailure, onReady, onLevel }) => {
      const r = { stopped: false, fail: onFailure, ready: onReady, level: onLevel };
      recordings.push(r);
      const recording: Recording = {
        stop: async () => {
          r.stopped = true;
          return clip(over.clipMs);
        },
      };
      return recording;
    },
    stt,
    core,
    tts,
    silenceWarnMs: over.silenceWarnMs ?? 60_000, // effectively off unless a test sets it
    events: {
      onMicSilent: () => log.push("mic-silent"),
      onState: (s) => states.push(s),
      onMicReady: () => (over.autoReady === false ? log.push("mic-ready") : undefined),
      onTranscript: (t) => log.push(`you:${t}`),
      onReply: (t) => log.push(`zeno:${t}`),
      onTurnComplete: () => log.push("done"),
      onNotice: (n) => log.push(`notice:${n.kind === "no_speech" ? `no_speech(${n.loudest})` : n.kind}`),
      onLevel: (p) => log.push(`level:${p}`),
      onError: (stage, error) => errors.push({ stage, error }),
    },
  });
  // Real recordings report "ready" once the microphone delivers audio; by default the fake does so
  // right after each press that starts listening, so tests can press-speak-press as a user would.
  const autoReady = over.autoReady ?? true;
  const press = loop.press.bind(loop);
  loop.press = () => {
    const before = recordings.length;
    press();
    if (autoReady && recordings.length > before) recordings.at(-1)!.ready();
  };
  return { loop, log, states, errors, recordings, signals };
}

test("a full turn: listen, transcribe, ask the Core, speak", async () => {
  const h = harness();
  h.loop.press();
  assert.equal(h.loop.state, "listening");
  h.loop.press();
  await tick(5);
  assert.deepEqual(h.log, ["you:what time is it", "zeno:reply to what time is it", "speak:reply to what time is it", "done"]);
  assert.deepEqual(h.states, ["listening", "transcribing", "thinking", "speaking", "idle"]);
  assert.deepEqual(h.errors, []);
  assert.equal(h.recordings[0].stopped, true);
});

test("a very short clip is ignored with a notice", async () => {
  const h = harness({ clipMs: 100 });
  h.loop.press();
  h.loop.press();
  await tick(5);
  assert.deepEqual(h.log, ["notice:too_short"]);
  assert.equal(h.loop.state, "idle");
});

test("silence produces a notice with the level heard, not a request", async () => {
  let asked = false;
  const h = harness({ stt: { transcribe: async () => "" }, core: { handle: async () => ((asked = true), { text: "x" }) } });
  h.loop.press();
  h.loop.press();
  await tick(5);
  assert.deepEqual(h.log, ["notice:no_speech(silence)"]);
  assert.equal(asked, false);
});

test("sending before the microphone has started says to wait, and is not an error", async () => {
  const h = harness({ autoReady: false });
  h.loop.press();
  h.loop.press(); // pressed again before any audio arrived
  await tick(5);
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.log, ["notice:mic_starting"]);
  assert.equal(h.recordings[0].stopped, true); // microphone released
  assert.equal(h.loop.state, "idle");
});

test("pressing while ATOM is thinking cancels the request and starts listening", async () => {
  const pending = gate<{ text: string }>();
  let signal: AbortSignal | undefined;
  const h = harness({
    core: {
      handle: (_input, s) => {
        signal = s;
        s?.addEventListener("abort", () => pending.reject(new Error("cancelled")));
        return pending.promise;
      },
    },
  });
  h.loop.press();
  h.loop.press();
  await tick(5);
  assert.equal(h.loop.state, "thinking");
  h.loop.press(); // interrupt
  assert.equal(signal?.aborted, true);
  assert.equal(h.loop.state, "listening");
  await tick(5);
  assert.equal(h.loop.state, "listening"); // the cancelled turn does not reset the new one to idle
  assert.deepEqual(h.errors, []); // cancellation is not an error
  assert.equal(h.recordings.length, 2);
});

test("pressing while ATOM is speaking stops the speech and starts listening", async () => {
  let stopped = false;
  const h = harness({
    tts: {
      warmUp: async () => {},
      close: () => {},
      speak: (_t, signal) => new Promise<void>((resolve) => signal?.addEventListener("abort", () => ((stopped = true), resolve()))),
    },
  });
  h.loop.press();
  h.loop.press();
  await tick(5);
  assert.equal(h.loop.state, "speaking");
  h.loop.press();
  assert.equal(stopped, true);
  assert.equal(h.loop.state, "listening");
  await tick(5);
  assert.equal(h.loop.state, "listening");
  assert.ok(!h.log.includes("done"));
});

test("cancel returns to idle from any stage and releases the microphone", async () => {
  const h = harness();
  h.loop.press();
  h.loop.cancel();
  assert.equal(h.loop.state, "idle");
  await tick(1);
  assert.equal(h.recordings[0].stopped, true);
  assert.deepEqual(h.log, []);
});

test("errors are reported with the stage that failed, then the loop is ready again", async () => {
  const cases: [Partial<Parameters<typeof harness>[0]>, LoopStage][] = [
    [{ stt: { transcribe: async () => Promise.reject(new Error("whisper broke")) } }, "transcription"],
    [{ core: { handle: async () => Promise.reject(new Error("rate limited")) } }, "model"],
    [{ tts: { warmUp: async () => {}, close: () => {}, speak: async () => Promise.reject(new Error("no audio device")) } }, "speech"],
  ];
  for (const [over, stage] of cases) {
    const h = harness(over);
    h.loop.press();
    h.loop.press();
    await tick(5);
    assert.equal(h.errors.length, 1, stage);
    assert.equal(h.errors[0].stage, stage);
    assert.equal(h.loop.state, "idle");
  }
});

test("a microphone failure while listening is reported and returns to idle", () => {
  const h = harness();
  h.loop.press();
  h.recordings[0].fail(new Error("device unplugged") as AudioError);
  assert.equal(h.loop.state, "idle");
  assert.equal(h.errors[0].stage, "microphone");
});

test("reports when the microphone is actually capturing, only for the current recording", () => {
  const h = harness({ autoReady: false });
  h.loop.press();
  h.loop.cancel();
  h.loop.press();
  h.recordings[0].ready(); // a stale recording becoming ready is ignored
  assert.deepEqual(h.log, []);
  h.recordings[1].ready();
  assert.deepEqual(h.log, ["mic-ready"]);
});

test("warns once while listening if the microphone hears only silence", async () => {
  const h = harness({ silenceWarnMs: 20 });
  h.loop.press();
  h.recordings[0].level(0.0005); // about -66 dB: a muted or wrong microphone
  await tick(40);
  assert.deepEqual(h.log, ["level:0.0005", "mic-silent"]);
  assert.equal(h.loop.state, "listening"); // a warning only; the user can still send
});

test("no silence warning when the microphone hears sound, or after sending", async () => {
  const heard = harness({ silenceWarnMs: 20 });
  heard.loop.press();
  heard.recordings[0].level(0.05); // speech-level sound
  await tick(40);
  assert.equal(heard.log.includes("mic-silent"), false);

  const sent = harness({ silenceWarnMs: 20 });
  sent.loop.press();
  sent.loop.press(); // sent before the warning would fire
  await tick(40);
  assert.equal(sent.log.includes("mic-silent"), false);
});

test("reports microphone levels for the current recording only", () => {
  const h = harness();
  h.loop.press();
  h.loop.cancel();
  h.loop.press();
  h.recordings[0].level(0.9); // the cancelled recording
  h.recordings[1].level(0.2);
  assert.deepEqual(h.log, ["level:0.2"]);
});

test("streaming: speech starts on the model's first words, before the reply is complete (ADR-065)", async () => {
  const order: string[] = [];
  let finish!: () => void;
  const core = {
    async handle(_i: { text: string }, _s?: AbortSignal, hooks?: { onText?: (d: string) => void }) {
      hooks?.onText?.("Sure. ");
      await new Promise<void>((r) => (finish = r));
      order.push("model done");
      return { text: "Sure. Done.", requestId: "r" };
    },
  };
  const tts = {
    warmUp: async () => {},
    close: () => {},
    speak: async () => {},
    async speakStream(pieces: AsyncIterable<string>, _s?: AbortSignal, hooks?: { onStart?: () => void }) {
      for await (const p of pieces) {
        order.push(`say ${p.trim()}`);
        hooks?.onStart?.();
        if (p.includes("Sure")) setTimeout(() => finish(), 0);
      }
    },
  };
  const states: string[] = [];
  const loop = createVoiceLoop({ core, tts, stt: { transcribe: async () => "" } as never, record: (() => { throw new Error("no mic"); }) as never, events: { onState: (s: string) => states.push(s) } } as never);
  loop.ask("do it");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(order, ["say Sure.", "model done"]);
  assert.ok(states.indexOf("speaking") >= 0);
});
