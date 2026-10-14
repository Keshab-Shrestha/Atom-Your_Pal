import type { ProviderKeys } from "@atom/shared";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Core } from "@atom/core";
import { createSwitchableModel, type SwitchableModel } from "@atom/llm-gateway";
import type { AudioClip, AudioError, Recording } from "./audio.ts";
import type { IslandEvent } from "./island-protocol.ts";
import { runIsland, type IslandOptions } from "./island.ts";
import { createModelSettings, writeSavedChoice } from "./model-settings.ts";
import type { SpeechToText } from "./stt.ts";
import type { TextToSpeech } from "./tts.ts";
import { createComputerBridge } from "./computer-bridge.ts";
import { BUILT_IN_KITS, HELPERS, openHelperStore, skillFile, tieredModels } from "@atom/helpers";
import { islandHelpers } from "./island-helpers.ts";
import { createHubCommands } from "./hub-commands.ts";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const clip = (durationMs = 1500): AudioClip => ({ pcm: Buffer.alloc(4), sampleRate: 16_000, durationMs });

/**
 * Runs island mode with fake parts. `send` writes command lines as the island would; `events` collects
 * what the runtime wrote back, parsed, so tests check the real wire format.
 */
function islandHarness(
  over: Partial<{
    stt: SpeechToText;
    core: IslandOptions["core"];
    tts: TextToSpeech;
    chats: IslandOptions["chats"];
    projects: IslandOptions["projects"];
    git: IslandOptions["git"];
    clipMs: number;
    warmUp: () => Promise<void>;
    silenceWarnMs: number;
    settings: IslandOptions["settings"];
    computer: IslandOptions["computer"];
    memory: IslandOptions["memory"];
    helpers: IslandOptions["helpers"];
    onTimer: IslandOptions["onTimer"];
    onGoalLine: IslandOptions["onGoalLine"];
    screen: IslandOptions["screen"];
    capabilities: IslandOptions["capabilities"];
    onPlanUsage: IslandOptions["onPlanUsage"];
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
    ...(over.chats ? { chats: over.chats } : {}),
    ...(over.projects ? { projects: over.projects } : {}),
    ...(over.git ? { git: over.git } : {}),
    ...(over.helpers ? { helpers: over.helpers } : {}),
    ...(over.onTimer ? { onTimer: over.onTimer } : {}),
    ...(over.onGoalLine ? { onGoalLine: over.onGoalLine } : {}),
    ...(over.screen ? { screen: over.screen } : {}),
    ...(over.capabilities ? { capabilities: over.capabilities } : {}),
    ...(over.onPlanUsage ? { onPlanUsage: over.onPlanUsage } : {}),
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

test("talk.start while ATOM is speaking interrupts and starts listening", async () => {
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

// ADR-092: Claude on the plan only; its "key" is the claude program's path (never sent or logged).
const CLAUDE = "/Users/k/.local/bin/claude";

/** A Core that asks the switchable model once per turn (ADR-110 N5: the engine's own Core is the native one), history kept. */
function modelCore(model: { complete: (request: ModelRequest, signal?: AbortSignal) => Promise<{ text: string }> }): Core {
  let sessionId = "test-session";
  let turns: { role: "user" | "assistant"; content: string }[] = [];
  return {
    get sessionId() {
      return sessionId;
    },
    async handle(input) {
      const messages = [...turns, { role: "user" as const, content: input.text }];
      const context = { requestId: `r-${messages.length}`, sessionId, source: input.source, receivedAt: new Date() };
      const reply = await model.complete({ system: "", messages, context });
      turns = [...messages, { role: "assistant" as const, content: reply.text }];
      return { requestId: context.requestId, text: reply.text };
    },
    history: () => turns,
    reset() {
      turns = [];
      sessionId = `test-session-${Date.now()}`;
    },
    resume(id, saved) {
      sessionId = id;
      turns = [...saved];
    },
    prepare() {},
  };
}

/** A model Core and switchable model with fake gateways that record which model answered what. */
function modelHarness(keys: ProviderKeys = { "claude-plan": CLAUDE }) {
  const path = join(mkdtempSync(join(tmpdir(), "atom-island-")), "config", "island.json");
  const requests: { model: string; request: ModelRequest }[] = [];
  const logs: string[] = [];
  const fakeGateway = (name: string) => ({
    complete: async (request: ModelRequest) => {
      requests.push({ model: name, request });
      return { text: `${name} says hi` };
    },
  });
  const model = createSwitchableModel(fakeGateway("claude-sonnet-5-5"));
  const core = modelCore(model);
  const settings = createModelSettings({
    initial: { provider: "claude-plan", model: "claude-sonnet-5-5" },
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

test("ready is followed by info with the model and the providers, Claude on the plan first (ADR-093)", async () => {
  const h = modelHarness();
  await tick(2);
  const [ready, info] = h.events();
  assert.deepEqual(ready, { type: "ready", protocol: 1, provider: "claude-plan", model: "claude-sonnet-5-5", microphone: ":default", voice: true });
  assert.equal(info.type, "info");
  if (info.type !== "info") return;
  assert.deepEqual([info.provider, info.model], ["claude-plan", "claude-sonnet-5-5"]);
  assert.deepEqual(info.providers.map((p) => ({ id: p.id, available: p.available })), [
    { id: "claude-plan", available: true },
    { id: "codex", available: false },
    { id: "gemini-cli", available: false },
  ]);
  assert.ok(info.providers[0]!.models.some((m) => m.id === "claude-haiku-4-5-20251001" && m.name === "Claude Haiku 4.5"));
});

test("model.set switches the next request, keeps the conversation, saves the choice and sends info", async () => {
  const h = modelHarness();
  await tick(2);
  await turn(h);
  h.clear();
  await h.send({ type: "model.set", provider: "claude-plan", model: "claude-opus-5-5" });
  const info = h.events();
  assert.equal(info.length, 1);
  assert.deepEqual(info[0].type === "info" && [info[0].provider, info[0].model], ["claude-plan", "claude-opus-5-5"]);
  assert.deepEqual(JSON.parse(readFileSync(h.path, "utf8")), { llm: { provider: "claude-plan", model: "claude-opus-5-5" } });
  assert.ok(h.logs.includes(JSON.stringify({ event: "model.set", provider: "claude-plan", model: "claude-opus-5-5" })));
  await turn(h);
  assert.deepEqual(h.requests.map((r) => r.model), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  // The new model sees the earlier exchange.
  assert.deepEqual(h.requests[1].request.messages.map((m) => m.content), ["what is the capital of Japan", "claude-sonnet-5-5 says hi", "what is the capital of Japan"]);
  assert.equal(h.core.history().length, 4);
});

test("model.set during a turn applies to the next request; the turn in flight finishes on the old model", async () => {
  const h = modelHarness();
  await tick(2);
  await h.send({ type: "talk.start" });
  await h.send({ type: "model.set", provider: "claude-plan", model: "claude-haiku-4-5-20251001" });
  assert.equal(h.session.loop.state, "listening"); // the turn was not interrupted
  await h.send({ type: "talk.send" });
  await tick(5);
  assert.deepEqual(h.requests.map((r) => r.model), ["claude-haiku-4-5-20251001"]);
});

test("model.set refusals are settings errors with the fix, and nothing changes (Gemini and the Claude API are gone)", async () => {
  const h = modelHarness();
  await tick(2);
  h.clear();
  await h.send(
    { type: "model.set", provider: "gemini", model: "gemini-3.6-flash" },
    { type: "model.set", provider: "claude", model: "claude-opus-5-5" },
    { type: "model.set", provider: "claude-plan", model: "gpt 9!" }, // ADR-097: any well-formed id is a custom model; this one is not well-formed
  );
  assert.deepEqual(h.events(), [
    { type: "error", stage: "settings", message: 'Unknown AI provider "gemini". Choose Claude (my plan) or Codex (my ChatGPT plan) or Gemini CLI (my Google sign-in).' },
    { type: "error", stage: "settings", message: 'Unknown AI provider "claude". Choose Claude (my plan) or Codex (my ChatGPT plan) or Gemini CLI (my Google sign-in).' },
    { type: "error", stage: "settings", message: '"gpt 9!" is not a model id: use 1 to 100 letters, digits, ".", "_", ":" or "-".' },
  ]);
  assert.equal(existsSync(h.path), false);
  await turn(h);
  assert.deepEqual(h.requests.map((r) => r.model), ["claude-sonnet-5-5"]);
  assert.equal(h.session.loop.state, "idle"); // the runtime keeps running
});

test("without the claude program, model.set says to install it and sign in", async () => {
  const h = modelHarness({});
  await tick(2);
  h.clear();
  await h.send({ type: "model.set", provider: "claude-plan", model: "claude-opus-5-5" });
  assert.deepEqual(h.events(), [{ type: "error", stage: "settings", message: "Install Claude Code and run `claude auth login` to use Claude (my plan), then restart ATOM." }]);
  h.clear();
  await h.send({ type: "model.set", provider: "codex", model: "codex-default" });
  assert.deepEqual(h.events(), [{ type: "error", stage: "settings", message: "Install Codex and run `codex login` to use Codex (my ChatGPT plan), then restart ATOM." }]);
});

test("a malformed model.set is a protocol error", async () => {
  const h = modelHarness();
  await tick(2);
  h.clear();
  await h.send({ type: "model.set", provider: "claude-plan" });
  assert.deepEqual(h.events(), [{ type: "error", stage: "protocol", message: 'model.set needs a "model" string.' }]);
});

test("no event ever carries the claude program's path", async () => {
  const h = modelHarness();
  await tick(2);
  await turn(h);
  await h.send({ type: "model.set", provider: "claude-plan", model: "claude-opus-5-5" }, { type: "model.set", provider: "nope", model: "nope" });
  await turn(h);
  const wire = JSON.stringify(h.events());
  assert.ok(wire.includes('"info"') && wire.includes('"settings"'));
  assert.ok(!wire.includes(CLAUDE) && !h.logs.join("").includes(CLAUDE) && !readFileSync(h.path, "utf8").includes(CLAUDE));
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
  let episodes = [{ id: 7, summary: "The user planned a trip to Osaka.", endedAt: "2026-10-04T03:00:00.000Z", exchanges: 3 }];
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
      episodes: () => episodes,
      forgetEpisode: (id: number) => {
        const before = episodes.length;
        episodes = episodes.filter((e) => e.id !== id);
        return episodes.length < before;
      },
      clearEpisodes: () => {
        const n = episodes.length;
        episodes = [];
        return n;
      },
      onChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    /** ATOM kept something by itself (the remember tool). */
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

test("after memory.list, changes ATOM makes by itself are sent; forget and clear answer with the new list", async () => {
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
  const cleared = h.events().at(-1) as Extract<IslandEvent, { type: "memory" }>;
  assert.deepEqual([cleared.count, cleared.memories, cleared.episodes.length], [0, [], 1], "clearing facts keeps conversation notes");
  await h.send({ type: "episode.forget", id: 7 });
  assert.deepEqual((h.events().at(-1) as Extract<IslandEvent, { type: "memory" }>).episodes, []);
});

test("memory commands with memory off answer enabled: false; a bad id is a protocol error", async () => {
  const h = islandHarness();
  await tick(5); // let ready go first
  await h.send({ type: "memory.list" });
  assert.deepEqual(h.events().at(-1), { type: "memory", enabled: false, count: 0, memories: [], episodes: [] });
  h.clear();
  await h.send({ type: "memory.forget", id: "2" }, { type: "memory.forget", id: 1.5 }, { type: "memory.forget" });
  assert.deepEqual(h.types(), ["error", "error", "error"]);
  for (const e of h.events()) assert.equal((e as { stage: string }).stage, "protocol");
});

// --- helpers (ADR-081) ---

const PLAN_MODELS = tieredModels([
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
]);

function helperHarness(models = PLAN_MODELS) {
  const store = openHelperStore({ path: ":memory:" });
  const h = islandHarness({ helpers: islandHelpers(store, async () => ["Notes", "Brave Browser", "Arc"], () => models) });
  return { store, h };
}
type HelpersEvent = Extract<IslandEvent, { type: "helpers" }>;

test("helpers.list sends every helper in order with the installed apps, sorted", async () => {
  const { h } = helperHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "helpers.list" });
  // ADR-091: the week's tokens depend on today's date; checked on their own.
  const { usage, ...sent } = h.events()[0] as HelpersEvent;
  assert.deepEqual([usage?.days.length, usage?.week.runs, usage?.byWorker, usage?.recent], [7, 0, [], []]); // token cost, job 4: `recent` is on the wire
  assert.deepEqual([sent], [
    {
      type: "helpers",
      helpers: HELPERS.map((r) => ({
        id: r.id,
        name: r.name,
        available: r.available,
        role: r.role,
        kit: BUILT_IN_KITS[r.role],
        custom: false,
        soul: r.soul,
        soulVersion: 1,
        soulVersions: [{ version: 1, createdAt: (h.events()[0] as HelpersEvent).helpers[0]!.soulVersions[0]!.createdAt }],
        app: null,
        pinnedModel: null,
        browser: false, // ADR-098
        planFirst: false,
        routines: [],
        grants: [],
        skills: [],
        proposals: [],
        jobs: [],
      })),
      apps: ["Arc", "Brave Browser", "Notes"],
      allowLarge: true,
      skills: [],
      skillDrafts: [],
      skillEdits: [],
      mcp: [],
      testCases: [], // ADR-098
      models: [
        { id: "claude-opus-5-5", name: "Claude Opus 5.5", tier: "large" },
        { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", tier: "medium" },
        { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", tier: "small" },
      ],
    },
  ]);
});

test("helper.set gives Sid an installed app; an unknown helper or app is refused with stage settings and nothing changes", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "helper.set", helper: "sid", app: "Brave Browser" });
  assert.deepEqual(h.types(), ["helpers"]);
  assert.equal((h.events()[0] as HelpersEvent).helpers[0]!.app, "Brave Browser");
  h.clear();
  await h.send({ type: "helper.set", helper: "sid", app: "Safari" }, { type: "helper.set", helper: "bob", app: "Notes" });
  assert.deepEqual(h.types(), ["error", "error"]);
  for (const e of h.events()) assert.equal((e as { stage: string }).stage, "settings");
  assert.equal(store.list()[0]!.app, "Brave Browser");
  h.clear();
  await h.send({ type: "helper.set", helper: "sid", app: "" });
  assert.equal((h.events()[0] as HelpersEvent).helpers[0]!.app, null);
});

test("job.add queues a job for Sid; empty, long, unknown or unavailable is refused with stage settings", async () => {
  const { h } = helperHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "job.add", helper: "sid", task: "  research networking  " });
  assert.deepEqual(h.types(), ["helpers"], "one helpers event, not one for the command and one for the change");
  const job = (h.events()[0] as HelpersEvent).helpers[0]!.jobs[0]!;
  assert.deepEqual([job.task, job.state, typeof job.createdAt], ["research networking", "queued", "string"]);
  assert.equal(Object.hasOwn(job, "endedAt"), false);
  h.clear();
  await h.send(
    { type: "job.add", helper: "sid", task: "   " },
    { type: "job.add", helper: "sid", task: "x".repeat(1001) },
    { type: "job.add", helper: "tinker", task: "x" },
    { type: "job.add", helper: "bob", task: "x" },
  );
  assert.deepEqual(h.types(), ["error", "error", "error", "error"]);
  for (const e of h.events()) assert.equal((e as { stage: string }).stage, "settings");
});

test("job.stop and job.delete answer with helpers; unknown ids are ignored", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  const id = store.addJob("sid", "research networking").id;
  h.clear();
  await h.send({ type: "job.stop", id });
  assert.equal((h.events().at(-1) as HelpersEvent).helpers[0]!.jobs[0]!.state, "stopped");
  assert.ok((h.events().at(-1) as HelpersEvent).helpers[0]!.jobs[0]!.endedAt);
  await h.send({ type: "job.stop", id }, { type: "job.stop", id: 999 }, { type: "job.delete", id: 999 });
  assert.deepEqual(h.types(), ["helpers", "helpers", "helpers", "helpers"]);
  h.clear();
  await h.send({ type: "job.delete", id });
  assert.deepEqual((h.events().at(-1) as HelpersEvent).helpers[0]!.jobs, []);
});

test("after helpers.list, job changes made elsewhere (the runner) are sent; before it, nothing is", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  h.clear();
  const id = store.addJob("sid", "research networking").id;
  await tick(2);
  assert.deepEqual(h.types(), [], "an island that never asked gets no helpers events");
  await h.send({ type: "helpers.list" });
  h.clear();
  store.start(id);
  store.step(id, "Searching"); // sent together with the start: one event for changes in the same moment
  await tick(2);
  assert.deepEqual(h.types(), ["helpers"]);
  const running = (h.events().at(-1) as HelpersEvent).helpers[0]!.jobs[0]!;
  assert.deepEqual([running.state, running.step], ["running", "Searching"]);
  h.clear();
  store.finish(id, { title: "Networking", summary: "The basics.", body: "One.\n\nTwo.", sources: [] }, true);
  await tick(2);
  const done = (h.events().at(-1) as HelpersEvent).helpers[0]!.jobs[0]!;
  assert.deepEqual([done.state, done.partial, done.title, done.summary, Object.hasOwn(done, "step")], ["done", true, "Networking", "The basics.", false]);
});

test("helper.pin pins Sid to an offered model and \"\" unpins; an unknown model or helper is refused with stage settings", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "helper.pin", helper: "sid", model: "claude-sonnet-5-5" });
  assert.deepEqual(h.types(), ["helpers"]);
  assert.equal((h.events()[0] as HelpersEvent).helpers[0]!.pinnedModel, "claude-sonnet-5-5");
  h.clear();
  await h.send({ type: "helper.pin", helper: "sid", model: "claude-gone-1" }, { type: "helper.pin", helper: "bob", model: "claude-sonnet-5-5" });
  assert.deepEqual(h.types(), ["error", "error"]);
  for (const e of h.events()) assert.equal((e as { stage: string }).stage, "settings");
  assert.equal(store.list()[0]!.pinnedModel, "claude-sonnet-5-5", "nothing changed");
  h.clear();
  await h.send({ type: "helper.pin", helper: "sid", model: "" });
  assert.equal((h.events()[0] as HelpersEvent).helpers[0]!.pinnedModel, null);
});

