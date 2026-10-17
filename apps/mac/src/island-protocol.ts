// The messages between ATOM Island (Swift) and this runtime: JSON lines over stdin / stdout.
// The specification is docs/island-protocol.md; keep the two in step.

import type { Capability } from "@atom/tool-engine";
import type { LoopState } from "./voice-loop.ts";

export const PROTOCOL_VERSION = 1;

import type { BriefItem, BriefSettingsItem, SuggestionItem, ProjectItem, ThreadEvent, SearchResultsEvent, ErrorStage, PlanUsageEvent, NoticeKind, InfoEvent, MemoryItem, EpisodeItem, MemoryChatItem, ChatItem, GitBranchItem, HelperItem, ModelItem, SkillHubItem, SkillDraftItem, SkillEditItem, TestCaseItem, McpItem, UsageItem, PaperclipItem, PlanItem, BrainNodeItem, BrainEdgeItem, BrainNoteItem, BrainHitItem } from "./island-items.ts";
export * from "./island-items.ts";
export * from "./island-commands.ts";


export type IslandEvent =
  | { type: "ready"; protocol: number; provider: string; model: string; microphone: string; voice: boolean; telegram?: boolean; computer?: boolean }
  | { type: "state"; state: LoopState }
  /** ADR-098 item 5: the local API's state after `api.set`. `tokenFile` is a path: the island reads it only for "Copy token". */
  | { type: "api"; on: boolean; port: number; tokenFile: string; error?: string }
  | { type: "mic.ready" }
  | { type: "mic.level"; peak: number }
  | { type: "mic.silent"; microphone: string }
  | { type: "transcript"; text: string }
  | { type: "reply"; text: string }
  | {
      type: "turn.complete";
      speechMs: number;
      transcriptionMs: number;
      modelMs: number;
      firstSoundMs?: number;
    }
  | { type: "notice"; kind: NoticeKind; message: string }
  /** ADR-107: `projectId` when the new chat belongs to a project (after `chat.new`). */
  | { type: "conversation.reset"; projectId?: string }
  | { type: "computer.step"; text: string }
  /** ADR-054: no step for a while and no approval waiting: the computer work is over, so the island clears its strip. */
  | { type: "computer.end" }
  | { type: "computer.point"; x: number; y: number; w: number; h: number; label: string }
  | { type: "settings.open" }
  | { type: "media.key"; key: "playpause" }
  | { type: "approval.request"; id: string; summary: string; reason: string }
  | { type: "approval.closed"; id: string }
  | InfoEvent
  | { type: "timer"; id: number; label: string; message: string }
  | { type: "context.ready"; app: string; ok: true }
  | { type: "context.ready"; app: string; ok: false; message: string }
  | { type: "capabilities"; items: Capability[] }
  | PlanUsageEvent
  /** The second brain's graph: the notes (the most linked first, at most 400), their links, and the tags with counts. */
  | { type: "brain"; nodes: BrainNodeItem[]; edges: BrainEdgeItem[]; omitted: number; tags: { tag: string; count: number }[] }
  | { type: "brain.note"; note: BrainNoteItem }
  | { type: "brain.hits"; query: string; hits: BrainHitItem[] }
  /** Keshab's Claude commands for the "/" picker (ADR-117): name, one-line description, argument hint. */
  | { type: "commands"; commands: { name: string; description: string; hint: string }[] }
  /** A skill's whole SKILL.md for the editor (the answer to `skill.get` and `skill.save`). */
  | { type: "skill.file"; name: string; source: "yours" | "zeno"; text: string }
  /** Remembering by itself: whether suggestions are made, and the ones that wait (at most 3). Sent after `suggestions.get` and after each change. */
  | { type: "suggestions"; enabled: boolean; items: SuggestionItem[] }
  /** Daily brief: the settings, the newest briefs (newest first, at most 14) and whether one is being made. Sent after `brief.get` and after each change. */
  /** Ask ATOM: the answer to `text.edit`. `answer` replaces the selection (or the whole text); `changed` is false when it is the same. Or `error`, in words for the user. Never logged. */
  | { type: "text.edit.result"; id: string; answer?: string; changed?: boolean; error?: string }
  | { type: "brief"; settings: BriefSettingsItem; history: BriefItem[]; running: boolean }
  | { type: "memory"; enabled: boolean; count: number; memories: MemoryItem[]; episodes: EpisodeItem[]; chats?: MemoryChatItem[] }
  /** ADR-091: Keshab's chats, newest first, and the one ATOM is in now (voice goes to it). */
  /** ADR-097: `currentProvider` / `currentModel`: the current chat's own model; absent when it uses the default. */
  /** ADR-107: `projects` (present when projects are on, even when empty) and `currentProjectId` (the current chat's project). */
  | { type: "chats"; chats: ChatItem[]; current: string; currentProvider?: string; currentModel?: string; projects?: ProjectItem[]; currentProjectId?: string }
  /** ADR-091: ATOM's task branches, like pull requests; a branch's changes as a patch. */
  | { type: "git"; branches: GitBranchItem[] }
  | { type: "git.diff"; repo: string; branch: string; text: string; truncated: boolean }
  /** ADR-091: a chat was opened: its turns, to show. */
  /** ADR-107: `projectId` for a project chat; `trimmed: true` when the Core got only the newest turns of a long project chat (the window shows all). */
  | { type: "chat.opened"; id: string; messages: { role: "user" | "assistant"; text: string }[]; projectId?: string; trimmed?: true }
  | {
      type: "helpers";
      helpers: HelperItem[];
      apps: string[];
      allowLarge?: boolean;
      models?: ModelItem[];
      /** Task 3.12: the skills to choose from: Keshab's in ~/.claude/skills ("yours") and, ADR-094, ATOM's own ("zeno"). */
      skills?: { name: string; description: string; source?: "yours" | "zeno" | "hub" }[];
      /** B3.5: the skills hub; absent when there is nothing to show. */
      skillHub?: SkillHubItem;
      /** ADR-094: Tinker's skill drafts and skill edits: every pending one and the newest few others. */
      skillDrafts?: SkillDraftItem[];
      skillEdits?: SkillEditItem[];
      /** ADR-098 item 8: every saved test case, newest first. */
      testCases?: TestCaseItem[];
      /** ADR-090: Keshab's MCP servers; secrets never: only the names of env variables and headers. */
      mcp?: McpItem[];
      /** ADR-091: tokens used today and in the last 7 days (counts and model ids only). */
      usage?: UsageItem;
      /** Task 3.16: the tasks handed to Keshab's Paperclip; absent when the connection is off. */
      paperclip?: { issues: PaperclipItem[] };
      /** ADR-111: the newest work plans with the state of each portion; absent when there are none. */
      plans?: PlanItem[];
      /** ADR-093: agent folders whose soul.md could not be loaded (folder name and why); absent when there are none. */
      agentProblems?: { id: string; problem: string }[];
    }
  | ThreadEvent
  | SearchResultsEvent
  /** Task 3.15: a line from the team (a goal done, a plan waiting), sent just before ATOM says it. */
  | { type: "worker.line"; line: string }
  | { type: "error"; stage: ErrorStage; message: string; kind?: string; retryable?: boolean };

