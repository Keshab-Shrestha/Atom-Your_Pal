import type { Tool } from "../engine.ts";

export interface IslandToolOptions {
  /** Asks the island to open its Settings page. False when no island is attached. */
  openSettings: () => boolean;
  /** Asks the island to press the Mac's play/pause key. False when no island is attached. */
  playPause: () => boolean;
}

const noIsland = "the ZENO window is not running";

/**
 * Task 2.x (ADR-071): two things only the island can do. Opening ZENO's own Settings, and pressing the Mac's
 * play/pause key, which reaches whatever is playing (YouTube in Brave, Spotify, Music). The key is a toggle and needs
 * the Accessibility permission ZENO holds for dictation; without it the island says so.
 */
export function createIslandTools(options: IslandToolOptions): Tool[] {
  return [
    {
      capability: { title: "Open apps and websites", examples: ["Open settings"] },
      spec: {
        name: "open_zeno_settings",
        description: "Opens ZENO's own Settings panel. For the Mac's System Settings use open_app instead.",
        inputSchema: { type: "object", properties: {} },
      },
      run() {
        if (!options.openSettings()) throw new Error(noIsland);
        return "Opened settings.";
      },
    },
    {
      capability: { title: "Music and volume", examples: ["Pause the video"] },
      spec: {
        name: "play_pause",
        description:
          "Presses the Mac's play/pause key once: pauses whatever is playing, or resumes it, including a video in a web browser (YouTube in Brave). " +
          "It is a toggle. For Spotify or Music commands such as next track or what is playing, use media.",
        inputSchema: { type: "object", properties: {} },
      },
      run() {
        if (!options.playPause()) throw new Error(noIsland);
        return "Done.";
      },
    },
  ];
}