test("soul.set saves a new version and soul.restore brings an old one back; a bad soul is refused with stage settings", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  h.clear();
  const soul = { ...HELPERS[0].soul, lessons: "Give three sources." };
  await h.send({ type: "soul.set", helper: "sid", soul });
  assert.deepEqual(h.types(), ["helpers"]);
  const sid = (h.events()[0] as HelpersEvent).helpers[0]!;
  assert.deepEqual([sid.soulVersion, sid.soul.lessons, sid.soulVersions.map((v) => v.version)], [2, "Give three sources.", [2, 1]]);
  h.clear();
  await h.send({ type: "soul.set", helper: "sid", soul: { ...soul, name: "Pal" } }, { type: "soul.restore", helper: "sid", version: 7 });
  assert.deepEqual(h.types(), ["error", "error"]);
  for (const e of h.events()) assert.equal((e as { stage: string }).stage, "settings");
  h.clear();
  await h.send({ type: "soul.restore", helper: "sid", version: 1 });
  assert.equal((h.events()[0] as HelpersEvent).helpers[0]!.soul.lessons, "");
  assert.equal(store.list()[0]!.soulVersion, 3);
});

test("tasks: job.add with blockedBy, job.block refusing a circle, comment.add and thread.get (ADR-087)", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "job.add", helper: "sid", task: "Research" }, { type: "job.add", helper: "hana", task: "Write it up", blockedBy: [1] });
  const hana = (h.events().at(-1) as HelpersEvent).helpers.find((x) => x.id === "hana")!;
  assert.deepEqual([hana.jobs[0]!.blockedBy, hana.jobs[0]!.waitingFor, hana.jobs[0]!.comments], [[1], [1], 0]);
  h.clear();
  await h.send({ type: "job.block", id: 1, blockedBy: [2] });
  assert.deepEqual(h.types(), ["error"]);
  assert.match((h.events()[0] as { message: string }).message, /circle/);
  h.clear();
  await h.send({ type: "comment.add", id: 2, text: "Keep it short" }, { type: "thread.get", id: 2 });
  assert.deepEqual(h.types(), ["helpers", "thread"]);
  const thread = h.events()[1] as Extract<IslandEvent, { type: "thread" }>;
  assert.deepEqual([thread.id, thread.comments.map((c) => c.text), thread.activity.map((a) => a.kind), thread.report], [2, ["Keep it short"], ["created", "commented"], undefined]);
  h.clear();
  await h.send({ type: "thread.get", id: 99 });
  assert.deepEqual(h.types(), ["error"]);
  assert.equal(store.get(2)!.comments, 1);
});

