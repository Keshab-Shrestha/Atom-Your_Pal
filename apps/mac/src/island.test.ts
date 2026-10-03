import type { ProviderKeys } from "@zeno/shared";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createCore } from "@zeno/core";
import { createSwitchableModel, type SwitchableModel } from "@zeno/llm-gateway";
import type { AudioClip, AudioError, Recording } from "./audio.ts";
import type { IslandEvent } from "./island-protocol.ts";
import { runIsland, type IslandOptions } from "./island.ts";
import { createModelSettings, writeSavedChoice } from "./model-settings.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";
import type { CoreLike } from "./voice-loop.ts";
import { createComputerBridge } from "./computer-bridge.ts";

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
    settings: IslandOptions["settings"];
    computer: IslandOptions["computer"];
    memory: IslandOptions["memory"];
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
    settings: over.settings,
    computer: over.computer,
    ...(over.memory ? { memory: over.memory } : {}),
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

// --- model.set and info (ADR-038, ADR-040) ---

type ModelRequest = Parameters<SwitchableModel["complete"]>[0];

// Placeholder values, not real credentials.
const CLAUDE_KEY = "test-claude-key-0000";
const GEMINI_KEY = "test-gemini-key-0000";

/** The real Core and switchable model with fake gateways that record which model answered what. */
function modelHarness(keys: ProviderKeys = { claude: CLAUDE_KEY, gemini: GEMINI_KEY }) {
  const path = join(mkdtempSync(join(tmpdir(), "zeno-island-")), "config", "island.json");
  const requests: { model: string; request: ModelRequest }[] = [];
  const logs: string[] = [];
  const fakeGateway = (name: string) => ({
    complete: async (request: ModelRequest) => {
      requests.push({ model: name, request });
      return { text: `${name} says hi` };
    },
  });
  const model = createSwitchableModel(fakeGateway("gemini-3.6-flash"));
  const core = createCore({ model });
  const settings = createModelSettings({
    initial: { provider: "gemini", model: "gemini-3.6-flash" },
    keys,
    model,
    createModel: (choice, apiKey) => {
      assert.equal(apiKey, keys[choice.provider]);
      return fakeGateway(choice.model);
    },
    save: (choice) => writeSavedChoice(path, choice),
    log: { info: (event, fields) => logs.push(JSON.stringify({ event, ...fields })), warn: (event, fields) => logs.push(JSON.stringify({ event, ...fields })) },
  });
  const h = islandHarness({ core, settings });
  return { ...h, core, requests, path, logs };
}

const turn = async (h: ReturnType<typeof islandHarness>) => {
  await h.send({ type: "talk.start" }, { type: "talk.send" });
  await tick(5);
};

test("ready is followed by info with the model and the choices", async () => {
  const h = modelHarness({ gemini: GEMINI_KEY });
  await tick(2);
  const [ready, info] = h.events();
  assert.deepEqual(ready, { type: "ready", protocol: 1, provider: "gemini", model: "gemini-3.6-flash", microphone: ":default", voice: true });
  assert.equal(info.type, "info");
  if (info.type !== "info") return;
  assert.equal(info.provider, "gemini");
  assert.equal(info.model, "gemini-3.6-flash");
  assert.deepEqual(
    info.providers.map((p) => ({ id: p.id, name: p.name, available: p.available })),
    [
      { id: "claude", name: "Claude", available: false },
      { id: "claude-plan", name: "Claude (my plan)", available: false },
      { id: "gemini", name: "Gemini", available: true },
    ],
  );
  assert.ok(info.providers[2]!.models.some((m) => m.id === "gemini-3.5-flash-lite" && m.name === "Gemini 3.5 Flash-Lite"));
});

test("model.set switches the next request, keeps the conversation, saves the choice and sends info", async () => {
  const h = modelHarness();
  await tick(2);
  await turn(h);
  h.clear();
  await h.send({ type: "model.set", provider: "claude", model: "claude-opus-5-5" });
  const info = h.events();
  assert.equal(info.length, 1);
  assert.equal(info[0].type, "info");
  assert.deepEqual(info[0].type === "info" && [info[0].provider, info[0].model], ["claude", "claude-opus-5-5"]);
  assert.deepEqual(JSON.parse(readFileSync(h.path, "utf8")), { llm: { provider: "claude", model: "claude-opus-5-5" } });
  assert.ok(h.logs.includes(JSON.stringify({ event: "model.set", provider: "claude", model: "claude-opus-5-5" })));

  await turn(h);
  assert.deepEqual(
    h.requests.map((r) => r.model),
    ["gemini-3.6-flash", "claude-opus-5-5"],
  );
  // The new model sees the earlier exchange.
  assert.deepEqual(
    h.requests[1].request.messages.map((m) => m.content),
    ["what is the capital of Japan", "gemini-3.6-flash says hi", "what is the capital of Japan"],
  );
  assert.equal(h.core.history().length, 4);
});

