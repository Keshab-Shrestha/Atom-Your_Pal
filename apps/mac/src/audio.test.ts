import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { AudioError, parseAudioDevices, peakLevel, startRecording } from "./audio.ts";

const SETTINGS = { inputDevice: ":default", sampleRate: 16_000 };

class FakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  signals: string[] = [];
  args: string[] = [];
  /** When false, the process ignores SIGINT (simulates a hung device). */
  exitOnInterrupt = true;

  kill(signal: string) {
    this.signals.push(signal);
    if (signal === "SIGKILL" || this.exitOnInterrupt) setImmediate(() => this.emit("close", 255));
    return true;
  }
}

function fakeSpawn(fake: FakeProcess) {
  return (_command: string, args: string[]) => {
    fake.args = args;
    return fake as unknown as ChildProcess;
  };
}

test("records until stopped and returns 16-bit mono PCM", async () => {
  const fake = new FakeProcess();
  let ready = 0;
  const recording = startRecording(SETTINGS, { spawn: fakeSpawn(fake), onReady: () => ready++ });
  assert.equal(ready, 0);
  fake.stdout.write(Buffer.alloc(16_000)); // 8000 samples = 0.5 s
  fake.stdout.write(Buffer.alloc(16_000));
  await new Promise(setImmediate);
  assert.equal(ready, 1);

  const clip = await recording.stop();
  assert.equal(clip.pcm.length, 32_000);
  assert.equal(clip.sampleRate, 16_000);
  assert.equal(clip.durationMs, 1000);
  assert.deepEqual(fake.signals, ["SIGINT"]);
  assert.deepEqual(fake.args.slice(fake.args.indexOf("-i"), fake.args.indexOf("-i") + 2), ["-i", ":default"]);
  assert.ok(fake.args.includes("16000"));
});

test("drops a trailing partial sample", async () => {
  const fake = new FakeProcess();
  const recording = startRecording(SETTINGS, { spawn: fakeSpawn(fake) });
  fake.stdout.write(Buffer.alloc(5));
  await new Promise(setImmediate);
  assert.equal((await recording.stop()).pcm.length, 4);
});

test("kills ffmpeg if it does not exit after interrupt", async () => {
  const fake = new FakeProcess();
  fake.exitOnInterrupt = false;
  const recording = startRecording(SETTINGS, { spawn: fakeSpawn(fake), stopTimeoutMs: 10 });
  fake.stdout.write(Buffer.alloc(320));
  await new Promise(setImmediate);

  const clip = await recording.stop();
  assert.deepEqual(fake.signals, ["SIGINT", "SIGKILL"]);
  assert.equal(clip.pcm.length, 320);
});

test("missing ffmpeg is reported immediately with an install hint", async () => {
  const fake = new FakeProcess();
  const failures: AudioError[] = [];
  const recording = startRecording(SETTINGS, { spawn: fakeSpawn(fake), onFailure: (e) => failures.push(e) });
  fake.emit("error", Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }));

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /ffmpeg not found\. Install it with: brew install ffmpeg/);
  await assert.rejects(recording.stop(), /ffmpeg not found/);
});

test("device failure before stop is reported with ffmpeg's error", async () => {
  const fake = new FakeProcess();
  const failures: AudioError[] = [];
  startRecording(SETTINGS, { spawn: fakeSpawn(fake), onFailure: (e) => failures.push(e) });
  fake.stderr.write("Error opening input: Input/output error\n");
  await new Promise(setImmediate);
  fake.emit("close", 1);

  assert.equal(failures.length, 1);
  assert.ok(failures[0] instanceof AudioError);
  assert.match(failures[0].message, /Microphone ":default" failed \(exit code 1\)/);
  assert.match(failures[0].message, /Input\/output error/);
});

test("stopping with no audio is an error", async () => {
  const fake = new FakeProcess();
  const recording = startRecording(SETTINGS, { spawn: fakeSpawn(fake) });
  await assert.rejects(recording.stop(), (error: unknown) => {
    assert.ok(error instanceof AudioError);
    assert.match(error.message, /No audio captured/);
    return true;
  });
});

test("parses audio devices from ffmpeg's device list", () => {
  const output = [
    "[AVFoundation indev @ 0x1] AVFoundation video devices:",
    "[AVFoundation indev @ 0x1] [0] FaceTime HD Camera",
    "[AVFoundation indev @ 0x1] [1] Capture screen 0",
    "[AVFoundation indev @ 0x1] AVFoundation audio devices:",
    "[AVFoundation indev @ 0x1] [0] iPhone Microphone",
    "[AVFoundation indev @ 0x1] [1] Webcam internal mic",
    '[in#0 @ 0x2] Error opening input: Input/output error',
  ].join("\n");
  assert.deepEqual(parseAudioDevices(output), ["iPhone Microphone", "Webcam internal mic"]);
});

test("peak level of 16-bit PCM", () => {
  const pcm = Buffer.alloc(6);
  pcm.writeInt16LE(1000, 0);
  pcm.writeInt16LE(-16384, 2);
  pcm.writeInt16LE(200, 4);
  assert.equal(peakLevel(pcm), 0.5);
  assert.equal(peakLevel(Buffer.alloc(0)), 0);
});
