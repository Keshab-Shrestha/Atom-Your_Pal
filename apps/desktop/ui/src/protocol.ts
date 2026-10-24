// The window's view of the runtime protocol. The types come from the runtime itself, so a change there that the window does not
// handle fails `pnpm typecheck` instead of failing in front of the user. Type-only: nothing of the runtime is bundled.

import type { IslandCommand, IslandEvent } from "../../../mac/src/island-protocol.ts";

export type { IslandCommand, IslandEvent };
export type ChatsEvent = Extract<IslandEvent, { type: "chats" }>;
export type ChatItem = ChatsEvent["chats"][number];
export type ChatAccessMode = NonNullable<ChatsEvent["access"]>;
export type ChatReasoning = NonNullable<ChatsEvent["reasoning"]>;
export type InfoEvent = Extract<IslandEvent, { type: "info" }>;
export type ChatControlEvent = Extract<IslandEvent, { type: "chat.control" }>;
export type SavedPage = NonNullable<ChatControlEvent["page"]>;
export type SavedPart = SavedPage["messages"][number];
export type SavedInfo = NonNullable<ChatControlEvent["info"]>;
export type ChatWorkEvent = Extract<IslandEvent, { type: "chat.work" }>;
export type LoopState = Extract<IslandEvent, { type: "state" }>["state"];

/** What the bridge says about the runtime process (apps/desktop/bridge/supervisor.ts). */
export type RuntimeStatus =
  | { state: "stopped" }
  | { state: "running"; pid: number }
  | { state: "restarting"; afterSeconds: number }
  | { state: "configError"; message: string }
  | { state: "failed"; message: string };

/** The runtime's journal of accepted foreground requests (ADR-157): receipts as they happen, and answers to list/read/dismiss. */
export type RecoveryResponse = Extract<IslandEvent, { type: "foreground.recovery" }>;
export type Attempt = NonNullable<RecoveryResponse["attempts"]>[number];
export type RecoveryRecord = NonNullable<RecoveryResponse["record"]>;
export type Receipt = Extract<IslandEvent, { type: "foreground.receipt" }>;
