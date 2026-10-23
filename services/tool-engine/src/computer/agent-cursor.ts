import type { CuaTransport } from "./cua-client.ts";

/** Glide time between ATOM's actions, so the user can follow the agent cursor. */
const GLIDE_MS = 400;
/**
 * A calm, near-straight glide. The driver's defaults (arc_size 0.25, turn_radius 80, spring 0.72) looked like a spiral in a short glide
 * (Keshab, 2026-10-23): no arc, no turn loop and no overshoot.
 */
const MOTION = { glide_duration_ms: GLIDE_MS, arc_size: 0, arc_flow: 0, turn_radius: 0, spring: 1 };
/** Where the agent cursor rests: ATOM's island at the top centre of the main display. */
const REST_Y = 14;

/**
 * Keshab's request (2026-10-23): a second cursor that moves with ATOM's actions and flies back to ATOM when the task ends. It is the
 * Cua Driver's agent-cursor overlay. `move_cursor` keeps its default window scope, which moves only the overlay: the user's real
 * pointer is never moved (never `scope: "desktop"`), so the user can keep working while ATOM does.
 */
export function createAgentCursor(cua: Pick<CuaTransport, "call">, wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {
  return {
    async start() {
      await cua.call("set_agent_cursor_motion", MOTION);
      await cua.call("set_agent_cursor_enabled", { enabled: true });
    },
    async finish() {
      const width = Number((await cua.call("get_screen_size", {})).data.width);
      if (Number.isFinite(width) && width > 0) {
        await cua.call("move_cursor", { x: Math.round(width / 2), y: REST_Y });
        await wait(GLIDE_MS + 150);
      }
      await cua.call("set_agent_cursor_enabled", { enabled: false });
    },
  };
}