test("job.fresh forgets an ended task's session and runs it again; a running task is refused (Task 3.6)", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  const { id } = store.addJob("sid", "x");
  store.start(id);
  h.clear();
  await h.send({ type: "job.fresh", id });
  assert.deepEqual(h.types(), ["error"]);
  store.setSession(id, "s-1");
  store.finish(id, { title: "T", summary: "S", body: "B", sources: [] });
  assert.equal((store.list()[0]!.jobs[0] as { resumable?: boolean }).resumable, true);
  h.clear();
  await h.send({ type: "job.fresh", id });
  const sid = (h.events().at(-1) as HelpersEvent).helpers[0]!.jobs[0]!;
  assert.deepEqual([sid.state, sid.resumable], ["queued", undefined]);
});

test("a line with something to do after it: done once it has been said (Task 3.8)", async () => {
  let say!: (line: string, after?: () => void) => void;
  const h = islandHarness({ onGoalLine: (listener) => ((say = listener), () => {}) });
  await new Promise((r) => setTimeout(r, 5));
  let asked = 0;
  say("Sid has a plan ready for your OK.", () => asked++);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual([h.spoken, asked], [["Sid has a plan ready for your OK."], 1]);
});

test("speech.set: muted reports still show on the island but are not said; turned on, they are (ADR-091)", async () => {
  let say!: (line: string, after?: () => void) => void;
  const h = islandHarness({ onGoalLine: (listener) => ((say = listener), () => {}) });
  await new Promise((r) => setTimeout(r, 5));
  await h.send({ type: "speech.set", reports: false, updates: true });
  let done = 0;
  say("Sid's report is ready.", () => done++);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual([h.spoken, done], [[], 1], "not said, but what follows it still happens");
  assert.ok(h.events().some((e) => e.type === "worker.line"), "still shown");
  await h.send({ type: "speech.set", reports: true, updates: true });
  say("Kame is done.");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(h.spoken, ["Kame is done."]);
});

test("ADR-110 N3: a later reply (an agent reported) goes the report-line path: a Quiet chat shows it and does not say it (ADR-106)", async () => {
  let say!: (line: string, after?: () => void) => void;
  const h = islandHarness({ onGoalLine: (listener) => ((say = listener), () => {}) });
  await new Promise((r) => setTimeout(r, 5));
  await h.send({ type: "speech.set", reports: false, updates: false }); // Quiet: "Off, they only show"
  say("Sid found three flights under $400.");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(h.spoken, []);
  await h.send({ type: "speech.set", reports: true, updates: true });
  say("Penny wrote the draft.");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(h.spoken, ["Penny wrote the draft."]);
});

test("chats: listed with the current one; opened, ATOM continues it; deleting the current one starts a new chat (ADR-091)", async () => {
  const saved = new Map([["chat-a", [{ role: "user" as const, content: "Plan my trip" }, { role: "assistant" as const, content: "Where to?" }]]]);
  let session = "chat-new";
  const resumed: string[] = [];
  const h = islandHarness({
    core: {
      handle: async () => ({ text: "x" }),
      reset: () => void (session = "chat-reset"),
      resume: (id, turns) => void ((session = id), resumed.push(`${id}:${turns.length}`)),
      get sessionId() {
        return session;
      },
    },
    chats: {
      list: () => [...saved.keys()].map((id) => ({ id, title: "Plan my trip", updatedAt: "2026-10-11T00:00:00.000Z", messages: saved.get(id)!.length })),
      messages: (id) => saved.get(id) ?? [],
      remove: (id) => saved.delete(id),
      onChange: () => () => {},
    },
  });
  await tick(5);
  h.clear();
  await h.send({ type: "chats.list" });
  assert.deepEqual(h.events(), [{ type: "chats", chats: [{ id: "chat-a", title: "Plan my trip", updatedAt: "2026-10-11T00:00:00.000Z", messages: 2 }], current: "chat-new" }]);
  h.clear();
  await h.send({ type: "chat.open", id: "chat-a" });
  assert.deepEqual(resumed, ["chat-a:2"]);
  assert.deepEqual(h.events()[0], { type: "chat.opened", id: "chat-a", messages: [{ role: "user", text: "Plan my trip" }, { role: "assistant", text: "Where to?" }] });
  assert.equal((h.events()[1] as { current: string }).current, "chat-a");
  h.clear();
  await h.send({ type: "chat.delete", id: "chat-a" });
  assert.deepEqual(h.types(), ["conversation.reset", "chats"]);
  assert.deepEqual(h.events()[1], { type: "chats", chats: [], current: "chat-reset" });
});