test("model.set during a turn applies to the next request; the turn in flight finishes on the old model", async () => {
  const h = modelHarness();
  await tick(2);
  await h.send({ type: "talk.start" });
  await h.send({ type: "model.set", provider: "gemini", model: "gemini-3.8-flash" });
  assert.equal(h.session.loop.state, "listening"); // the turn was not interrupted
  await h.send({ type: "talk.send" });
  await tick(5);
  assert.deepEqual(h.requests.map((r) => r.model), ["gemini-3.8-flash"]);
});

test("model.set refusals are settings errors with the fix, and nothing changes", async () => {
  const h = modelHarness({ gemini: GEMINI_KEY });
  await tick(2);
  h.clear();
  await h.send(
    { type: "model.set", provider: "openai", model: "gpt-9" },
    { type: "model.set", provider: "claude", model: "claude-opus-5-5" },
    { type: "model.set", provider: "gemini", model: "gemini-9-ultra" },
  );
  assert.deepEqual(h.events(), [
    { type: "error", stage: "settings", message: 'Unknown AI provider "openai". Choose Claude or Claude (my plan) or Gemini.' },
    { type: "error", stage: "settings", message: "Add ANTHROPIC_API_KEY to .env to use Claude, then restart ZENO." },
    { type: "error", stage: "settings", message: '"gemini-9-ultra" is not a Gemini model ZENO offers. Choose one from the list.' },
  ]);
  assert.equal(existsSync(h.path), false);
  await turn(h);
  assert.deepEqual(h.requests.map((r) => r.model), ["gemini-3.6-flash"]);
  assert.equal(h.session.loop.state, "idle"); // the runtime keeps running
});

test("a malformed model.set is a protocol error", async () => {
  const h = modelHarness();
  await tick(2);
  h.clear();
  await h.send({ type: "model.set", provider: "claude" });
  assert.deepEqual(h.events(), [{ type: "error", stage: "protocol", message: 'model.set needs a "model" string.' }]);
});

test("no event ever carries an API key", async () => {
  const h = modelHarness();
  await tick(2);
  await turn(h);
  await h.send(
    { type: "model.set", provider: "claude", model: "claude-sonnet-5-5" },
    { type: "model.set", provider: "gemini", model: "nope" },
    { type: "model.set", provider: "nope", model: "nope" },
  );
  await turn(h);
  const wire = JSON.stringify(h.events());
  assert.ok(wire.includes('"info"') && wire.includes('"settings"'));
  assert.ok(!wire.includes(CLAUDE_KEY) && !wire.includes(GEMINI_KEY));
  assert.ok(!h.logs.join("").includes(CLAUDE_KEY) && !h.logs.join("").includes(GEMINI_KEY));
  assert.ok(!readFileSync(h.path, "utf8").includes(CLAUDE_KEY));
});

test("computer control: a request reaches the island, and its answer reaches the tool", async () => {
  const bridge = createComputerBridge({ timeoutMs: 5000, newId: () => "a1" });
  const h = islandHarness({ computer: bridge });
  await tick(2);
  h.clear();
  const answer = bridge.approve({ summary: 'Click "Send" in Mail', reason: "it may send" });
  bridge.step({ action: "click", app: "Mail" });
  assert.deepEqual(h.events().map((e) => e.type), ["approval.request", "computer.step"]);
  await h.send({ type: "approval.answer", id: "a1", approved: true });
  assert.equal(await answer, true);
  assert.equal(h.events().filter((e) => e.type === "approval.closed").length, 1);
});

