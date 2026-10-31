import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { createSpeaker, openFfmpegSink, splitFirstClause, splitSentences, toSpeakable, type AudioSink, type SpeechAudio, type Synthesizer } from "./tts.ts";

const tag = (text: string) => new Float32Array([text.length]);

function fakeSynth(log: string[]): Synthesizer & { loads: number } {
  const s = {
    loads: 0,
    async load() {
      s.loads++;
      log.push("load");
    },
    async synthesize(text: string): Promise<SpeechAudio> {
      log.push(`synth:${text}`);
      await new Promise((r) => setTimeout(r, 2));
      return { samples: tag(text), sampleRate: 24_000 };
    },
  };
  return s;
}

function fakeSink(log: string[]) {
  let opened = 0;
  let finishPlayback: () => void = () => {};
  const open = (rate: number): AudioSink => {
    opened++;
    log.push(`open:${rate}`);
    return {
      write: (samples) => log.push(`write:${samples[0]}`),
      finish: () => {
        log.push("finish");
        return new Promise<void>((r) => (finishPlayback = r));
      },
      stop: () => {
        log.push("stop");
        finishPlayback();
      },
    };
  };
  return { open, opened: () => opened, endPlayback: () => finishPlayback() };
}

test("splitSentences splits on sentence ends and merges short fragments", () => {
  assert.deepEqual(splitSentences("Hello there, Keshab. How are you today? I am fine!"), [
    "Hello there, Keshab.",
    "How are you today?",
    "I am fine!",
  ]);
  assert.deepEqual(splitSentences("  Ok.  That is all for now. "), ["Ok. That is all for now."]);
  assert.deepEqual(splitSentences("No punctuation at the end"), ["No punctuation at the end"]);
  assert.deepEqual(splitSentences("   "), []);
});

test("streams every sentence, in order, into one audio sink", async () => {
  const log: string[] = [];
  const sink = fakeSink(log);
  const done = createSpeaker(fakeSynth(log), sink.open).speak("First sentence here. Second one here.");
  await new Promise((r) => setTimeout(r, 30));
  sink.endPlayback();
  await done;
  assert.deepEqual(log, [
    "load",
    "synth:First sentence here.",
    "open:24000",
    "write:20",
    "synth:Second one here.",
    "write:16",
    "finish",
  ]);
  assert.equal(sink.opened(), 1);
});

test("warmUp loads once, even when called repeatedly", async () => {
  const synth = fakeSynth([]);
  const sink = fakeSink([]);
  const speaker = createSpeaker(synth, sink.open);
  await Promise.all([speaker.warmUp(), speaker.warmUp()]);
  const done = speaker.speak("Hello there, friend.");
  await new Promise((r) => setTimeout(r, 20));
  sink.endPlayback();
  await done;
  assert.equal(synth.loads, 1);
});

test("a failed load can be retried", async () => {
  let attempts = 0;
  const synth: Synthesizer = {
    async load() {
      if (++attempts === 1) throw new Error("offline");
    },
    async synthesize() {
      return { samples: new Float32Array(1), sampleRate: 24_000 };
    },
  };
  const speaker = createSpeaker(synth, fakeSink([]).open);
  await assert.rejects(speaker.warmUp(), /offline/);
  await speaker.warmUp();
  assert.equal(attempts, 2);
});

test("aborting during playback stops the sink at once", async () => {
  const log: string[] = [];
  const controller = new AbortController();
  const done = createSpeaker(fakeSynth(log), fakeSink(log).open).speak("First sentence here. Second one here.", controller.signal);
  await new Promise((r) => setTimeout(r, 30)); // everything written, now "playing"
  controller.abort();
  await done;
  assert.equal(log.at(-1), "stop");
});

test("aborting during synthesis writes nothing further", async () => {
  const log: string[] = [];
  const controller = new AbortController();
  const done = createSpeaker(fakeSynth(log), fakeSink(log).open).speak("First sentence here. Second one here.", controller.signal);
  await new Promise((r) => setTimeout(r, 0));
  controller.abort();
  await done;
  assert.ok(!log.some((l) => l.startsWith("write")), log.join(","));
});

test("empty text does nothing", async () => {
  const log: string[] = [];
  await createSpeaker(fakeSynth(log), fakeSink(log).open).speak("   ");
  assert.deepEqual(log, []);
});

