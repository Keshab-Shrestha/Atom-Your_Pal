// The window's view of the runtime protocol. The types come from the runtime itself, so a change there that the window does not
// handle fails `pnpm typecheck` instead of failing in front of the user. Type-only: nothing of the runtime is bundled.

import type { IslandCommand, IslandEvent } from "../../../mac/src/island-protocol.ts";

export type { IslandCommand, IslandEvent };
export type ChatsEvent = Extract<IslandEvent, { type: "chats" }>;
export type ChatItem = ChatsEvent["chats"][number];
export type LoopState = Extract<IslandEvent, { type: "state" }>["state"];

/** What the bridge says about the runtime process (apps/desktop/bridge/supervisor.ts). */
export type RuntimeStatus =
  | { state: "stopped" }
  | { state: "running"; pid: number }
  | { state: "restarting"; afterSeconds: number }
  | { state: "configError"; message: string }
  | { state: "failed"; message: string };
