import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createKokoroSynthesizer, KOKORO_MODEL_ID } from "./tts.ts";

// Runs real Kokoro only if the model is already downloaded (no network in normal test runs).
const cached = existsSync(`models/huggingface/${KOKORO_MODEL_ID}/onnx/model_quantized.onnx`);

test("real Kokoro synthesizes speech", { skip: !cached && "Kokoro model not downloaded (run pnpm start once)" }, async () => {
  const synth = createKokoroSynthesizer({ voice: "af_heart" });
  await synth.load();
  const audio = await synth.synthesize("Hello from ATOM.");
  assert.equal(audio.sampleRate, 24_000);
  const seconds = audio.samples.length / audio.sampleRate;
  assert.ok(seconds > 0.5 && seconds < 5, `unexpected duration ${seconds}s`);
  assert.ok(audio.samples.some((s) => Math.abs(s) > 0.05), "audio is not silent");
});

test("unknown voice is a clear error", { skip: !cached && "Kokoro model not downloaded" }, async () => {
  await assert.rejects(createKokoroSynthesizer({ voice: "nope" }).load(), /Unknown Kokoro voice "nope"\. Available: .*af_heart/);
});
