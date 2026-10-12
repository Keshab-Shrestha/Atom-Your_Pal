import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SttError, cleanTranscript, createWhisperStt, promptArgs, toWav } from "./stt.ts";

const clip = { pcm: Buffer.alloc(3200), sampleRate: 16_000, durationMs: 100 };

function fakeExec(result: { stdout?: string; stderr?: string; error?: object | null }, calls: string[][] = []) {
  return ((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
    calls.push(args);
    const wav = args[args.indexOf("-f") + 1];
    assert.ok(existsSync(wav), "WAV file exists while whisper runs");
    cb(result.error ?? null, result.stdout ?? "", result.stderr ?? "");
  }) as never;
}

test("toWav writes a valid 16-bit mono header", () => {
  const wav = toWav(clip);
  assert.equal(wav.length, 44 + 3200);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 3200);
});

test("cleanTranscript strips non-speech markers and whitespace", () => {
  assert.equal(cleanTranscript("\n Hello Zeno,\n what time is it? \n"), "Hello Zeno, what time is it?");
  assert.equal(cleanTranscript(" [BLANK_AUDIO]\n"), "");
  assert.equal(cleanTranscript("(music) hi [Laughter]"), "hi");
});

test("transcribes through whisper-cli and cleans up the temporary file", async () => {
  const calls: string[][] = [];
  const stt = createWhisperStt({
    modelPath: "model.bin",
    fileExists: () => true,
    execFile: fakeExec({ stdout: "\n Hello there.\n" }, calls),
  });
  assert.equal(await stt.transcribe(clip), "Hello there.");
  const args = calls[0];
  assert.deepEqual(args.slice(0, 2), ["-m", "model.bin"]);
  assert.ok(args.includes("-nt") && args.includes("-np"));
  assert.equal(existsSync(args[args.indexOf("-f") + 1]), false, "temporary WAV is removed");
});

test("missing model gives a download hint", async () => {
  const stt = createWhisperStt({ modelPath: "models/ggml-small.en.bin", fileExists: () => false, execFile: fakeExec({}) });
  await assert.rejects(stt.transcribe(clip), (error: unknown) => {
    assert.ok(error instanceof SttError);
    assert.match(error.message, /Whisper model not found at "models\/ggml-small\.en\.bin"/);
    assert.match(error.message, /curl -L -o models\/ggml-small\.en\.bin https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\/ggml-small\.en\.bin/);
    return true;
  });
});

test("missing whisper-cli gives an install hint", async () => {
  const stt = createWhisperStt({
    modelPath: "m.bin",
    fileExists: () => true,
    execFile: fakeExec({ error: Object.assign(new Error("spawn"), { code: "ENOENT" }) }),
  });
  await assert.rejects(stt.transcribe(clip), /whisper-cli not found\. Install it with: brew install whisper-cpp/);
});

test("timeout and failure are reported", async () => {
  const timedOut = createWhisperStt({
    modelPath: "m.bin",
    timeoutMs: 5,
    fileExists: () => true,
    execFile: fakeExec({ error: Object.assign(new Error("killed"), { killed: true }) }),
  });
  await assert.rejects(timedOut.transcribe(clip), /Transcription timed out after 5 ms/);

  const failed = createWhisperStt({
    modelPath: "m.bin",
    fileExists: () => true,
    execFile: fakeExec({ error: Object.assign(new Error("x"), { code: 3 }), stderr: "error: failed to initialize whisper context\n" }),
  });
  await assert.rejects(failed.transcribe(clip), /Transcription failed \(exit code 3\)\. error: failed to initialize whisper context/);
});

const MODEL = "models/ggml-base.en.bin";
const canRunReal = existsSync(MODEL) && process.platform === "darwin";

test("real whisper.cpp transcribes synthesized speech", { skip: !canRunReal && "whisper model not downloaded" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-stt-test-"));
  const wav = join(dir, "speech.wav");
  execFileSync("say", ["-o", wav, "--data-format=LEI16@16000", "What is the weather like today?"]);
  // Decode to raw PCM (say's WAV has extra chunks, so the header is not a fixed size).
  const pcm = execFileSync("ffmpeg", ["-loglevel", "error", "-i", wav, "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"]);
  const stt = createWhisperStt({ modelPath: MODEL });
  const text = await stt.transcribe({ pcm, sampleRate: 16_000, durationMs: 0 });
  assert.match(text.toLowerCase(), /weather like today/);
});

test("a model path that is not a standard whisper.cpp file name gets a setting hint, not a broken link", async () => {
  const stt = createWhisperStt({ modelPath: "models/nope.bin", language: "en", fileExists: () => false });
  await assert.rejects(stt.transcribe({ pcm: Buffer.alloc(3200), sampleRate: 16_000, durationMs: 100 }), (error: Error) => {
    assert.match(error.message, /Set ATOM_STT_MODEL in \.env to a whisper\.cpp model file such as models\/ggml-base\.en\.bin/);
    assert.doesNotMatch(error.message, /resolve\/main\/nope\.bin/);
    return true;
  });
});

test("vocabulary becomes Whisper's initial prompt; none means no prompt", async () => {
  assert.deepEqual(promptArgs(""), []);
  assert.deepEqual(promptArgs(" , "), []);
  assert.deepEqual(promptArgs("ATOM, Keshab ,Kathmandu"), ["--prompt", "ATOM, Keshab, Kathmandu."]);

  const calls: string[][] = [];
  const stt = createWhisperStt({
    modelPath: "model.bin",
    vocabulary: "ATOM, Keshab",
    fileExists: () => true,
    execFile: fakeExec({ stdout: "Hi ATOM" }, calls),
  });
  await stt.transcribe(clip);
  const args = calls[0];
  assert.equal(args[args.indexOf("--prompt") + 1], "ATOM, Keshab.");
});
