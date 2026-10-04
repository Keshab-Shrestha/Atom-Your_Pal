import { execFile } from "node:child_process";
import type { Tool } from "../engine.ts";

export type Osascript = (script: string) => Promise<string>;

const defaultOsascript: Osascript = (script) =>
  new Promise((resolve, reject) =>
    execFile("/usr/bin/osascript", ["-e", script], { timeout: 8000 }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout.trim()),
    ),
  );

const PLAYERS = ["Spotify", "Music"] as const;

/** The player to control: the one playing, else the one open (Spotify first), else Music. Asks nothing of an app that is not running. */
async function pickPlayer(run: Osascript): Promise<string> {
  const running: string[] = [];
  for (const app of PLAYERS) {
    if ((await run(`application "${app}" is running`)) === "true") running.push(app);
  }
  for (const app of running) {
    if ((await run(`tell application "${app}" to player state as string`)) === "playing") return app;
  }
  return running[0] ?? "Music";
}

const ACTIONS = ["play", "pause", "toggle", "next", "previous", "now_playing"] as const;

/**
 * ADR-068: music and volume. Plays, pauses and skips in Spotify or Music (whichever is playing or open), says what
 * is playing, and sets the Mac's output volume. Always on, no approval: it only drives the player and the volume.
 */
export function createMediaTools(options: { osascript?: Osascript } = {}): Tool[] {
  const run = options.osascript ?? defaultOsascript;
  return [
    {
      spec: {
        name: "media",
        description:
          "Controls music in Spotify or Apple Music: play, pause, toggle, next, previous, or now_playing (what song is on).",
        inputSchema: {
          type: "object",
          properties: { action: { type: "string", description: `One of: ${ACTIONS.join(", ")}.` } },
          required: ["action"],
        },
      },
      async run(input) {
        const action = String(input.action ?? "");
        if (!(ACTIONS as readonly string[]).includes(action)) throw new Error(`unknown action "${action}"`);
        const app = await pickPlayer(run);
        if (action === "now_playing") {
          const state = (await run(`application "${app}" is running`)) === "true" ? await run(`tell application "${app}" to player state as string`) : "stopped";
          if (state !== "playing" && state !== "paused") return `Nothing is playing in ${app}.`;
          const info = await run(`tell application "${app}" to (name of current track) & " — " & (artist of current track)`);
          return `${state === "paused" ? "Paused" : "Playing"} in ${app}: ${info}.`;
        }
        const command = { play: "play", pause: "pause", toggle: "playpause", next: "next track", previous: "previous track" }[action as "play"];
        await run(`tell application "${app}" to ${command}`);
        return `${app}: done (${action}).`;
      },
    },
    {
      spec: {
        name: "volume",
        description: "Sets or reads the Mac's sound volume (0–100), or mutes and unmutes it.",
        inputSchema: {
          type: "object",
          properties: {
            level: { type: "number", description: "0 to 100. Omit to just read it." },
            change: { type: "number", description: "Relative change, e.g. 10 for louder or -10 for quieter." },
            mute: { type: "boolean", description: "true to mute, false to unmute." },
          },
        },
      },
      async run(input) {
        const current = Number(await run("output volume of (get volume settings)"));
        if (typeof input.mute === "boolean") {
          await run(`set volume output muted ${input.mute}`);
          return input.mute ? "Muted." : `Unmuted, volume ${current}.`;
        }
        let target: number | undefined;
        if (typeof input.level === "number") target = input.level;
        else if (typeof input.change === "number") target = current + input.change;
        if (target === undefined) return `Volume is ${current}.`;
        target = Math.max(0, Math.min(100, Math.round(target)));
        await run(`set volume output volume ${target} without output muted`);
        return `Volume set to ${target}.`;
      },
    },
  ];
}