class FakeFfmpeg extends EventEmitter {
  stdin = new PassThrough();
  stderr = new PassThrough();
  written: Buffer[] = [];
  signal: string | null = null;
  constructor() {
    super();
    this.stdin.on("data", (d: Buffer) => this.written.push(d));
  }
  kill(signal: string) {
    this.signal = signal;
    queueMicrotask(() => this.emit("close", null));
    return true;
  }
}

test("ffmpeg sink pipes float samples to the default output and waits for playback", async () => {
  const child = new FakeFfmpeg();
  let args: string[] = [];
  const sink = openFfmpegSink(24_000, {
    spawn: (cmd, a) => {
      assert.equal(cmd, "ffmpeg");
      args = a;
      return child as unknown as ChildProcessByStdio<Writable, null, Readable>;
    },
  });
  assert.deepEqual(args.slice(args.indexOf("-f"), args.indexOf("-f") + 6), ["-f", "f32le", "-ar", "24000", "-ac", "1"]);
  assert.ok(args.join(" ").includes("-f audiotoolbox"));
  sink.write(new Float32Array([0.5, -0.5]));
  const finished = sink.finish();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(Buffer.concat(child.written).length, 8);
  child.emit("close", 0);
  await finished;
});

test("ffmpeg sink stop kills playback immediately", async () => {
  const child = new FakeFfmpeg();
  const sink = openFfmpegSink(24_000, { spawn: () => child as unknown as ChildProcessByStdio<Writable, null, Readable> });
  sink.stop();
  await sink.finish();
  assert.equal(child.signal, "SIGKILL");
});

test("ffmpeg sink reports a failed exit", async () => {
  const child = new FakeFfmpeg();
  const sink = openFfmpegSink(24_000, { spawn: () => child as unknown as ChildProcessByStdio<Writable, null, Readable> });
  child.stderr.write("Could not open audio device\n");
  await new Promise((r) => setTimeout(r, 5));
  child.emit("close", 1);
  await assert.rejects(sink.finish(), /ffmpeg exit code 1\): Could not open audio device/);
});

test("splitFirstClause splits only a long opening sentence, at its first comma", () => {
  const long = "Roughly fourteen million people live in Tokyo, though the greater metro area has about thirty-seven million.";
  assert.deepEqual(splitFirstClause([long, "And your name is Keshab!"]), [
    "Roughly fourteen million people live in Tokyo,",
    "though the greater metro area has about thirty-seven million.",
    "And your name is Keshab!",
  ]);
  assert.deepEqual(splitFirstClause(["Hello Keshab, nice to meet you."]), ["Hello Keshab, nice to meet you."]); // short: kept
  assert.deepEqual(splitFirstClause(["Yes, that is right and it is a really long sentence without another pause in it."]), [
    "Yes, that is right",
    "and it is a really long sentence without another pause in it.",
  ]); // comma too early: cut before "and" instead // clause before the comma too short to sound natural alone
  assert.deepEqual(splitFirstClause([]), []);
});

test("close stops speech in progress and releases the synthesizer", async () => {
  const log: string[] = [];
  const synth = { ...fakeSynth(log), close: () => log.push("close") };
  const speaker = createSpeaker(synth, fakeSink(log).open);
  const done = speaker.speak("First sentence here. Second one here.");
  await new Promise((r) => setTimeout(r, 30)); // playing
  speaker.close();
  await done;
  assert.deepEqual(log.slice(-2), ["stop", "close"]);
});

test("toSpeakable removes markdown and emoji so they are not read aloud", () => {
  assert.equal(toSpeakable("Plain sentences stay as they are. Really!"), "Plain sentences stay as they are. Really!");
  assert.equal(
    toSpeakable("## Options\nHere are **three** ideas:\n- Fried rice\n- Spinach *omelette*\n1. Soup 🍲"),
    "Options. Here are three ideas: Fried rice. Spinach omelette. Soup.",
  );
  assert.equal(toSpeakable("See [the docs](https://example.com/x) or https://www.nhk.or.jp/news/123 for `details`."), "See the docs or nhk.or.jp for details.");
  assert.equal(toSpeakable("Run this:\n```\nrm -rf /\n```\nThen you are done 👍"), "Run this: Then you are done.");
  assert.equal(toSpeakable("Great job 👏👏"), "Great job.");
  assert.equal(toSpeakable("🎉"), "");
});