test("chats written by Telegram or the local API are read-only: flagged, and a window turn in one is refused (ADR-098)", async () => {
  const saved = new Map([["telegram", 2], ["api", 2], ["api-ci", 2], ["chat-a", 2]]);
  let session = "chat-new";
  const handled: string[] = [];
  const h = islandHarness({
    core: {
      handle: async (input) => (handled.push(input.text), { text: "x" }),
      reset: () => {},
      resume: (id) => void (session = id),
      get sessionId() {
        return session;
      },
    },
    chats: {
      list: () => [...saved].map(([id, messages]) => ({ id, title: id, updatedAt: "2026-10-11T00:00:00.000Z", messages })),
      messages: () => [{ role: "user" as const, content: "hi" }],
      remove: () => true,
      onChange: () => () => {},
    },
  });
  await tick(5);
  h.clear();
  await h.send({ type: "chats.list" });
  const chats = (h.events()[0] as { chats: { id: string; readOnly?: boolean }[] }).chats;
  assert.deepEqual(chats.map((c) => [c.id, c.readOnly]), [["telegram", true], ["api", true], ["api-ci", true], ["chat-a", undefined]]);
  await h.send({ type: "chat.open", id: "telegram" });
  h.clear();
  await h.send({ type: "text.send", text: "write here" });
  await tick(10);
  assert.deepEqual(handled, []);
  const error = h.events().find((e) => e.type === "error") as { message: string };
  assert.equal(error.message, "This chat is written from Telegram. Open it to read it only.");
  await h.send({ type: "chat.open", id: "api-ci" });
  h.clear();
  await h.send({ type: "text.send", text: "again" });
  await tick(10);
  assert.match((h.events().find((e) => e.type === "error") as { message: string }).message, /written from the local API/);
  await h.send({ type: "chat.open", id: "chat-a" });
  await h.send({ type: "text.send", text: "fine" });
  await tick(10);
  assert.deepEqual(handled, ["fine"]);
});

test("git: branches listed; a push runs and the list comes back; a refused push says why (ADR-091)", async () => {
  const branch = { repo: "/r", repoName: "r", branch: "zeno/task-7", task: 7, base: "origin/main", commits: [], files: [], pushed: "no" as const };
  const pushed: string[] = [];
  let refuse = false;
  const h = islandHarness({
    git: {
      list: async () => [{ ...branch, pushed: pushed.length ? ("yes" as const) : ("no" as const) }],
      push: async (repo, b) => {
        if (refuse) throw new Error("The push failed: rejected");
        pushed.push(`${repo} ${b}`);
      },
      diff: async () => ({ text: "+two", truncated: false }),
    },
  });
  await tick(5);
  h.clear();
  await h.send({ type: "git.list" });
  await tick(5);
  assert.deepEqual(h.events(), [{ type: "git", branches: [branch] }]);
  h.clear();
  await h.send({ type: "git.push", repo: "/r", branch: "zeno/task-7" });
  await tick(5);
  assert.deepEqual([pushed, (h.events()[0] as { branches: { pushed: string }[] }).branches[0]!.pushed], [["/r zeno/task-7"], "yes"]);
  h.clear();
  await h.send({ type: "git.diff", repo: "/r", branch: "zeno/task-7" });
  await tick(5);
  assert.deepEqual(h.events(), [{ type: "git.diff", repo: "/r", branch: "zeno/task-7", text: "+two", truncated: false }]);
  refuse = true;
  h.clear();
  await h.send({ type: "git.push", repo: "/r", branch: "zeno/task-7" });
  await tick(5);
  assert.match((h.events()[0] as { message: string }).message, /The push failed: rejected/);
});

test("routines in helpers, and routine.delete (Task 3.9)", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  const r = store.addRoutine("sid", "News", { kind: "daily", minute: 480 });
  h.clear();
  await h.send({ type: "helpers.list" });
  const [sent] = (h.events().at(-1) as HelpersEvent).helpers[0]!.routines;
  const { nextAt, ...rest } = sent!;
  assert.deepEqual(rest, { id: r.id, task: "News", when: "Every day at 8:00 AM", schedule: { kind: "daily", minute: 480 } }); // ADR-097
  assert.ok(new Date(nextAt!).getTime() > Date.now(), "ADR-094: when it next comes due");
  // ADR-094: paused, it has no next time.
  await h.send({ type: "routine.pause", id: r.id, paused: true });
  assert.deepEqual((h.events().at(-1) as HelpersEvent).helpers[0]!.routines, [{ id: r.id, task: "News", when: "Every day at 8:00 AM", schedule: { kind: "daily", minute: 480 }, paused: true }]);
  await h.send({ type: "routine.delete", id: r.id });
  assert.deepEqual((h.events().at(-1) as HelpersEvent).helpers[0]!.routines, []);
});

test("grant.add refuses the home folder; grant.remove takes a folder back (Task 3.11)", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "grant.add", helper: "kame", path: homedir() });
  assert.deepEqual(h.types(), ["error"]);
  assert.match((h.events()[0] as { message: string }).message, /whole home folder/);
  await h.send({ type: "grant.remove", helper: "kame", path: "/nope" });
  assert.deepEqual(store.list()[1]!.grants, []);
});

test("helper.skills keeps only Keshab's skills (Task 3.12)", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const h = islandHarness({ helpers: islandHelpers(store, async () => [], () => [], () => [{ name: "pdf", description: "PDFs" }]) });
  await tick(5);
  await h.send({ type: "helper.skills", helper: "sid", skills: ["pdf"] });
  const event = h.events().at(-1) as HelpersEvent;
  assert.deepEqual([event.helpers[0]!.skills, event.skills], [["pdf"], [{ name: "pdf", description: "PDFs" }]]);
  h.clear();
  await h.send({ type: "helper.skills", helper: "sid", skills: ["secret"] });
  assert.match((h.events()[0] as { message: string }).message, /no skill called "secret"/);
  assert.deepEqual(store.list()[0]!.skills, ["pdf"]);
});

test("job.rate asks Tinker to review; proposal.accept, proposal.undo and proposal.reject (Task 3.13)", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  const { id } = store.addJob("sid", "x");
  store.start(id);
  store.finish(id, { title: "T", summary: "S", body: "B", sources: [] });
  await h.send({ type: "job.rate", id, good: false, comment: "Too thin" });
  const event = h.events().at(-1) as HelpersEvent;
  assert.equal(event.helpers[0]!.jobs[0]!.rating, "bad");
  const review = event.helpers[6]!.jobs[0]!;
  assert.equal(review.reviews, id);
  const p = store.addProposal(review.id, { field: "lessons", text: "Go deeper.", reason: "Too thin." });
  await h.send({ type: "proposal.accept", id: p.id });
  assert.equal(store.soul("sid").lessons, "Go deeper.");
  assert.deepEqual((h.events().at(-1) as HelpersEvent).helpers[0]!.proposals.map((x) => x.state), ["accepted"]);
  await h.send({ type: "proposal.undo", id: p.id });
  assert.equal(store.soul("sid").lessons, "");
  h.clear();
  await h.send({ type: "proposal.reject", id: p.id });
  assert.deepEqual(h.types(), ["error"]);
});

