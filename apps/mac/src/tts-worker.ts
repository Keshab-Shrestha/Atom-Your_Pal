// Runs Kokoro on its own thread: synthesis is CPU-bound and would otherwise freeze
// ZENO's main thread (key presses, playback control) for seconds per sentence.
import { parentPort, workerData } from "node:worker_threads";

type Request = { id: number; text: string };
const { modelId, voice, dtype, speed, cacheDir } = workerData as {
  modelId: string;
  voice: string;
  dtype: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  speed: number;
  cacheDir: string;
};

async function load() {
  const { env } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained(modelId, { dtype, device: "cpu" });
  const voices = Object.keys(tts.voices);
  if (!voices.includes(voice)) throw Object.assign(new Error(`Unknown Kokoro voice "${voice}". Available: ${voices.join(", ")}`), { known: true });
  return tts;
}

const ready = load();
ready.then(
  () => parentPort!.postMessage({ type: "ready" }),
  (error: Error & { known?: boolean }) => parentPort!.postMessage({ type: "load-error", message: error.message, known: error.known === true }),
);

parentPort!.on("message", async ({ id, text }: Request) => {
  try {
    const tts = await ready;
    const result = await tts.generate(text, { voice: voice as never, speed });
    const samples = result.audio as Float32Array;
    parentPort!.postMessage({ type: "audio", id, samples, sampleRate: result.sampling_rate }, [samples.buffer as ArrayBuffer]);
  } catch (error) {
    parentPort!.postMessage({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  }
});
