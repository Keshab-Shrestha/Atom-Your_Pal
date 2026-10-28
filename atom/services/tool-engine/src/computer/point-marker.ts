// ADR-080: after `look_at_screen`, the model ends its reply with [POINT:x,y:label] (pixels in that screenshot) or
// [POINT:none]. This file is pure: it takes the marker off the reply, checks it, and turns it into screen points.

import type { ScreenShot } from "./screen.ts";

/** A place to point at, in Cua's screen points (origin top-left of the main display, y down), with the model's label. */
export interface PointTarget {
  x: number;
  y: number;
  label: string;
}

export interface ParsedReply {
  /** The reply without any marker: what is spoken and shown. */
  text: string;
  /** Where to point, if the last marker was valid for this turn's screenshot. */
  target?: PointTarget;
  /** What the last marker was: a place, `none`, or unusable (malformed, out of range, or no screenshot). Absent: no marker. */
  marker?: "point" | "none" | "bad";
}

const OPEN = "[POINT:";
/** Every marker, including one cut off at the end, with the spaces before it. */
const MARKERS = /[ \t]*\[POINT:([^\]]*)(\]|$)/gi;
/** The start of a marker cut off before its colon, at the very end ("[POI"). */
const HALF_OPEN = /[ \t]*\[(?:P(?:O(?:I(?:N(?:T)?)?)?)?)?$/i;
const BODY = /^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?::([\s\S]*))?$/;
const MAX_LABEL = 60;

/** A pixel in the screenshot → screen points on the display it shows. Handles Retina and the shrink in one ratio. */
export function toScreenPoint(px: number, py: number, shot: ScreenShot): { x: number; y: number } {
  const { display } = shot;
  return { x: display.x + (px * display.width) / shot.width, y: display.y + (py * display.height) / shot.height };
}

/** Takes every marker off `reply`; the last one decides where to point. Without a screenshot this turn, nothing is pointed at. */
export function parsePointMarker(reply: string, shot: ScreenShot | undefined): ParsedReply {
  const last = [...reply.matchAll(MARKERS)].at(-1);
  const text = reply.replace(MARKERS, "").replace(HALF_OPEN, "").trim();
  if (!last) return { text };
  const [, body, close] = last;
  if (close === "]" && body.trim().toLowerCase() === "none") return { text, marker: "none" };
  const m = BODY.exec(body);
  // A marker cut off before its "]" (it ran to the end of the reply) is unusable.
  if (!m || !shot || close !== "]") return { text, marker: "bad" };
  const px = Number(m[1]);
  const py = Number(m[2]);
  if (!(px >= 0 && px < shot.width && py >= 0 && py < shot.height)) return { text, marker: "bad" };
  const label = (m[3] ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  return { text, target: { ...toScreenPoint(px, py, shot), label }, marker: "point" };
}

/**
 * Passes streamed text on (ADR-065) without any marker. Text from a "[" that could still become "[POINT:" is held back
 * until it is clearly something else; inside a marker everything up to "]" is dropped. Held text left at the end is
 * always part of a marker, so it is never passed on.
 */
export function pointMarkerFilter(onText: (delta: string) => void) {
  let held = "";
  let inMarker = false;
  return {
    push(delta: string) {
      let rest = held + delta;
      held = "";
      let out = "";
      while (rest) {
        if (inMarker) {
          const end = rest.indexOf("]");
          if (end < 0) break;
          inMarker = false;
          rest = rest.slice(end + 1);
          continue;
        }
        const at = rest.indexOf("[");
        if (at < 0) {
          out += rest;
          break;
        }
        out += rest.slice(0, at);
        const tail = rest.slice(at);
        if (tail.slice(0, OPEN.length).toUpperCase() === OPEN) {
          inMarker = true;
          rest = tail.slice(OPEN.length);
        } else if (tail.length < OPEN.length && OPEN.startsWith(tail.toUpperCase())) {
          held = tail;
          break;
        } else {
          out += "[";
          rest = tail.slice(1);
        }
      }
      if (out) onText(out);
    },
  };
}