test("skill.make, skill.approve and skill.reject; skill.edit.accept, .undo and .reject; drafts and edits in the helpers event (ADR-094)", async () => {
  const home = mkdtempSync(join(tmpdir(), "atom-home-"));
  const skillsDir = mkdtempSync(join(tmpdir(), "atom-skills-"));
  try {
    const store = openHelperStore({ path: ":memory:", home, skillsDir });
    const h = islandHarness({ helpers: islandHelpers(store, async () => []) });
    await tick(5);
    const { id } = store.addJob("sid", "Compare laptops");
    store.start(id);
    store.finish(id, { title: "T", summary: "S", body: "B", sources: [] });
    await h.send({ type: "skill.make", id });
    const tinker = (h.events().at(-1) as HelpersEvent).helpers[6]!.jobs[0]!;
    assert.equal(tinker.reviews, id);
    const draft = store.addSkillDraft(tinker.id, { name: "compare-laptops", description: "Comparing laptops.", body: `Steps.\n${"x".repeat(900)}` });
    await h.send({ type: "skill.approve", id: draft.id });
    const event = h.events().at(-1) as HelpersEvent;
    assert.deepEqual([event.skillDrafts![0]!.state, event.skillDrafts![0]!.preview.length], ["approved", 400]);
    assert.ok(existsSync(join(skillsDir, "compare-laptops", "SKILL.md")));
    h.clear();
    await h.send({ type: "skill.make", id });
    await h.send({ type: "skill.reject", id: draft.id });
    assert.deepEqual(h.types(), ["error", "error"]);
    assert.match((h.events()[0] as { message: string }).message, /has drafted/);

    writeFileSync(join(skillsDir, "compare-laptops", "SKILL.md"), skillFile("compare-laptops", "Comparing laptops.", "1. Search.\n2. Compare two."));
    store.recordSkillUse(id, "compare-laptops");
    await h.send({ type: "job.rate", id, good: false });
    const edit = store.list()[6]!.jobs.find((j) => j.reviewKind === "edit")!;
    const e = store.addSkillEdit(edit.id, { body: "1. Search.\n2. Compare three.", reason: "Two was too few." });
    await h.send({ type: "skill.edit.accept", id: e.id });
    const after = (h.events().at(-1) as HelpersEvent).skillEdits![0]!;
    assert.deepEqual([after.state, after.before, after.after, after.reason], ["accepted", "2. Compare two.", "2. Compare three.", "Two was too few."]);
    await h.send({ type: "skill.edit.undo", id: e.id });
    assert.match(readFileSync(join(skillsDir, "compare-laptops", "SKILL.md"), "utf8"), /Compare two\.\n$/);
    h.clear();
    await h.send({ type: "skill.edit.reject", id: e.id });
    assert.deepEqual(h.types(), ["error"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

test("job.open opens through the runtime; its words come back as an error when it cannot (Task 3.14)", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const opened: number[] = [];
  const helpers = { ...islandHelpers(store, async () => []), openReport: async (id: number) => (id === 1 ? (opened.push(id), "Opened") : Promise.reject(new Error("That task has no report."))) };
  const h = islandHarness({ helpers });
  await tick(5);
  h.clear();
  await h.send({ type: "job.open", id: 1 });
  await tick(5);
  assert.deepEqual([opened, h.types()], [[1], ["helpers"]]);
  h.clear();
  await h.send({ type: "job.open", id: 2 });
  await tick(5);
  assert.match((h.events()[0] as { message: string }).message, /no report/);
});

test("the helpers event carries Paperclip's tasks only when the connection is on (Task 3.16)", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const issue = { id: "is1", identifier: "PAP-1", title: "Review", agent: "CTO", status: "todo", createdAt: "2026-10-11T00:00:00.000Z" };
  const on = islandHarness({ helpers: { ...islandHelpers(store, async () => []), paperclip: () => ({ issues: [issue] }) } });
  const off = islandHarness({ helpers: islandHelpers(store, async () => []) });
  await tick(5);
  await on.send({ type: "helpers.list" });
  await off.send({ type: "helpers.list" });
  assert.deepEqual((on.events().at(-1) as HelpersEvent).paperclip, { issues: [issue] });
  assert.equal(Object.hasOwn(off.events().at(-1) as object, "paperclip"), false);
});

test("the helpers event names agent folders that could not be loaded, and leaves the field out when there are none (ADR-093)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-ag-"));
  try {
    mkdirSync(join(dir, "bad"));
    writeFileSync(join(dir, "bad", "soul.md"), "no front matter");
    const h = islandHarness({ helpers: islandHelpers(openHelperStore({ path: ":memory:", agentsDir: dir }), async () => []) });
    await tick(5);
    await h.send({ type: "helpers.list" });
    const problems = (h.events().at(-1) as HelpersEvent).agentProblems;
    assert.deepEqual(problems?.map((p) => p.id), ["bad"]);
    assert.match(problems![0]!.problem, /front matter/);
    rmSync(join(dir, "bad"), { recursive: true });
    await h.send({ type: "helpers.list" });
    assert.equal(Object.hasOwn(h.events().at(-1) as object, "agentProblems"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agent.create adds an agent with its soul.md; agent.remove takes it out (ADR-088)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-ag-"));
  try {
    const store = openHelperStore({ path: ":memory:", agentsDir: dir });
    const h = islandHarness({ helpers: islandHelpers(store, async () => []) });
    await tick(5);
    await h.send({ type: "agent.create", name: "Rumi", role: "Travel planner", kit: "think", personality: "Calm.", howItWorks: "", rules: "" });
    const rumi = (h.events().at(-1) as HelpersEvent).helpers.at(-1)!;
    assert.deepEqual([rumi.id, rumi.role, rumi.kit, rumi.custom], ["rumi", "travel planner", "think", true]);
    h.clear();
    await h.send({ type: "agent.create", name: "Pal", role: "x", kit: "think", personality: "P", howItWorks: "", rules: "" });
    assert.match((h.events()[0] as { message: string }).message, /taken by ATOM/);
    await h.send({ type: "agent.remove", id: "rumi" });
    assert.ok(!(h.events().at(-1) as HelpersEvent).helpers.some((x) => x.id === "rumi"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP servers in helpers never carry a secret value; mcp.add, mcp.set and mcp.remove (ADR-090)", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  await h.send({ type: "mcp.add", name: "notes", kind: "command", command: "notes-mcp", env: ["NOTES_TOKEN=supersecret"] });
  const item = (h.events().at(-1) as HelpersEvent).mcp![0]!;
  assert.deepEqual([item.name, item.envKeys, item.enabled], ["notes", ["NOTES_TOKEN"], false]);
  assert.ok(!JSON.stringify(h.events()).includes("supersecret"), "never sent to the island");
  h.clear();
  await h.send({ type: "mcp.set", id: item.id, enabled: true });
  assert.match((h.events()[0] as { message: string }).message, /Test the server first/);
  store.recordMcpTest(item.id, { tools: ["search"] });
  await h.send({ type: "mcp.set", id: item.id, enabled: true, workers: ["sid"] });
  assert.deepEqual((h.events().at(-1) as HelpersEvent).mcp![0]!.workers, ["sid"]);
  await h.send({ type: "mcp.remove", id: item.id });
  assert.deepEqual((h.events().at(-1) as HelpersEvent).mcp, []);
});

test("helpers.settings turns the large model off and on, answered with helpers", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "helpers.settings", allowLarge: false });
  assert.deepEqual(h.types(), ["helpers"]);
  assert.equal((h.events()[0] as HelpersEvent).allowLarge, false);
  assert.equal(store.allowLarge(), false);
  await h.send({ type: "helpers.settings", allowLarge: true });
  assert.equal((h.events().at(-1) as HelpersEvent).allowLarge, true);
});

test("a job's model and reason are sent once chosen; models is empty when the provider is not the Claude plan", async () => {
  const { h, store } = helperHarness([]);
  await tick(5);
  await h.send({ type: "helpers.list" });
  assert.deepEqual((h.events().at(-1) as HelpersEvent).models, []);
  const id = store.addJob("sid", "a").id;
  store.start(id);
  h.clear();
  store.setModel(id, "claude-haiku-4-5-20251001", "Laya: trivial");
  await tick(2);
  const job = (h.events().at(-1) as HelpersEvent).helpers[0]!.jobs[0]!;
  assert.deepEqual([job.model, job.modelReason], ["claude-haiku-4-5-20251001", "Laya: trivial"]);
});

test("with helpers off: helpers.list and stop/delete answer an empty list; set, add, pin and settings are refused", async () => {
  const h = islandHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "helpers.list" }, { type: "job.stop", id: 1 }, { type: "job.delete", id: 1 });
  for (const e of h.events()) assert.deepEqual(e, { type: "helpers", helpers: [], apps: [] });
  assert.equal(h.events().length, 3);
  h.clear();
  await h.send(
    { type: "helper.set", helper: "sid", app: "Notes" },
    { type: "job.add", helper: "sid", task: "x" },
    { type: "helper.pin", helper: "sid", model: "" },
    { type: "helpers.settings", allowLarge: false },
  );
  assert.deepEqual(h.types(), ["error", "error", "error", "error"]);
  for (const e of h.events()) assert.deepEqual(e, { type: "error", stage: "settings", message: "Helpers are off: their file could not be opened." });
});

// --- timers (ADR-061) ---

test("a timer ending is shown and spoken, in that order, then ATOM is idle again", async () => {
  let fire!: (t: { id: number; label: string; seconds: number }) => void;
  const h = islandHarness({ onTimer: (listener) => ((fire = listener), () => {}) });
  await new Promise((r) => setTimeout(r, 5));
  fire({ id: 3, label: "pasta", seconds: 600 });
  fire({ id: 4, label: "", seconds: 90 });
  await new Promise((r) => setTimeout(r, 20));
  const events = h.events();
  const timers = events.filter((e) => e.type === "timer");
  assert.deepEqual(
    events.filter((e) => e.type === "state" || e.type === "timer").slice(-3).map((e) => e.type === "state" ? e.state : "timer"),
    ["speaking", "idle", "timer"],
    "the timer event comes last so the island's notice stays up",
  );
  assert.deepEqual(timers, [
    { type: "timer", id: 3, label: "pasta", message: "Your pasta timer is done." },
    { type: "timer", id: 4, label: "", message: "Your 1 minute and 30 seconds timer is done." },
  ]);
  assert.deepEqual(h.spoken, ["Your pasta timer is done.", "Your 1 minute and 30 seconds timer is done."]);
});

// --- goals (Task 3.5) ---

test("a goal's line waits until ATOM is idle, then is spoken without a timer notice", async () => {
  let say!: (line: string) => void;
  let answer!: () => void;
  const h = islandHarness({
    onGoalLine: (listener) => ((say = listener), () => {}),
    core: { handle: () => new Promise((r) => (answer = () => r({ text: "the reply", requestId: "r" }))), reset: () => {} },
  });
  await new Promise((r) => setTimeout(r, 5));
  await h.send({ type: "text.send", text: "hello" });
  say("Your guide is ready. The ATOM window has the report.");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(h.spoken, [], "not while ATOM is thinking");
  answer();
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual(h.spoken, ["the reply", "Your guide is ready. The ATOM window has the report."]);
  assert.ok(!h.events().some((e) => e.type === "timer"));
  const line = h.events().findIndex((e) => e.type === "worker.line");
  assert.ok(line >= 0 && h.events()[line + 1]?.type === "state", "the line goes to the island just before it is said (Task 3.15)");
});

// --- typed requests ---

test("text.send: answered and spoken like a voice turn, without the microphone; empty text is refused", async () => {
  const h = islandHarness();
  await h.send({ type: "text.send", text: "  what time is it " });
  await new Promise((r) => setTimeout(r, 10));
  const events = h.events();
  assert.ok(events.some((e) => e.type === "transcript" && e.text === "what time is it"));
  assert.ok(events.some((e) => e.type === "reply" && e.text === "reply to what time is it"));
  assert.deepEqual(h.spoken, ["reply to what time is it"]);
  const done = events.find((e) => e.type === "turn.complete") as Extract<IslandEvent, { type: "turn.complete" }>;
  assert.equal(done.speechMs, 0);
  assert.ok(!events.some((e) => e.type === "state" && e.state === "listening"));
  await h.send({ type: "text.send", text: "   " });
  assert.match(String((h.events().at(-1) as { message?: string }).message), /non-empty "text"/);
});

test("context.window reads the named app and answers context.ready", async () => {
  const points: string[] = [];
  let clears = 0;
  const h = islandHarness({
    screen: {
      point: async (bundleId, name) => (points.push(`${bundleId}|${name}`), bundleId === "com.apple.Terminal" ? { ok: false, message: "ATOM doesn't read Terminal." } : { ok: true }),
      clear: () => clears++,
    },
  });
  await tick(2);
  h.clear();
  await h.send({ type: "context.window", bundleId: "com.brave.Browser", name: "Brave Browser" });
  await h.send({ type: "context.window", bundleId: "com.apple.Terminal", name: "Terminal" });
  assert.deepEqual(points, ["com.brave.Browser|Brave Browser", "com.apple.Terminal|Terminal"]);
  assert.deepEqual(h.events(), [
    { type: "context.ready", app: "Brave Browser", ok: true },
    { type: "context.ready", app: "Terminal", ok: false, message: "ATOM doesn't read Terminal." },
  ]);
  await h.send({ type: "conversation.reset" });
  assert.equal(clears, 1);
});

test("context.window without a screen reader, or when the read fails, answers ok: false", async () => {
  const h = islandHarness();
  await tick(2);
  h.clear();
  await h.send({ type: "context.window", bundleId: "com.brave.Browser", name: "Brave Browser" });
  assert.deepEqual(h.events(), [{ type: "context.ready", app: "Brave Browser", ok: false, message: "Reading the screen is turned off." }]);

  const failing = islandHarness({ screen: { point: async () => Promise.reject(new Error("lsappinfo failed")), clear: () => {} } });
  await tick(2);
  failing.clear();
  await failing.send({ type: "context.window", bundleId: "com.brave.Browser", name: "Brave Browser" });
  assert.deepEqual(failing.events(), [{ type: "context.ready", app: "Brave Browser", ok: false, message: "lsappinfo failed" }]);
});

// --- capabilities and plan.usage (ADR-076) ---

test("capabilities follow ready (and info), and are sent again after a model switch", async () => {
  const items = [{ title: "Open apps and websites", examples: ["Open Safari", "Go to YouTube"] }];
  let provider = "gemini";
  const settings: IslandOptions["settings"] = {
    info: () => ({ provider, model: "m", providers: [] }),
    setModel: (p) => {
      provider = p;
      return { ok: true };
    },
  };
  const h = islandHarness({ settings, capabilities: () => [...items, ...(provider === "claude-plan" ? [{ title: "Search the web", examples: ["x", "y"] }] : [])] });
  await tick(5);
  assert.deepEqual(h.types(), ["ready", "info", "capabilities"]);
  assert.deepEqual(h.events()[2], { type: "capabilities", items });
  h.clear();
  await h.send({ type: "model.set", provider: "claude-plan", model: "m" });
  assert.deepEqual(h.types(), ["info", "capabilities"]);
  assert.deepEqual(h.events()[1], { type: "capabilities", items: [...items, { title: "Search the web", examples: ["x", "y"] }] });
});

test("plan usage is forwarded as plan.usage, sanitised; nothing is sent once quit", async () => {
  let report: ((usage: Record<string, unknown>) => void) | undefined;
  let stopped = 0;
  const h = islandHarness({
    onPlanUsage: (listener) => {
      report = listener;
      return () => stopped++;
    },
  });
  await tick(5);
  h.clear();
  report!({ fiveHour: 0.42, sevenDay: 0.12, overage: false });
  report!({ fiveHour: 3, sevenDay: Number.NaN, overage: "yes", accessToken: "secret" });
  report!({ fiveHour: 0.5, sevenDay: 2.5, resetsAt: 1_760_000_000 });
  assert.deepEqual(h.events(), [
    { type: "plan.usage", fiveHour: 0.42, sevenDay: 0.12, overage: false },
    { type: "plan.usage", fiveHour: 0.5 },
  ]);
  h.session.quit();
  assert.equal(stopped, 1);
});

test("thread.get lists the run's tool calls (B3.1), and a new call sends the open thread again", async () => {
  const { h, store } = helperHarness();
  await tick(5);
  const sid = store.addJob("sid", "Research");
  store.start(sid.id);
  await h.send({ type: "thread.get", id: sid.id });
  assert.equal((h.events().at(-1) as Extract<IslandEvent, { type: "thread" }>).toolCalls, undefined, "none: no key");
  h.clear();
  store.recordToolCall(sid.id, { id: "c1", tool: "WebSearch", input: "tcp", state: "started", at: "2026-10-13T10:00:00.000Z" });
  store.recordToolCall(sid.id, { id: "c1", tool: "", input: "", state: "ok", result: "found", at: "2026-10-13T10:00:00.500Z" });
  store.recordToolCall(sid.id, { id: "c2", tool: "Read", input: "/a.ts", state: "started", at: "2026-10-13T10:00:01.000Z" }); // a start sends the thread
  await tick(5);
  const thread = h.events().filter((e) => e.type === "thread").at(-1) as Extract<IslandEvent, { type: "thread" }>;
  assert.deepEqual(thread.toolCalls, [
    { id: "c1", tool: "WebSearch", input: "tcp", state: "ok", result: "found", at: "2026-10-13T10:00:00.000Z", ms: 500 },
    { id: "c2", tool: "Read", input: "/a.ts", state: "started", at: "2026-10-13T10:00:01.000Z" },
  ]);
});

// B3.4, ADR-101: the thread lists the files a run changed, and job.undo puts them back.
test("thread has checkpoints and bashRan; job.undo restores, refuses a conflict in words, and the next thread shows it", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-undo-")));
  try {
    const folder = join(home, "work");
    mkdirSync(folder);
    const store = openHelperStore({ path: ":memory:", home, checkpointsDir: join(home, "cp") });
    store.addGrant("kame", folder);
    const h = islandHarness({ helpers: islandHelpers(store, async () => [], () => PLAN_MODELS) });
    await tick(5);
    const { id } = store.addJob("kame", "edit");
    store.start(id);
    await h.send({ type: "thread.get", id });
    const bare = h.events().at(-1) as Extract<IslandEvent, { type: "thread" }>;
    assert.deepEqual([bare.checkpoints, bare.bashRan], [undefined, undefined], "no keys when empty");
    writeFileSync(join(folder, "a.txt"), "one");
    store.checkpoint(id, [folder], join(folder, "a.txt"));
    store.checkpoint(id, [folder], join(folder, ".env"));
    writeFileSync(join(folder, "a.txt"), "two");
    store.recordToolCall(id, { id: "c1", tool: "Bash", input: "ls", state: "started", at: "2026-10-13T10:00:00.000Z" });
    store.finishCheckpoints(id);
    store.finish(id, { title: "T", summary: "S", body: "B", sources: [] });
    await tick(5);
    const thread = () => h.events().filter((e) => e.type === "thread").at(-1) as Extract<IslandEvent, { type: "thread" }>;
    assert.deepEqual(thread().checkpoints, [
      { path: "a.txt", kind: "modified", state: "ready" },
      { path: ".env", kind: "created", state: "skipped", reason: "secret file" },
    ]);
    assert.equal(thread().bashRan, true);
    // a file changed after the run: "changed", and a plain undo is told in words
    writeFileSync(join(folder, "a.txt"), "later");
    h.clear();
    await h.send({ type: "job.undo", id });
    assert.deepEqual(h.types().filter((t) => t !== "helpers"), ["thread", "error"]);
    assert.match((h.events().find((e) => e.type === "error") as { message: string }).message, /1 of 1 files not undone: changed since the run/);
    assert.equal(thread().checkpoints![0]!.state, "changed");
    assert.equal(readFileSync(join(folder, "a.txt"), "utf8"), "later");
    h.clear();
    await h.send({ type: "job.undo", id, path: "a.txt", force: true });
    assert.equal(h.types().includes("error"), false);
    assert.equal(readFileSync(join(folder, "a.txt"), "utf8"), "one");
    assert.equal(thread().checkpoints![0]!.state, "undone");
    // an unknown task is refused
    h.clear();
    await h.send({ type: "job.undo", id: 4040 });
    assert.deepEqual(h.types(), ["error"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("job.undo without helpers is refused", async () => {
  const h = islandHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "job.undo", id: 1 });
  assert.deepEqual(h.types(), ["error"]);
});

test("skill.hub.*: search, preview and approve reach the helpers event as skillHub; refusals are errors; no hub means refused (B3.5)", async () => {
  const skillsDir = mkdtempSync(join(tmpdir(), "atom-skills-"));
  try {
    const store = openHelperStore({ path: ":memory:", home: mkdtempSync(join(tmpdir(), "atom-home-")), skillsDir });
    const sha = "9".repeat(40);
    const client = {
      searchHub: async () => [{ name: "pdf-tools", description: "PDFs.", repo: "anthropics/skills", path: "skills/pdf-tools/SKILL.md", sha, source: 0 }],
      fetchSkill: async (_s: number, path: string) => ({ repo: "anthropics/skills", path, sha, text: "---\nname: x\ndescription: PDFs.\n---\n\nSteps.\n" }),
    } as never;
    const h = islandHarness({ helpers: { ...islandHelpers(store, async () => []), hub: createHubCommands({ store, client, log: { info() {} } }) } });
    await tick(5);
    await h.send({ type: "skill.hub.search", query: "pdf" });
    await tick(5);
    assert.deepEqual((h.events().at(-1) as HelpersEvent).skillHub!.results.map((r) => r.name), ["pdf-tools"]);
    await h.send({ type: "skill.hub.preview", source: 0, path: "skills/pdf-tools/SKILL.md" });
    await tick(5);
    const pending = (h.events().at(-1) as HelpersEvent).skillHub!.pending;
    assert.deepEqual(pending.map((p) => [p.kind, p.name, p.flags]), [["new", "pdf-tools", []]]);
    assert.equal(existsSync(join(skillsDir, "pdf-tools")), false);
    await h.send({ type: "skill.hub.approve", id: pending[0]!.id });
    await tick(5);
    const event = h.events().at(-1) as HelpersEvent;
    assert.deepEqual(event.skillHub!.installed.map((i) => i.name), ["pdf-tools"]);
    assert.ok(existsSync(join(skillsDir, "pdf-tools", "SKILL.md")));
    h.clear();
    await h.send({ type: "skill.hub.reject", id: 99 });
    assert.deepEqual(h.types(), ["error"]);
    assert.match((h.events()[0] as { message: string }).message, /No skill from the hub waits/);
    await h.send({ type: "skill.hub.uninstall", name: "pdf-tools" });
    assert.equal(existsSync(join(skillsDir, "pdf-tools")), false);
    const off = islandHarness({ helpers: islandHelpers(openHelperStore({ path: ":memory:" }), async () => []) });
    await tick(5);
    off.clear();
    await off.send({ type: "skill.hub.search", query: "pdf" });
    await off.send({ type: "skill.hub.approve", id: 1 });
    assert.deepEqual(off.types(), ["error", "error"]);
  } finally {
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

// ADR-107: projects in the chats event, chat.new in a project, chat.rename, and the project commands.
function projectHarness(over: { renameFails?: boolean } = {}) {
  const calls: string[] = [];
  const item = { id: "p-1", name: "Haat", folderLabel: "~/Developer/haat", missing: false, archived: false, chatCount: 2, web: false, agent: "haat-coder" };
  let session = "chat-new";
  const saved = new Map<string, { title: string; projectId?: string; turns: number }>([["c1", { title: "In project", projectId: "p-1", turns: 4 }], ["c2", { title: "Plain", turns: 2 }]]);
  const h = islandHarness({
    core: {
      handle: async () => ({ text: "x" }),
      reset: () => {
        calls.push("reset");
        session = `chat-${calls.filter((c) => c === "reset").length}`;
      },
      resume: (id, turns) => void ((session = id), calls.push(`resume:${id}:${turns.length}`)),
      get sessionId() {
        return session;
      },
    },
    chats: {
      list: () => [...saved].map(([id, c]) => ({ id, title: c.title, updatedAt: "2026-10-11T00:00:00.000Z", messages: c.turns, ...(c.projectId ? { projectId: c.projectId } : {}) })),
      messages: (id) => Array.from({ length: saved.get(id)?.turns ?? 0 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `m${i}` })),
      remove: (id) => saved.delete(id),
      onChange: () => () => {},
      projectOf: (id) => saved.get(id)?.projectId ?? (id === "chat-1" ? "p-1" : undefined),
      replay: (id, turns) => (saved.get(id)?.projectId ? { turns: turns.slice(-2), trimmed: turns.length > 2 } : { turns, trimmed: false }),
      rename: (id, title) => {
        calls.push(`rename:${id}:${title}`);
        if (over.renameFails) return { error: "That chat is not saved yet." };
        const chat = saved.get(id);
        if (chat) chat.title = title;
        return chat ? { ok: true } : { error: "That chat is not saved yet." };
      },
    },
    projects: {
      list: () => [item],
      add: (name, path) => (calls.push(`add:${name}:${path}`), name === "bad" ? { error: "Hidden folders cannot be granted." } : { ok: true }),
      rename: (id, name) => (calls.push(`rename-project:${id}:${name}`), { ok: true }),
      remove: (id, deleteChats) => (calls.push(`remove:${id}:${deleteChats}`), { ok: true }),
      archive: (id, archived) => (calls.push(`archive:${id}:${archived}`), { ok: true }),
      setModel: (id, provider, model) => (calls.push(`model:${id}:${provider}:${model}`), { ok: true }),
      setWeb: (id, web) => (calls.push(`web:${id}:${web}`), { ok: true }),
      startChat: (id) => (id === "p-1" ? { ok: true } : { error: "There is no such project." }),
      assign: (chatId, projectId) => void calls.push(`assign:${chatId}:${projectId}`),
    },
  });
  return { h, calls, item };
}

test("projects: the chats event lists them, chats carry their project, and the current chat's project is named", async () => {
  const { h, item } = projectHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "chats.list" });
  const event = h.events()[0] as { chats: { id: string; projectId?: string }[]; projects: unknown[]; currentProjectId?: string };
  assert.deepEqual(event.projects, [item]);
  assert.deepEqual(event.chats.map((c) => [c.id, c.projectId]), [["c1", "p-1"], ["c2", undefined]]);
  assert.equal(event.currentProjectId, undefined);
});

test("projects: without the projects option the chats event has no projects key (older tests keep their shape)", async () => {
  const h = islandHarness({ chats: { list: () => [], messages: () => [], remove: () => true, onChange: () => () => {} } });
  await tick(5);
  h.clear();
  await h.send({ type: "chats.list" });
  assert.equal("projects" in (h.events()[0] as object), false);
});

test("projects: chat.new in a project starts a chat that belongs to it; an unknown or closed project is refused and nothing resets", async () => {
  const { h, calls } = projectHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "chat.new", projectId: "p-1" });
  assert.deepEqual(calls, ["reset", "assign:chat-1:p-1"]);
  assert.deepEqual(h.events()[0], { type: "conversation.reset", projectId: "p-1" });
  h.clear();
  await h.send({ type: "chat.new", projectId: "p-9" });
  assert.deepEqual(calls, ["reset", "assign:chat-1:p-1"], "no reset");
  assert.deepEqual(h.events(), [{ type: "error", stage: "settings", message: "There is no such project." }]);
  h.clear();
  await h.send({ type: "chat.new" });
  assert.deepEqual(h.events()[0], { type: "conversation.reset" });
  h.clear();
  await h.send({ type: "conversation.reset" });
  assert.deepEqual(h.events()[0], { type: "conversation.reset" }, "the old command is a chat.new without a project");
  assert.equal(calls.filter((c) => c.startsWith("assign")).length, 1);
});

test("projects: chat.new with projects off is refused", async () => {
  const h = islandHarness({ chats: { list: () => [], messages: () => [], remove: () => true, onChange: () => () => {} } });
  await tick(5);
  h.clear();
  await h.send({ type: "chat.new", projectId: "p-1" });
  assert.deepEqual(h.events(), [{ type: "error", stage: "settings", message: "Projects are off." }]);
});

test("projects: opening a project chat names its project, replays a capped copy to the Core and says trimmed", async () => {
  const { h, calls } = projectHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "chat.open", id: "c1" });
  const opened = h.events()[0] as { type: string; projectId?: string; trimmed?: boolean; messages: unknown[] };
  assert.equal(opened.type, "chat.opened");
  assert.equal(opened.projectId, "p-1");
  assert.equal(opened.trimmed, true);
  assert.equal(opened.messages.length, 4, "the window still shows every turn");
  assert.ok(calls.includes("resume:c1:2"), "the Core got the capped turns");
  h.clear();
  await h.send({ type: "chat.open", id: "c2" });
  const plain = h.events()[0] as Record<string, unknown>;
  assert.equal("projectId" in plain, false);
  assert.equal("trimmed" in plain, false);
  assert.ok(calls.includes("resume:c2:2"));
});

