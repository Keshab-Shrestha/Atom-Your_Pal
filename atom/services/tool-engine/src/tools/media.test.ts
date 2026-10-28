import { test } from "node:test";
import assert from "node:assert/strict";
import { createMediaTools } from "./media.ts";

function harness(state: { running: string[]; playing?: string; volume?: number }) {
  const scripts: string[] = [];
  const [media, volume] = createMediaTools({
    osascript: async (s) => {
      scripts.push(s);
      const running = s.match(/^application "(\w+)" is running$/);
      if (running) return String(state.running.includes(running[1]!));
      const st = s.match(/^tell application "(\w+)" to player state/);
      if (st) return st[1] === state.playing ? "playing" : "paused";
      if (s.includes("current track")) return "Song — Artist";
      if (s.startsWith("output volume")) return String(state.volume ?? 50);
      return "";
    },
  });
  const sig = new AbortController().signal;
  return { scripts, media: (i: object) => media!.run(i as never, sig), volume: (i: object) => volume!.run(i as never, sig) };
}

test("media controls the player that is playing; Music when none is open", async () => {
  const h = harness({ running: ["Spotify", "Music"], playing: "Music" });
  await h.media({ action: "pause" });
  assert.equal(h.scripts.at(-1), 'tell application "Music" to pause');
  const none = harness({ running: [] });
  await none.media({ action: "play" });
  assert.equal(none.scripts.at(-1), 'tell application "Music" to play');
  assert.ok(!none.scripts.some((s) => s.includes('tell application "Spotify"')), "never wakes an app that is not running");
});

test("now_playing says the track", async () => {
  const h = harness({ running: ["Spotify"], playing: "Spotify" });
  assert.equal(await h.media({ action: "now_playing" }), "Playing in Spotify: Song — Artist.");
});

test("volume: read, set, relative, clamped, mute", async () => {
  const h = harness({ running: [], volume: 40 });
  assert.equal(await h.volume({}), "Volume is 40.");
  assert.equal(await h.volume({ change: 70 }), "Volume set to 100.");
  assert.equal(await h.volume({ level: 25 }), "Volume set to 25.");
  assert.equal(await h.volume({ mute: true }), "Muted.");
});