/** One event as a single line of JSON, ending with a newline. */
export function encodeEvent(event: IslandEvent): string {
  return `${JSON.stringify(event)}\n`; // JSON.stringify escapes line breaks inside strings
}

/** Usage above 200% is taken as a bad value and dropped, as in Coucou. */
const MAX_USAGE = 2;

/**
 * The `plan.usage` event from what the Claude plan provider reported (ADR-076). Only these three fields are read;
 * a share that is not a finite number in 0..2, or an overage that is not true/false, is dropped. Undefined if nothing is left.
 */
export function planUsageEvent(usage: { fiveHour?: unknown; sevenDay?: unknown; overage?: unknown }): PlanUsageEvent | undefined {
  const share = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_USAGE;
  const event: PlanUsageEvent = {
    type: "plan.usage",
    ...(share(usage.fiveHour) ? { fiveHour: usage.fiveHour } : {}),
    ...(share(usage.sevenDay) ? { sevenDay: usage.sevenDay } : {}),
    ...(typeof usage.overage === "boolean" ? { overage: usage.overage } : {}),
  };
  return Object.keys(event).length > 1 ? event : undefined;
}

/**
 * Limits microphone levels to one event per `intervalMs`, carrying the loudest peak since the last one,
 * so a fast meter costs little and a short loud sound between events is never lost.
 */
export function createLevelThrottle(send: (peak: number) => void, intervalMs = 50, now: () => number = Date.now) {
  let pending = 0;
  let last = -Infinity;
  return {
    push(peak: number) {
      pending = Math.max(pending, peak);
      const t = now();
      if (t - last < intervalMs) return;
      last = t;
      send(Math.round(pending * 1000) / 1000);
      pending = 0;
    },
    reset() {
      pending = 0;
      last = -Infinity;
    },
  };
}