test("projects: each project command reaches the runtime and is answered with the chats event; a refusal is an error", async () => {
  const { h, calls } = projectHarness();
  await tick(5);
  h.clear();
  await h.send(
    { type: "project.add", name: "Haat", path: "/Users/k/Developer/haat" },
    { type: "project.rename", id: "p-1", name: "Haat 2" },
    { type: "project.archive", id: "p-1", archived: true },
    { type: "project.model", id: "p-1", provider: "claude-plan", model: "opus" },
    { type: "project.web", id: "p-1", web: true },
    { type: "project.remove", id: "p-1" },
    { type: "project.remove", id: "p-1", deleteChats: true },
  );
  assert.deepEqual(calls, [
    "add:Haat:/Users/k/Developer/haat",
    "rename-project:p-1:Haat 2",
    "archive:p-1:true",
    "model:p-1:claude-plan:opus",
    "web:p-1:true",
    "remove:p-1:false",
    "remove:p-1:true",
  ]);
  assert.deepEqual(h.types(), Array(7).fill("chats"));
  h.clear();
  await h.send({ type: "project.add", name: "bad", path: "/Users/k/.ssh" });
  assert.deepEqual(h.events(), [{ type: "error", stage: "settings", message: "Hidden folders cannot be granted." }]);
});

