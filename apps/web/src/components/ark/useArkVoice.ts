import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ArkVoiceInput, EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useStableCallback } from "../../hooks/useStableCallback";
import { randomUUID } from "../../lib/utils";

type WithoutRequestId<Input> = Input extends unknown ? Omit<Input, "requestId"> : never;
type VoicePayload = WithoutRequestId<ArkVoiceInput>;

export function useArkVoice(environmentId: EnvironmentId) {
  const allowed = useAtomValue(serverEnvironment.arkVoice.permissionAtom(environmentId));
  const run = useAtomCommand(serverEnvironment.arkVoice, { reportFailure: false });
  const cancel = useAtomCommand(serverEnvironment.arkVoiceCancel, { reportFailure: false });
  const cancelRequest = useStableCallback((target: EnvironmentId, requestId: string) =>
    cancel({ environmentId: target, input: { requestId } }),
  );
  const active = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const stop = useStableCallback(() => {
    const requestId = active.current;
    active.current = null;
    setPending(false);
    if (requestId) void cancelRequest(environmentId, requestId);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Leaving a voice control cancels its environment worker and ignores late audio/transcripts.
  useEffect(
    () => () => {
      const requestId = active.current;
      active.current = null;
      if (requestId) void cancelRequest(environmentId, requestId);
    },
    [environmentId, cancelRequest],
  );
  const process = async (input: VoicePayload) => {
    if (active.current || !allowed) return null;
    if (input.kind === "speak" && input.text.length > 8000) {
      setError(
        "This reply exceeds read-aloud's processing budget. Use a shorter reply; the chat itself is unchanged.",
      );
      return null;
    }
    const requestId = randomUUID();
    active.current = requestId;
    setPending(true);
    setError("");
    try {
      const result = await run({ environmentId, input: { ...input, requestId } });
      if (active.current !== requestId) return null;
      if (result._tag === "Success") return result.value;
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Local voice processing failed.");
      return null;
    } finally {
      if (active.current === requestId) {
        active.current = null;
        setPending(false);
      }
    }
  };
  return { allowed, pending, error, setError, stop, process };
}
