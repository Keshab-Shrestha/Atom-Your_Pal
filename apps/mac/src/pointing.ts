// ADR-080: the runtime's half of pointing from a screenshot. The reply's [POINT:…] marker is taken off before anything
// is spoken (streamed or not) or shown, and a valid one sends Pal to the place.

import type { Core } from "@zeno/core";
import { parsePointMarker, pointMarkerFilter, type ParsedReply, type PointTarget, type ScreenShot } from "@zeno/tool-engine";

export interface PointingOptions {
  /** The screenshot handed to the model since the last call, then forgets it. */
  takeShot: () => ScreenShot | undefined;
  /** Sends Pal to a place (screen points). */
  point: (target: PointTarget) => void;
  /** What the marker was, for the log. Never coordinates, labels or reply text. */
  log?: (event: { marker: NonNullable<ParsedReply["marker"]> }) => void;
}

/** The same Core, except that replies never carry a marker and a valid marker points. */
export function withPointing(core: Core, options: PointingOptions): Core {
  const { takeShot, point, log } = options;
  return {
    get sessionId() {
      return core.sessionId;
    },
    history: () => core.history(),
    reset: () => core.reset(),
    resume: (id, turns) => core.resume(id, turns),
    prepare: () => core.prepare(),
    async handle(input, signal, hooks) {
      takeShot(); // a screenshot from an earlier turn does not count for this one
      const onText = hooks?.onText;
      const filter = onText ? pointMarkerFilter(onText) : undefined;
      const answer = await core.handle(input, signal, filter ? { ...hooks, onText: (delta) => filter.push(delta) } : hooks);
      const { text, target, marker } = parsePointMarker(answer.text, takeShot());
      if (!marker) return answer;
      log?.({ marker });
      if (target && !signal?.aborted) point(target);
      // A reply that was only a marker still answers out loud (ADR-080: a pointing reply also speaks).
      const spoken = text || (target ? `It's ${target.label || "there"}.` : "I can't see it on the screen.");
      return { ...answer, text: spoken };
    },
  };
}