test("projects: project commands with projects off are refused, not ignored", async () => {
  const h = islandHarness();
  await tick(5);
  h.clear();
  await h.send({ type: "project.add", name: "x", path: "/a" }, { type: "project.web", id: "p-1", web: true });
  assert.deepEqual(h.events(), [
    { type: "error", stage: "settings", message: "Projects are off." },
    { type: "error", stage: "settings", message: "Projects are off." },
  ]);
});

test("chat.rename: renames a chat the window writes; Telegram and API chats refuse; a chat not saved yet says so", async () => {
  const saved = new Map([["telegram", "Telegram"], ["api", "api"], ["api-ci", "api"], ["chat-a", "Plan"]]);
  const renamed: string[] = [];
  const h = islandHarness({
    chats: {
      list: () => [...saved].map(([id, title]) => ({ id, title, updatedAt: "2026-10-11T00:00:00.000Z", messages: 2 })),
      messages: () => [],
      remove: () => true,
      onChange: () => () => {},
      rename: (id, title) => (id === "chat-a" ? (renamed.push(`${id}:${title}`), saved.set(id, title), { ok: true }) : { error: "That chat is not saved yet." }),
    },
  });
  await tick(5);
  h.clear();
  await h.send({ type: "chat.rename", id: "chat-a", title: "Trip to Tokyo" });
  assert.deepEqual(renamed, ["chat-a:Trip to Tokyo"]);
  assert.deepEqual(h.types(), ["chats"]);
  assert.equal((h.events()[0] as { chats: { id: string; title: string }[] }).chats.find((c) => c.id === "chat-a")!.title, "Trip to Tokyo");
  for (const [id, who] of [["telegram", "Telegram"], ["api", "the local API"], ["api-ci", "the local API"]] as const) {
    h.clear();
    await h.send({ type: "chat.rename", id, title: "Mine" });
    assert.deepEqual(h.events(), [{ type: "error", stage: "settings", message: `This chat is written from ${who}. Open it to read it only.` }], id);
  }
  assert.deepEqual(renamed, ["chat-a:Trip to Tokyo"], "the read-only chats were never renamed");
  h.clear();
  await h.send({ type: "chat.rename", id: "ghost", title: "x" });
  assert.deepEqual(h.events(), [{ type: "error", stage: "settings", message: "That chat is not saved yet." }]);
});

