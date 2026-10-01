import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { AudioClip, AudioError, Recording } from "./audio.ts";
import type { IslandEvent } from "./island-protocol.ts";
import { runIsland, type IslandOptions } from "./island.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";
import type { CoreLike } from "./voice-loop.ts";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const clip = (durationMs = 1500): AudioClip => ({ pcm: Buffer.alloc(4), sampleRate: 16_000, durationMs });

/**
 * Runs island mode with fake parts. `send` writes command lines as the island would; `events` collects
 * what the runtime wrote back, parsed, so tests check the real wire format.
 */
function islandHarness(
  over: Partial<{
    stt: SpeechToText;
    core: CoreLike & { reset(): void };
    tts: TextToSpeech;
    clipMs: number;
    warmUp: () => Promise<void>;
    silenceWarnMs: number;
  }> = {},
) {
  const input = new PassThrough();
  const lines: string[] = [];
  const recordings: { stopped: boolean; ready: () => void; level: (p: number) => void; fail: (e: AudioError) => void }[] = [];
  let resets = 0;
  let quits = 0;
  let closed = 0;
  const spoken: string[] = [];

  const core = over.core ?? {
    handle: async (input: { text: string }) => ({ text: `reply to ${input.text}`, requestId: "req-1" }),
    reset: () => resets++,
  };
  const tts: TextToSpeech = over.tts ?? {
    warmUp: over.warmUp ?? (async () => {}),
    close: () => closed++,
    speak: async (text, _signal, hooks) => {
      hooks?.onStart?.();
      spoken.push(text);
    },
  };

  const options: IslandOptions = {
    input,
    write: (line) => lines.push(line),
    record: ({ onReady, onLevel, onFailure }) => {
      const r = { stopped: false, ready: onReady, level: onLevel, fail: onFailure };
      recordings.push(r);
      queueMicrotask(onReady); // a real microphone reports ready once audio flows
      const recording: Recording = {
        stop: async () => {
          r.stopped = true;
          return clip(over.clipMs);
        },
      };
      return recording;
    },
    stt: over.stt ?? { transcribe: async () => "what is the capital of Japan" },
    core,
    tts,
    info: { provider: "fake", model: "fake-1", microphone: ":default" },
    micName: async () => "macOS default: Test Mic",
    describe: (error) => (error instanceof Error ? error.message : String(error)),
    errorDetails: (error) => ((error as { kind?: string }).kind ? { kind: (error as { kind: string }).kind, retryable: true } : {}),
    onQuit: () => quits++,
    silenceWarnMs: over.silenceWarnMs ?? 60_000,
    levelIntervalMs: 50,
  };
  const session = runIsland(options);

  const events = (): IslandEvent[] =>
    lines.map((line) => {
      assert.ok(line.endsWith("\n") && !line.slice(0, -1).includes("\n"), `one line per event: ${JSON.stringify(line)}`);
      return JSON.parse(line) as IslandEvent;
    });
  const send = async (...commands: (string | object)[]) => {
    for (const c of commands) {
      input.write(`${typeof c === "string" ? c : JSON.stringify(c)}\n`);
      await tick(2);
    }
  };
  const types = () => events().map((e) => (e.type === "state" ? `state:${e.state}` : e.type));
  const clear = () => lines.splice(0);
  return {
    session,
    input,
    events,
    types,
    send,
    clear,
    recordings,
    spoken,
    counts: () => ({ resets, quits, closed }),
  };
}

test("sends ready with protocol version and settings once the voice has loaded", async () => {
  const h = islandHarness();
  await tick(2);
  assert.deepEqual(h.events(), [{ type: "ready", protocol: 1, provider: "fake", model: "fake-1", microphone: ":default", voice: true }]);
});

test("a voice that fails to load is reported, and ready still follows with voice: false", async () => {
  const h = islandHarness({ warmUp: async () => Promise.reject(new Error("Kokoro model missing")) });
  await tick(2);
  assert.deepEqual(h.events(), [
    { type: "error", stage: "speech", message: "Kokoro model missing" },
    { type: "ready", protocol: 1, provider: "fake", model: "fake-1", microphone: ":default", voice: false },
  ]);
});

test("a full turn over the wire: start, send, transcript, reply, spoken, complete", async () => {
  const h = islandHarness();
  await tick(2);
  h.clear();
  await h.send({ type: "talk.start" });
  await h.send({ type: "talk.send" });
  await tick(5);
  assert.deepEqual(h.types(), [
    "state:listening",
    "mic.ready",
    "state:transcribing",
    "transcript",
    "state:thinking",
    "reply",
    "state:speaking",
    "turn.complete",
    "state:idle",
  ]);
  const ev = h.events();
  assert.deepEqual(ev[3], { type: "transcript", text: "what is the capital of Japan" });
  assert.deepEqual(ev[5], { type: "reply", text: "reply to what is the capital of Japan" });
  const done = ev[7] as Extract<IslandEvent, { type: "turn.complete" }>;
  assert.equal(done.speechMs, 1500);
  assert.equal(done.requestId, "req-1");
  assert.equal(typeof done.transcriptionMs, "number");
  assert.equal(typeof done.firstSoundMs, "number");
  assert.deepEqual(h.spoken, ["reply to what is the capital of Japan"]);
  assert.equal(h.recordings[0].stopped, true);
});

test("microphone levels are forwarded, throttled, only while listening", async () => {
  const h = islandHarness();
  await tick(2);
  await h.send({ type: "talk.start" });
  h.clear();
  const r = h.recordings[0];
  r.level(0.1);
  r.level(0.6); // within 50 ms of the first: held back…
  await tick(60);
  r.level(0.2); // …and carried into this one
  const levels = h.events().filter((e) => e.type === "mic.level");
  assert.deepEqual(levels, [
    { type: "mic.level", peak: 0.1 },
    { type: "mic.level", peak: 0.6 },
  ]);
});

