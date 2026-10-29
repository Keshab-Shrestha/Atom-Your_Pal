import { useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Mic, Square, X } from "lucide-react";
import { Button } from "../ui/button";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useArkVoice } from "./useArkVoice";
import { captureDictation, type DictationCapture } from "./voiceAudio";

type Recording = { controller: AbortController; capture?: DictationCapture; finishing?: boolean };

export function ArkDictation({
  environmentId,
  disabled,
  insert,
}: {
  environmentId: EnvironmentId;
  disabled: boolean;
  insert: (text: string) => boolean;
}) {
  const voice = useArkVoice(environmentId);
  const current = useRef<Recording | null>(null);
  const [phase, setPhase] = useState<"idle" | "permission" | "recording" | "processing">("idle");
  const [retainedTranscript, setRetainedTranscript] = useState("");
  const insertStable = useStableCallback(insert);
  const cancel = useStableCallback(() => {
    current.current?.controller.abort();
    current.current?.capture?.cancel();
    current.current = null;
    voice.stop();
    setPhase("idle");
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A mounted composer owns microphone tracks; switching its draft target must release them.
  useEffect(
    () => () => {
      current.current?.controller.abort();
      current.current?.capture?.cancel();
      current.current = null;
    },
    [],
  );
  const finish = useStableCallback(async () => {
    const recording = current.current;
    if (!recording?.capture || recording.finishing || phase !== "recording") return;
    recording.finishing = true;
    setPhase("processing");
    try {
      const pcm = await recording.capture.finish();
      if (current.current !== recording || recording.controller.signal.aborted) return;
      const result = await voice.process({ kind: "transcribe", pcm });
      if (current.current !== recording || recording.controller.signal.aborted) return;
      if (result?.kind === "transcribe") {
        if (!result.text.trim())
          voice.setError("No speech was recognized. Your draft is unchanged.");
        else if (!insertStable(result.text)) {
          setRetainedTranscript(result.text);
          voice.setError(
            "The composer is not editable. Your transcript is kept here until you insert it or dismiss it.",
          );
        }
      }
    } catch (error) {
      if (current.current === recording && !recording.controller.signal.aborted)
        voice.setError(error instanceof Error ? error.message : "Dictation failed.");
    } finally {
      if (current.current === recording) {
        current.current = null;
        setPhase("idle");
      }
    }
  });
  const start = async () => {
    if (current.current || disabled || !voice.allowed) return;
    const recording: Recording = { controller: new AbortController() };
    current.current = recording;
    setPhase("permission");
    voice.setError("");
    try {
      recording.capture = await captureDictation(recording.controller.signal, () => {
        void finish();
      });
      if (current.current !== recording) {
        recording.capture.cancel();
        return;
      }
      setPhase("recording");
    } catch (error) {
      if (current.current === recording) {
        current.current = null;
        setPhase("idle");
        voice.setError(error instanceof Error ? error.message : "Microphone access failed.");
      }
    }
  };
  return (
    <div className="relative flex items-center gap-1">
      {phase === "idle" ? (
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label="Dictate into this draft"
          title="Dictate into this draft. Audio is transcribed locally on this chat's connected environment."
          disabled={disabled || !voice.allowed}
          onClick={() => {
            void start();
          }}
        >
          <Mic />
        </Button>
      ) : (
        <>
          {phase === "recording" ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                void finish();
              }}
            >
              <Square /> Finish dictation
            </Button>
          ) : (
            <span role="status" className="text-xs text-muted-foreground">
              {phase === "permission" ? "Waiting for microphone" : "Transcribing locally"}
            </span>
          )}
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Cancel dictation"
            title="Cancel dictation"
            onClick={cancel}
          >
            <X />
          </Button>
        </>
      )}
      {voice.error || retainedTranscript ? (
        <div
          role="alert"
          className="absolute right-0 bottom-full z-20 mb-2 w-72 rounded-lg border border-border bg-popover p-3 text-xs text-foreground shadow-lg"
        >
          <p>{voice.error}</p>
          {retainedTranscript ? (
            <>
              <p className="my-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {retainedTranscript}
              </p>
              <Button
                variant="outline"
                size="xs"
                disabled={disabled}
                onClick={() => {
                  if (insertStable(retainedTranscript)) {
                    setRetainedTranscript("");
                    voice.setError("");
                  }
                }}
              >
                Insert transcript
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={() => {
              voice.setError("");
              setRetainedTranscript("");
            }}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
