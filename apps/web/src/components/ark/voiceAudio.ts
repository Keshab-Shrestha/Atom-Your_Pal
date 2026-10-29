export interface DictationCapture {
  finish: () => Promise<string>;
  cancel: () => void;
}

export async function captureDictation(
  signal: AbortSignal,
  onLimit: () => void,
): Promise<DictationCapture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
    throw new Error(
      "Dictation needs microphone support and a secure connection (HTTPS or localhost).",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true },
    video: false,
  });
  if (signal.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Dictation cancelled.");
  }
  const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let failure: Error | undefined;
  let finishing: Promise<string> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  let finishRecording: () => void;
  const stopped = new Promise<void>((resolve) => {
    finishRecording = resolve;
  });
  const release = () => {
    clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
    signal.removeEventListener("abort", cancel);
  };
  const cancel = () => {
    if (recorder.state !== "inactive") recorder.stop();
    release();
    chunks.length = 0;
  };
  recorder.ondataavailable = (event) => {
    if (signal.aborted || !event.data.size) return;
    bytes += event.data.size;
    if (bytes > 8_000_000) {
      failure = new Error(
        "The microphone recording exceeded its processing budget. Record a shorter message.",
      );
      onLimit();
      return;
    }
    chunks.push(event.data);
  };
  recorder.onerror = () => {
    failure = new Error(
      "The microphone recording failed. Check microphone permissions and try again.",
    );
    onLimit();
  };
  recorder.onstop = () => {
    release();
    finishRecording();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    recorder.start(1000);
  } catch (error) {
    release();
    throw error;
  }
  timer = setTimeout(onLimit, 60_000);
  return {
    cancel,
    finish() {
      finishing ??= (async () => {
        if (recorder.state !== "inactive") recorder.stop();
        await stopped;
        signal.throwIfAborted();
        if (failure) throw failure;
        const blob = new Blob(chunks, { type: recorder.mimeType });
        chunks.length = 0;
        if (!blob.size) throw new Error("No microphone audio was recorded.");
        const context = new AudioContext();
        let decoded: AudioBuffer;
        try {
          decoded = await context.decodeAudioData(await blob.arrayBuffer());
        } finally {
          await context.close();
        }
        signal.throwIfAborted();
        if (decoded.duration < 0.1 || decoded.duration > 60.5)
          throw new Error("Record between 0.1 and 60 seconds for each dictation.");
        const frames = Math.min(960_000, Math.ceil(decoded.duration * 16000));
        const offline = new OfflineAudioContext(1, frames, 16000);
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start();
        const audio = await offline.startRendering();
        signal.throwIfAborted();
        const samples = audio.getChannelData(0);
        const pcm = new Uint8Array(samples.length * 2);
        const view = new DataView(pcm.buffer);
        for (let i = 0; i < samples.length; i++) {
          const sample = Math.max(-1, Math.min(1, samples[i]!));
          view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
        }
        let binary = "";
        for (let i = 0; i < pcm.length; i += 8192)
          binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
        return btoa(binary);
      })();
      return finishing;
    },
  };
}

export function voiceAudioUrl(wav: string) {
  const binary = atob(wav);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}