// ADR-109: a goal's result posted into the chat that is open is shown without reopening it.
test("a result posted into the open chat re-sends chat.opened; a chat that is not open sends nothing", async () => {
  const saved = new Map([["chat-a", [{ role: "user" as const, content: "check" }, { role: "assistant" as const, content: "on it" }]]]);
  let listener: ((id: string) => void) | undefined;
  const resumed: string[] = [];
  const h = islandHarness({
    core: {
      handle: async () => ({ text: "x" }),
      reset: () => {},
      resume: (id) => void resumed.push(id),
      get sessionId() {
        return "chat-a";
      },
    },
    chats: {
      list: () => [],
      messages: (id) => saved.get(id) ?? [],
      remove: () => true,
      onChange: () => () => {},
      onPosted: (l) => ((listener = l), () => {}),
    },
  });
  await tick(5);
  h.clear();
  saved.get("chat-a")!.push({ role: "assistant", content: "Kame finished: storage" });
  listener!("chat-other");
  assert.deepEqual(h.events(), []);
  listener!("chat-a");
  assert.deepEqual(h.events()[0], {
    type: "chat.opened",
    id: "chat-a",
    messages: [{ role: "user", text: "check" }, { role: "assistant", text: "on it" }, { role: "assistant", text: "Kame finished: storage" }],
  });
  assert.deepEqual(resumed, [], "the runtime already gave the Core the turn");
});