test("talk.start while listening is ignored; talk.send while idle is ignored", async () => {
  const h = islandHarness();
  await tick(2);
  h.clear();
  await h.send({ type: "talk.send" }); // nothing to send
  assert.deepEqual(h.types(), []);
  await h.send({ type: "talk.start" }, { type: "talk.start" }); // key event delivered twice
  assert.equal(h.recordings.length, 1);
  assert.equal(h.recordings[0].stopped, false);
});

test("talk.start while ZENO is speaking interrupts and starts listening", async () => {
  let stopped = false;
  const h = islandHarness({
    tts: {
      warmUp: async () => {},
      close: () => {},
      speak: (_t, signal) => new Promise<void>((resolve) => signal?.addEventListener("abort", () => ((stopped = true), resolve()))),
    },
  });
  await tick(2);
  await h.send({ type: "talk.start" }, { type: "talk.send" });
  await tick(5);
  assert.equal(h.session.loop.state, "speaking");
  h.clear();
  await h.send({ type: "talk.start" });
  assert.equal(stopped, true);
  assert.equal(h.session.loop.state, "listening");
  assert.ok(!h.types().includes("turn.complete"));
  assert.equal(h.recordings.length, 2);
});

test("talk.cancel discards the recording and sends nothing", async () => {
  let asked = false;
  const h = islandHarness({ core: { handle: async () => ((asked = true), { text: "x" }), reset: () => {} } });
  await tick(2);
  await h.send({ type: "talk.start" });
  h.clear();
  await h.send({ type: "talk.cancel" });
  await tick(5);
  assert.deepEqual(h.types(), ["state:idle"]);
  assert.equal(h.recordings[0].stopped, true);
  assert.equal(asked, false);
});

test("conversation.reset cancels the turn, forgets the conversation and confirms", async () => {
  const h = islandHarness();
  await tick(2);
  await h.send({ type: "talk.start" });
  h.clear();
  await h.send({ type: "conversation.reset" });
  assert.deepEqual(h.types(), ["state:idle", "conversation.reset"]);
  assert.equal(h.counts().resets, 1);
});

test("notices carry a kind and wording for the island's controls", async () => {
  const h = islandHarness({ clipMs: 100 });
  await tick(2);
  h.clear();
  await h.send({ type: "talk.start" }, { type: "talk.send" });
  await tick(5);
  const notice = h.events().find((e) => e.type === "notice");
  assert.deepEqual(notice, { type: "notice", kind: "too_short", message: "Too short. Hold Ctrl+Option while you speak, then let go." });
  assert.equal(h.session.loop.state, "idle");
});

test("silence while listening is reported with the microphone's name", async () => {
  const h = islandHarness({ silenceWarnMs: 10 });
  await tick(2);
  await h.send({ type: "talk.start" });
  await tick(30);
  assert.deepEqual(
    h.events().find((e) => e.type === "mic.silent"),
    { type: "mic.silent", microphone: "macOS default: Test Mic" },
  );
});

test("errors carry the stage, plain message and, for model errors, kind and retryable", async () => {
  const failure = Object.assign(new Error("Gemini daily quota reached"), { kind: "rate_limit" });
  const h = islandHarness({ core: { handle: async () => Promise.reject(failure), reset: () => {} } });
  await tick(2);
  h.clear();
  await h.send({ type: "talk.start" }, { type: "talk.send" });
  await tick(5);
  assert.deepEqual(
    h.events().find((e) => e.type === "error"),
    { type: "error", stage: "model", message: "Gemini daily quota reached", kind: "rate_limit", retryable: true },
  );
  assert.equal(h.events().at(-1)?.type, "state");
  assert.equal(h.session.loop.state, "idle");
});

test("a microphone failure is reported as a microphone error", async () => {
  const h = islandHarness();
  await tick(2);
  await h.send({ type: "talk.start" });
  h.clear();
  h.recordings[0].fail(new Error("Microphone permission denied") as AudioError);
  assert.deepEqual(h.events(), [
    { type: "state", state: "idle" },
    { type: "error", stage: "microphone", message: "Microphone permission denied" },
  ]);
});

test("bad command lines produce protocol errors and the session keeps working", async () => {
  const h = islandHarness();
  await tick(2);
  h.clear();
  await h.send("garbage", '{"type":"format disk"}', "", { type: "talk.start" });
  const ev = h.events();
  assert.deepEqual(ev.slice(0, 2), [
    { type: "error", stage: "protocol", message: "Command is not valid JSON." },
    { type: "error", stage: "protocol", message: 'Unknown command "format disk".' },
  ]);
  assert.equal(h.session.loop.state, "listening"); // the valid command after them still works
});

test("quit releases the microphone and speech, then exits once; later commands are ignored", async () => {
  const h = islandHarness();
  await tick(2);
  await h.send({ type: "talk.start" });
  h.clear();
  await h.send({ type: "quit" }, { type: "talk.start" });
  await tick(5);
  assert.equal(h.recordings[0].stopped, true);
  assert.equal(h.recordings.length, 1);
  assert.deepEqual(h.counts(), { resets: 0, quits: 1, closed: 1 });
  assert.deepEqual(h.types(), []); // nothing is sent while shutting down
});

test("the island closing stdin ends the session", async () => {
  const h = islandHarness();
  await tick(2);
  h.input.end();
  await tick(5);
  assert.equal(h.counts().quits, 1);
  h.session.quit(); // a second quit (e.g. SIGTERM) does nothing more
  assert.equal(h.counts().quits, 1);
});
