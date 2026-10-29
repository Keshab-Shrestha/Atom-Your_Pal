// Kokoro runs in its own child process. Synthesis is CPU-bound, and the ONNX runtime aborts the
// whole process if a thread running it is stopped mid-synthesis; a child process can be killed
// at any moment (quit, Ctrl+C) without affecting ATOM, and a Kokoro crash cannot take ATOM down.
type Init = { type: "init"; modelId: string; voice: string; dtype: "fp32" | "fp16" | "q8" | "q4" | "q4f16"; speed: number; cacheDir: string; localFilesOnly?: boolean };
type Request = { type: "synthesize"; id: number; text: string };

const send = (message: unknown) => process.send?.(message);

// If ATOM goes away, leave too.
process.on("disconnect", () => process.exit(0));

let ready: Promise<{ generate(text: string, o: object): Promise<{ audio: Float32Array; sampling_rate: number }> }> | null = null;
let settings: Init;

async function load(init: Init) {
  const { env } = await import("@huggingface/transformers");
  env.cacheDir = init.cacheDir;
  if (init.localFilesOnly) env.allowRemoteModels = false;
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained(init.modelId, { dtype: init.dtype, device: "cpu" });
  const voices = Object.keys(tts.voices);
  if (!voices.includes(init.voice)) {
    throw Object.assign(new Error(`Unknown Kokoro voice "${init.voice}". Available: ${voices.join(", ")}`), { known: true });
  }
  return tts as never;
}

process.on("message", async (message: Init | Request) => {
  if (message.type === "init") {
    settings = message;
    ready = load(message);
    ready.then(
      () => send({ type: "ready" }),
      (error: Error & { known?: boolean }) => send({ type: "load-error", message: error.message, known: error.known === true }),
    );
    return;
  }
  try {
    if (!ready) throw new Error("not initialized");
    const tts = await ready;
    const result = await tts.generate(message.text, { voice: settings.voice, speed: settings.speed });
    send({ type: "audio", id: message.id, samples: result.audio, sampleRate: result.sampling_rate });
  } catch (error) {
    send({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
});