test("computer control: Esc (talk.cancel), a new talk, a reset and quit all decline a waiting request", async () => {
  for (const command of [{ type: "talk.cancel" }, { type: "talk.start" }, { type: "conversation.reset" }, { type: "quit" }]) {
    const bridge = createComputerBridge({ timeoutMs: 5000, newId: () => "a1" });
    const h = islandHarness({ computer: bridge });
    await tick(2);
    const answer = bridge.approve({ summary: "Delete", reason: "it deletes" });
    await h.send(command);
    assert.equal(await answer, false, command.type);
  }
});

test("computer control: a bad approval.answer is a protocol error and approves nothing", async () => {
  const bridge = createComputerBridge({ timeoutMs: 5000, newId: () => "a1" });
  const h = islandHarness({ computer: bridge });
  await tick(2);
  h.clear();
  const answer = bridge.approve({ summary: "Delete", reason: "it deletes" });
  await h.send('{"type":"approval.answer","id":"a1","approved":"true"}');
  assert.ok(h.events().some((e) => e.type === "error" && e.stage === "protocol"));
  bridge.answer("a1", false);
  assert.equal(await answer, false);
});

test("without computer control, approval.answer is quietly ignored", async () => {
  const h = islandHarness();
  await tick(2);
  h.clear();
  await h.send({ type: "approval.answer", id: "a1", approved: true });
  assert.deepEqual(h.events(), []);
});

// --- memory (ADR-058) ---

function fakeMemory() {
  let items = [
    { id: 2, text: "Keshab drinks green tea.", createdAt: "2026-10-04T01:00:00.000Z", source: "voice" as const },
    { id: 1, text: "Keshab's sister is Asha.", createdAt: "2026-10-03T01:00:00.000Z", source: "text" as const },
  ];
  const listeners = new Set<() => void>();
  return {
    memory: {
      list: () => items,
      count: () => items.length,
      forget: (id: number) => {
        const before = items.length;
        items = items.filter((m) => m.id !== id);
        return items.length < before;
      },
      clear: () => {
        const n = items.length;
        items = [];
        return n;
      },
      onChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    /** ZENO kept something by itself (the remember tool). */
    changed: () => {
      items = [{ id: 3, text: "Keshab is in Tokyo.", createdAt: "2026-10-04T02:00:00.000Z", source: "voice" }, ...items];
      for (const l of listeners) l();
    },
  };
}

test("memory.list sends what is kept, newest first; nothing is sent before the island asks", async () => {
  const fake = fakeMemory();
  const h = islandHarness({ memory: fake.memory });
  await tick(5);
  fake.changed();
  assert.ok(!h.types().includes("memory"), "an island that never asked gets no memory events");
  await h.send({ type: "memory.list" });
  const event = h.events().at(-1) as Extract<IslandEvent, { type: "memory" }>;
  assert.equal(event.type, "memory");
  assert.equal(event.enabled, true);
  assert.equal(event.count, 3);
  assert.deepEqual(event.memories.map((m) => m.id), [3, 2, 1]);
});

test("after memory.list, changes ZENO makes by itself are sent; forget and clear answer with the new list", async () => {
  const fake = fakeMemory();
  const h = islandHarness({ memory: fake.memory });
  await tick(5);
  await h.send({ type: "memory.list" });
  h.clear();
  fake.changed();
  assert.deepEqual(h.types(), ["memory"]);
  h.clear();
  await h.send({ type: "memory.forget", id: 2 });
  assert.deepEqual((h.events().at(-1) as Extract<IslandEvent, { type: "memory" }>).memories.map((m) => m.id), [3, 1]);
  await h.send({ type: "memory.forget", id: 99 }); // unknown id: nothing changes, the list is sent again
  assert.equal((h.events().at(-1) as Extract<IslandEvent, { type: "memory" }>).count, 2);
  await h.send({ type: "memory.clear" });
  assert.deepEqual(h.events().at(-1), { type: "memory", enabled: true, count: 0, memories: [] });
});

test("memory commands with memory off answer enabled: false; a bad id is a protocol error", async () => {
  const h = islandHarness();
  await tick(5); // let ready go first
  await h.send({ type: "memory.list" });
  assert.deepEqual(h.events().at(-1), { type: "memory", enabled: false, count: 0, memories: [] });
  h.clear();
  await h.send({ type: "memory.forget", id: "2" }, { type: "memory.forget", id: 1.5 }, { type: "memory.forget" });
  assert.deepEqual(h.types(), ["error", "error", "error"]);
  for (const e of h.events()) assert.equal((e as { stage: string }).stage, "protocol");
});