test("speak strips markdown before synthesizing", async () => {
  const log: string[] = [];
  const sink = fakeSink(log);
  const done = createSpeaker(fakeSynth(log), sink.open).speak("**Tokyo** is the capital 🇯🇵");
  await new Promise((r) => setTimeout(r, 20));
  sink.endPlayback();
  await done;
  assert.ok(log.includes("synth:Tokyo is the capital."), log.join(" | "));
});

test("streamSentences: each sentence comes out as soon as the next one begins; the rest at the end", async () => {
  const { streamSentences } = await import("./tts.ts");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const out: string[] = [];
  async function* pieces() {
    yield "Hi! It is sunny ";
    yield "in Tokyo today. Tomor";
    await gate;
    yield "row it rains.";
  }
  const it = streamSentences(pieces());
  const reading = (async () => {
    for await (const s of it) out.push(s);
  })();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(out, ["Hi! It is sunny in Tokyo today."], "spoken before the model finished");
  release();
  await reading;
  assert.deepEqual(out, ["Hi! It is sunny in Tokyo today.", "Tomorrow it rains."]);
});

test("streamSentences: a long opening is cut at its first comma; turns split on newlines", async () => {
  const { streamSentences } = await import("./tts.ts");
  async function* pieces() {
    yield "Let me check the weather.\n";
    yield "It is mostly clear right now in Tokyo with sixteen degrees, and tomorrow looks overcast with some rain";
  }
  const out: string[] = [];
  for await (const s of streamSentences(pieces())) out.push(s);
  assert.equal(out[0], "Let me check the weather.");
  assert.ok(out.length >= 2);
  assert.equal(out.join(" ").replace(/\s+/g, " "), "Let me check the weather. It is mostly clear right now in Tokyo with sixteen degrees, and tomorrow looks overcast with some rain.");
});

test("openingCut: a long opening with no comma is cut before a word people pause at", async () => {
  const { openingCut, splitFirstClause } = await import("./tts.ts");
  const s = "The sky appears blue because of a phenomenon called Rayleigh scattering.";
  assert.deepEqual(splitFirstClause([s]), ["The sky appears blue", "because of a phenomenon called Rayleigh scattering."]);
  assert.equal(openingCut("Supercalifragilisticexpialidocious is a very long word indeed without breaks"), -1);
});

test("toSpeakable skips Markdown table rows: the table stays on screen", () => {
  assert.equal(toSpeakable("Here is the table.\n| Name | Age |\n|---|---|\n| Ann | 30 |"), "Here is the table.");
});

test("toSpeakable says a file path as its file name and keeps fractions and dates whole", () => {
  assert.equal(toSpeakable("Open src/app/core.ts now."), "Open core.ts now.");
  assert.equal(toSpeakable("Add 3/4.5 cups on 10/12/2026 and/or more."), "Add 3/4.5 cups on 10/12/2026 and/or more.");
});

test("toSpeakable reads short inline code and skips long inline code", () => {
  assert.equal(toSpeakable("Run `pnpm test` first."), "Run pnpm test first.");
  assert.equal(toSpeakable(`Try \`${"x".repeat(41)}\` today.`), "Try today.");
});

test("toSpeakable drops images, rules, checkboxes and tilde fences", () => {
  assert.equal(toSpeakable("Look ![chart](a.png) here."), "Look here.");
  assert.equal(toSpeakable("One\n---\nTwo"), "One. Two.");
  assert.equal(toSpeakable("- [x] Done\n- [ ] Next"), "Done. Next.");
  assert.equal(toSpeakable("Run this:\n~~~sh\nrm -rf /\n~~~\nDone"), "Run this: Done.");
});

test("toSpeakable returns nothing when no letter or digit is left", () => {
  assert.equal(toSpeakable("...\n---"), "");
});

// 2026-10-16 (review): a "." between digits ended a sentence, so "pi is 3.14159" was spoken as "pi is 3." and "14159 ...".
test("splitSentences keeps decimals, version numbers and times whole", () => {
  assert.deepEqual(splitSentences("The value of pi is 3.14159 and it never ends. The next sentence is here."), ["The value of pi is 3.14159 and it never ends.", "The next sentence is here."]);
  assert.deepEqual(splitSentences("Version 2.5.1 is out and it fixes the crash. Meet at 10.30 tomorrow morning."), ["Version 2.5.1 is out and it fixes the crash.", "Meet at 10.30 tomorrow morning."]);
  assert.deepEqual(splitSentences("It costs 4.99 dollars!"), ["It costs 4.99 dollars!"]);
});
