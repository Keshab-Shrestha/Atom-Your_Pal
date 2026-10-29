import { createKokoroSynthesizer, toSpeakable, type KokoroOptions } from "./tts.ts";
import { toWav, type SpeechToText } from "./stt.ts";

export type ArkVoiceCommand =
  | { type: "ark.voice.run"; request: string; input: { kind: "transcribe"; pcm: string } | { kind: "speak"; text: string } }
  | { type: "ark.voice.cancel"; request: string };
export type ArkVoiceEvent = { type: "ark.voice.result"; request: string; value?: { kind: "transcribe"; text: string } | { kind: "speak"; wav: string }; error?: string };
export function parseArkVoice(value: Record<string, unknown>): ArkVoiceCommand | undefined {
  if (typeof value.request !== "string" || !/^[a-f0-9-]{36}$/i.test(value.request)) return;
  if (value.type === "ark.voice.cancel") return { type: value.type, request: value.request };
  const input = value.input;
  if (value.type !== "ark.voice.run" || !input || typeof input !== "object" || Array.isArray(input)) return;
  const data = input as Record<string, unknown>;
  if (data.kind === "transcribe" && typeof data.pcm === "string" && data.pcm.length <= 2_560_000) return { type: value.type, request: value.request, input: { kind: data.kind, pcm: data.pcm } };
  if (data.kind === "speak" && typeof data.text === "string" && data.text.length <= 8000) return { type: value.type, request: value.request, input: { kind: data.kind, text: data.text } };
  return;
}

export function createArkVoice(stt: SpeechToText, options: KokoroOptions) {
  let emit: (event: ArkVoiceEvent) => void = () => {};
  const active = new Map<string, AbortController>();
  const cancelled = new Set<string>();
  const running = new Set<Promise<void>>();
  let cachedSynthesizer: ReturnType<typeof createKokoroSynthesizer> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const kinds = new Set<"transcribe" | "speak">();
  const run = async (command: Extract<ArkVoiceCommand, { type: "ark.voice.run" }>) => {
    const { request, input } = command;
    if (cancelled.delete(request)) { emit({ type: "ark.voice.result", request, error: "Voice stopped." }); return; }
    if (active.has(request) || kinds.has(input.kind)) { emit({ type: "ark.voice.result", request, error: "This environment is already processing that voice operation. Wait or stop it before starting another." }); return; }
    const controller = new AbortController();
    active.set(request, controller); kinds.add(input.kind);
    let synthesizer: ReturnType<typeof createKokoroSynthesizer> | undefined;
    let synthesized = false;
    let processing: Promise<NonNullable<ArkVoiceEvent["value"]>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const work = async (): Promise<NonNullable<ArkVoiceEvent["value"]>> => {
        if (input.kind === "transcribe") {
          if (input.pcm.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.pcm)) throw new Error("Invalid microphone audio.");
          const pcm = Buffer.from(input.pcm, "base64");
          if (pcm.length < 3200 || pcm.length > 1_920_000 || pcm.length % 2) throw new Error("Dictation needs between 0.1 and 60 seconds of mono 16 kHz audio.");
          const text = await stt.transcribe({ pcm, sampleRate: 16000, durationMs: pcm.length / 32 }, controller.signal);
          if (text.length > 16000) throw new Error("Transcription exceeded its output budget. Record a shorter message.");
          return { kind: "transcribe", text };
        }
        const text = toSpeakable(input.text).trim();
        if (!text) throw new Error("There is no readable text in this reply.");
        clearTimeout(idleTimer);
        synthesizer = cachedSynthesizer ?? createKokoroSynthesizer({ ...options, localFilesOnly: true });
        cachedSynthesizer = synthesizer;
        await synthesizer.load();
        controller.signal.throwIfAborted();
        const audio = await synthesizer.synthesize(text);
        controller.signal.throwIfAborted();
        if (!Number.isSafeInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 48000 || audio.samples.length > audio.sampleRate * 180) throw new Error("Read-aloud exceeded its three-minute audio budget. Choose a shorter reply.");
        const pcm = Buffer.alloc(audio.samples.length * 2);
        for (let i = 0; i < audio.samples.length; i++) {
          const sample = audio.samples[i]!;
          if (!Number.isFinite(sample)) throw new Error("The voice returned invalid audio.");
          pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), i * 2);
        }
        return { kind: "speak", wav: toWav({ pcm, sampleRate: audio.sampleRate, durationMs: audio.samples.length / audio.sampleRate * 1000 }).toString("base64") };
      };
      const stopped = new Promise<never>((_resolve, reject) => {
        onAbort = () => { synthesizer?.close?.(); reject(new Error("Voice stopped.")); };
        controller.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => controller.abort(), 120_000); timer.unref();
      });
      processing = work();
      const value = await Promise.race([processing, stopped]);
      synthesized = value.kind === "speak" && !controller.signal.aborted;
      if (!controller.signal.aborted) emit({ type: "ark.voice.result", request, value });
    } catch (error) {
      emit({ type: "ark.voice.result", request, error: controller.signal.aborted ? "Voice stopped or reached its processing deadline." : error instanceof Error ? error.message : "Local voice processing failed." });
    } finally {
      clearTimeout(timer);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      if (synthesizer) {
        if (synthesized && !controller.signal.aborted) {
          idleTimer = setTimeout(() => { cachedSynthesizer?.close?.(); cachedSynthesizer = undefined; }, 60_000);
          idleTimer.unref();
        } else {
          synthesizer.close?.();
          if (cachedSynthesizer === synthesizer) cachedSynthesizer = undefined;
        }
      }
      if (input.kind === "transcribe") await processing?.catch(() => undefined);
      active.delete(request); kinds.delete(input.kind);
    }
  };
  return {
    attach(send: typeof emit) { emit = send; },
    handle(command: ArkVoiceCommand) {
      if (command.type === "ark.voice.run") { const task = run(command); running.add(task); void task.finally(() => running.delete(task)); return; }
      const controller = active.get(command.request);
      if (controller) controller.abort();
      else { cancelled.add(command.request); if (cancelled.size > 128) cancelled.delete(cancelled.values().next().value!); }
    },
    async close() { clearTimeout(idleTimer); for (const controller of active.values()) controller.abort(); cachedSynthesizer?.close?.(); cachedSynthesizer = undefined; await Promise.all(running); },
  };
}
