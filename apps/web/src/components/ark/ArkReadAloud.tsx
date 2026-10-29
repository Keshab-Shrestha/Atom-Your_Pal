import { useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Pause, Play, Square, Volume2 } from "lucide-react";
import { Button } from "../ui/button";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useArkVoice } from "./useArkVoice";
import { voiceAudioUrl } from "./voiceAudio";

const playback = { stop: null as (() => void) | null, owner: null as symbol | null };

export function ArkReadAloud({
  environmentId,
  text,
}: {
  environmentId: EnvironmentId;
  text: string;
}) {
  const voice = useArkVoice(environmentId);
  const owner = useRef(Symbol());
  const audio = useRef<{ player: HTMLAudioElement; url: string } | null>(null);
  const [state, setState] = useState<"idle" | "preparing" | "playing" | "paused">("idle");
  const disposeAudio = useStableCallback(() => {
    const current = audio.current;
    audio.current = null;
    if (current) {
      current.player.onended = null;
      current.player.onerror = null;
      current.player.pause();
      current.player.removeAttribute("src");
      current.player.load();
      URL.revokeObjectURL(current.url);
    }
  });
  const stop = useStableCallback(() => {
    voice.stop();
    disposeAudio();
    setState("idle");
    if (playback.owner === owner.current) {
      playback.stop = null;
      playback.owner = null;
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The mounted reply owns its playback and object URL; leaving it must stop sound and release audio.
  useEffect(
    () => () => {
      disposeAudio();
      if (playback.owner === owner.current) {
        playback.stop = null;
        playback.owner = null;
      }
    },
    [disposeAudio],
  );
  const read = async () => {
    playback.stop?.();
    playback.stop = stop;
    playback.owner = owner.current;
    setState("preparing");
    voice.setError("");
    const result = await voice.process({ kind: "speak", text });
    if (playback.owner !== owner.current) return;
    if (result?.kind !== "speak") {
      setState("idle");
      return;
    }
    try {
      const url = voiceAudioUrl(result.wav);
      const player = new Audio(url);
      audio.current = { player, url };
      player.onended = stop;
      player.onerror = () => {
        stop();
        voice.setError("This device could not play the generated voice audio.");
      };
      try {
        await player.play();
        if (audio.current?.player === player) setState("playing");
      } catch {
        if (audio.current?.player === player) setState("paused");
      }
    } catch {
      stop();
      voice.setError("The local voice returned unreadable audio.");
    }
  };
  const toggle = async () => {
    const player = audio.current?.player;
    if (!player) return;
    if (!player.paused) {
      player.pause();
      setState("paused");
      return;
    }
    try {
      await player.play();
      if (audio.current?.player === player) setState("playing");
    } catch {
      voice.setError("Playback was blocked. Check this device's sound permissions.");
    }
  };
  return (
    <div
      data-voice-active={state !== "idle" || voice.error ? "true" : undefined}
      className="relative flex items-center gap-1"
    >
      {state === "idle" ? (
        <Button
          variant="ghost-muted"
          size="icon-xs"
          aria-label="Read reply aloud"
          title="Read reply aloud using local Kokoro"
          disabled={!voice.allowed || !text.trim()}
          onClick={() => {
            void read();
          }}
        >
          <Volume2 />
        </Button>
      ) : (
        <>
          {state === "preparing" ? (
            <span role="status" className="text-xs text-muted-foreground">
              Preparing voice
            </span>
          ) : (
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={state === "playing" ? "Pause read-aloud" : "Play read-aloud"}
              title={state === "playing" ? "Pause read-aloud" : "Play read-aloud"}
              onClick={() => {
                void toggle();
              }}
            >
              {state === "playing" ? <Pause /> : <Play />}
            </Button>
          )}
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Stop read-aloud"
            title="Stop read-aloud"
            onClick={stop}
          >
            <Square />
          </Button>
        </>
      )}
      {voice.error ? (
        <div
          role="alert"
          className="absolute left-0 bottom-full z-20 mb-2 w-72 rounded-lg border border-border bg-popover p-3 text-xs text-foreground shadow-lg"
        >
          <p>{voice.error}</p>
          <Button variant="ghost-muted" size="xs" onClick={() => voice.setError("")}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
