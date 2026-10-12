// The messages between ZENO Island (Swift) and this runtime: JSON lines over stdin / stdout.
// The specification is docs/island-protocol.md; keep the two in step.

import type { Capability } from "@zeno/tool-engine";
import type { LoopState } from "./voice-loop.ts";

export const PROTOCOL_VERSION = 1;

/** Longest command line accepted, in characters. The biggest is a soul edit (`soul.set`); anything bigger is a bug or abuse. */
export const MAX_COMMAND_LENGTH = 16_384;
/** ADR-098: the longest search query, in characters. */
export const MAX_SEARCH_QUERY = 200;
/** ADR-098 item 3: longest message to a running task (as a note). */
export const MAX_STEER_CHARS = 2000;

export type IslandCommand =
  | { type: "talk.start" }
  | { type: "talk.send" }
  | { type: "talk.cancel" }
  | { type: "conversation.reset" }
  | { type: "model.set"; provider: string; model: string }
  /** ADR-097: ask the providers for their model lists again (answered with `info`). */
  | { type: "model.refresh" }
  /** ADR-097: a chat's own model ("" for the chat in use; provider and model "" for the default again). */
  | { type: "chat.model"; id: string; provider: string; model: string }
  | { type: "approval.answer"; id: string; approved: boolean }
  | { type: "memory.list" }
  | { type: "chats.list" }
  | { type: "chat.open"; id: string }
  | { type: "chat.delete"; id: string }
  /** ADR-097: keep a chat in memory (summary, sections and exact lines, searched for every request), or remove it. */
  | { type: "memory.keepChat"; id: string }
  | { type: "memory.dropChat"; id: string }
  | { type: "git.list" }
  | { type: "git.push"; repo: string; branch: string }
  | { type: "git.diff"; repo: string; branch: string }
  | { type: "memory.forget"; id: number }
  | { type: "memory.clear" }
  | { type: "text.send"; text: string }
  | { type: "episode.forget"; id: number }
  | { type: "episode.clear" }
  | { type: "context.window"; bundleId: string; name: string }
  | { type: "helpers.list" }
  /** ADR-091; ADR-097 adds `chime` (absent: on), the chime before a spoken line. */
  | { type: "speech.set"; reports: boolean; updates: boolean; chime?: boolean }
  /** ADR-098: Settings' "Send to Telegram" switch: pushes (Needs you, goal summaries, schedule results) on or off. */
  | { type: "telegram.set"; push: boolean }
  /** ADR-098 item 5: Settings' "Local API" switch. The runtime answers with an `api` event. */
  | { type: "api.set"; on: boolean }
  | { type: "tools.scan" }
  | { type: "helper.set"; helper: string; app: string }
  | { type: "job.add"; helper: string; task: string; blockedBy?: number[]; planFirst?: boolean }
  | { type: "plan.approve"; id: number }
  | { type: "plan.reject"; id: number }
  | { type: "helper.planFirst"; helper: string; on: boolean }
  | { type: "helper.browser"; helper: string; on: boolean }
  | { type: "routine.delete"; id: number }
  /** ADR-094: pause or resume a routine; post a task to the team (no role: anyone) or take one back; a worker's wake-ups. */
  | { type: "routine.pause"; id: number; paused: boolean }
  /** ADR-097: Keshab's own schedule from the Scheduled page, new or changed. */
  | ({ type: "routine.add" } & RoutineInput)
  | ({ type: "routine.update"; id: number } & RoutineInput)
  | { type: "team.add"; task: string; role?: string }
  | { type: "team.delete"; id: number }
  | { type: "helper.wakeUp"; helper: string; every: "off" | "15m" | "1h" | "4h" | "1d" }
  | { type: "helper.wakeUp.pause"; helper: string; paused: boolean }
  | { type: "grant.add"; helper: string; path: string }
  | { type: "helper.skills"; helper: string; skills: string[] }
  | { type: "job.rate"; id: number; good: boolean; comment?: string }
  | { type: "job.open"; id: number }
  | { type: "job.retry"; id: number }
  | { type: "mcp.add"; name: string; kind: "command" | "url"; command?: string; args?: string[]; env?: string[]; url?: string; transport?: "http" | "sse"; headers?: string[] }
  | { type: "mcp.remove"; id: number }
  | { type: "mcp.set"; id: number; enabled?: boolean; trusted?: boolean; workers?: string[] }
  | { type: "mcp.test"; id: number }
  | { type: "agent.create"; name: string; role: string; kit: "research" | "folders" | "think"; personality: string; howItWorks: string; rules: string }
  | { type: "agent.remove"; id: string }
  /** ADR-095: Managers: add, rename, switch mode, remove (refused while it has Agents); move an Agent under a Manager. */
  | { type: "manager.create"; name: string; mode?: "plan" | "group" }
  | { type: "manager.rename"; id: string; name: string }
  | { type: "manager.mode"; id: string; mode: "plan" | "group" }
  | { type: "manager.delete"; id: string }
  | { type: "agent.manager"; helper: string; manager: string }
  | { type: "proposal.accept"; id: number }
  | { type: "proposal.reject"; id: number }
  | { type: "proposal.undo"; id: number }
  // ADR-098 item 8: save a done task as a test case (for its agent's soul or a ZENO-made skill its run used), delete one,
  // and run the test cases of a pending soul proposal ("soul") or skill edit ("skill") again.
  | { type: "testcase.save"; jobId: number; kind: "soul" | "skill"; target: string }
  | { type: "testcase.delete"; id: number }
  | { type: "testcase.run"; proposalKind: "soul" | "skill"; id: number }
  /** ADR-094: ask Tinker for a skill from a done task; answer its skill drafts and skill edits. */
  | { type: "skill.make" | "skill.approve" | "skill.reject" | "skill.edit.accept" | "skill.edit.reject" | "skill.edit.undo"; id: number }
  /** B3.5, ADR-102: the skills hub (a pinned list of public repos): search, preview (nothing is saved), approve, reject, uninstall, look for an update. */
  | { type: "skill.hub.search"; query: string }
  | { type: "skill.hub.preview"; source: number; path: string }
  | { type: "skill.hub.approve" | "skill.hub.reject"; id: number }
  | { type: "skill.hub.uninstall"; name: string; force?: boolean }
  | { type: "skill.hub.update"; name: string }
  | { type: "grant.remove"; helper: string; path: string }
  | { type: "job.block"; id: number; blockedBy: number[] }
  | { type: "comment.add"; id: number; text: string }
  /** ADR-098 item 3: Keshab's message to a running task (1 to 2000 characters), and an interrupt. */
  | { type: "job.steer"; id: number; text: string }
  | { type: "job.interrupt"; id: number }
  /**
   * B3.4, ADR-101: undo the file edits a task's runs made: one file (`path`, as in the thread's `checkpoints`) or all of
   * them. `force` also puts back a file that changed after the run. Answered with the next `thread` event.
   */
  | { type: "job.undo"; id: number; path?: string; force?: boolean }
  /** ADR-098: one search over chats, tasks (with notes and labels) and reports; answered with `search.results`. */
  | { type: "search"; query: string }
  /** ADR-098: a task's labels (1 to 24 characters: a to z, digits, dash, space; at most 6). */
  | { type: "job.label.add" | "job.label.remove"; id: number; label: string }
  | { type: "thread.get"; id: number }
  | { type: "job.stop"; id: number }
  | { type: "job.fresh"; id: number }
  | { type: "job.delete"; id: number }
  | { type: "helper.pin"; helper: string; model: string }
  | { type: "helpers.settings"; allowLarge?: boolean; planLimit?: number; maxRunning?: number; codexFallback?: boolean }
  | { type: "helper.budget"; helper: string; cap: number | null }
  | { type: "soul.set"; helper: string; soul: SoulItem }
  | { type: "soul.restore"; helper: string; version: number }
  | { type: "quit" };

/**
 * ADR-097: a schedule from the window's form: the worker, the task, and one of the store's three kinds. `minute` is
 * minutes after local midnight (daily, weekly); `weekday` is 0 (Sunday) to 6; `every` is 1 to 168 hours. `startAt`
 * (ISO 8601) is an hourly schedule's first time. The store checks the numbers, the worker and the task.
 */
export interface RoutineInput {
  helper: string;
  task: string;
  kind: "daily" | "weekly" | "hours";
  minute?: number;
  weekday?: number;
  every?: number;
  startAt?: string;
  /** ADR-098: send the result of each task it makes to Telegram. Left out on update: no change. */
  notifyTelegram?: boolean;
  /** ADR-098 item 5: the local API's webhook may start it. Left out on update: no change. */
  webhook?: boolean;
}

export type ErrorStage =
  | "microphone"
  | "transcription"
  | "model"
  | "speech"
  | "config"
  | "protocol"
  | "settings"
  | "runtime";
export type NoticeKind = "too_short" | "mic_starting" | "no_speech";

/** The model in use and the choices offered (docs/island-protocol.md, "Model choice"). Never carries API keys. */
export interface InfoEvent {
  type: "info";
  provider: string;
  model: string;
  providers: { id: string; name: string; available: boolean; models: { id: string; name: string }[] }[];
  /** ADR-093: the AI tools found on this Mac (found, signed in, what ZENO does with them). */
  tools?: { id: string; name: string; found: boolean; signedIn?: boolean; provider?: string; note: string }[];
}

/** One kept memory, for Settings (ADR-058). Travels only over the private pipe; never logged. */
export interface MemoryItem {
  id: number;
  text: string;
  /** ISO 8601. */
  createdAt: string;
  source: "voice" | "text";
}

/** One conversation summary (ADR-059). Travels only over the private pipe; never logged. */
export interface EpisodeItem {
  id: number;
  summary: string;
  /** ISO 8601: when the conversation was last summarised. */
  endedAt: string;
  exchanges: number;
}

/** One helper job (ADR-081). Task and report text travel only over the private pipe; never logged. */
export interface JobItem {
  id: number;
  task: string;
  state: "queued" | "running" | "done" | "failed" | "stopped";
  /** ISO 8601. */
  createdAt: string;
  endedAt?: string;
  step?: string;
  partial?: boolean;
  title?: string;
  summary?: string;
  error?: string;
  /** The model it runs on, once chosen (ADR-083). */
  model?: string;
  /** Why that model, in plain words ("Laya: trivial", "Pinned", …). */
  modelReason?: string;
  /** ADR-087: the tasks it waits for, those not done yet, and how many notes it has. */
  blockedBy: number[];
  waitingFor: number[];
  comments: number;
  goal?: string;
  /** Task 3.5: the goal it belongs to, and whether that goal has ended with its combined report. */
  goalId?: number;
  goalEnded?: boolean;
  /** Task 3.6: its next run continues the last one's session ("Start fresh" forgets it). */
  resumable?: boolean;
  /** Task 3.7: why a runnable task waits (a budget used up, the plan above its limit); it shows under "Needs you". */
  held?: string;
  /** ADR-098 item 3: Keshab interrupted its run; it waits ("queued", held) for his next message. */
  interrupted?: boolean;
  /** Task 3.8: plan first; the plan's state and one-line summary once written. */
  planFirst?: boolean;
  planStatus?: "awaiting" | "approved";
  planSummary?: string;
  /** Task 3.13: Keshab's rating; for a Tinker task, the task it reviews. */
  rating?: "good" | "bad";
  reviews?: number;
  /** ADR-090: how many times a failure was retried by itself. */
  autoRetries?: number;
  parentId?: number;
  /** ADR-095: the sub-agents its runs started (newest 12): name, state, short description and result. Never logged. */
  subAgents?: { name: string; state: "started" | "done" | "failed"; description: string; result?: string }[];
  /** ADR-098: its labels, sorted; absent when none. */
  labels?: string[];
}

/** ADR-098: one search result: what to open (a chat id, or a task id for tasks and reports), a title, a snippet, a date. Never logged. */
export interface SearchHitItem<Id> {
  id: Id;
  title: string;
  snippet: string;
  /** ISO 8601. */
  at: string;
}

/** ADR-098: the results of one `search`, by kind, at most 20 of each; `query` is the query answered. */
export interface SearchResultsEvent {
  type: "search.results";
  query: string;
  chats: SearchHitItem<string>[];
  tasks: SearchHitItem<number>[];
  reports: SearchHitItem<number>[];
}

/** A task's thread (ADR-087, Task 3.4). Never logged. */
export interface ThreadEvent {
  type: "thread";
  id: number;
  /** ADR-098 item 3: `delivery` marks a message to the running task: "live" (it took it) or "after" (runs once more). */
  comments: { id: number; text: string; createdAt: string; delivery?: "live" | "after" }[];
  activity: { kind: string; at: string }[];
  report?: Omit<ReportEvent, "type" | "id">;
  /** Task 3.8: the plan a plan-first run wrote. */
  plan?: { summary: string; steps: string };
  /** Task 3.10: the sub-tasks this task handed off. */
  handOffs?: number[];
  /** ADR-098 item 8: the ZENO-made skills a done task's runs used (each can take it as a test case). */
  testSkills?: string[];
  /** B3.1: the run's tool calls, the newest 100, oldest first (redacted summaries; absent when none were recorded). */
  toolCalls?: { id: string; agent?: string; tool: string; input: string; state: "started" | "ok" | "error"; result?: string; at: string; ms?: number }[];
  /**
   * B3.4, ADR-101: the files the task's runs changed in the agent's folders, oldest first, at most 100 (absent when none).
   * `path` is relative to its folder. `state`: `ready` (can be undone), `changed` (ready, but the file changed after the
   * run: undo needs `force`), `undone`, `skipped` (not kept: see `reason`, such as "secret file" or "too large").
   */
  checkpoints?: { path: string; kind: "modified" | "created"; state: "ready" | "changed" | "undone" | "skipped"; reason?: string }[];
  /** B3.4: true when the run called Bash (what a command changes is NOT kept) and the task has a folder. Absent otherwise. */
  bashRan?: true;
  /** Task 3.5: the goal the task is part of, its tasks, and the combined report once every task has ended. */
  goal?: { id: number; text: string; ended: boolean; tasks: number[]; report?: Omit<ReportEvent, "type" | "id"> };
}

/** ADR-091: one of ZENO's task branches, with the task's title. */
export interface GitBranchItem {
  repo: string;
  repoName: string;
  branch: string;
  task: number;
  title?: string;
  base: string;
  commits: { sha: string; subject: string; at: string }[];
  files: { path: string; added: number | null; removed: number | null }[];
  remote?: string;
  pushed: "no" | "yes" | "changed";
}

/** ADR-091: one of Keshab's chats. */
/** ADR-097: a recent or kept chat, for the Memory page. Titles travel only over the private pipe; never logged. */
export interface MemoryChatItem {
  id: string;
  title: string;
  /** ISO 8601. Absent for a kept chat no longer in the chat list. */
  updatedAt?: string;
  messages: number;
  kept: boolean;
  /** True while ZENO writes the summary and the index. */
  indexing?: boolean;
  /** ISO 8601. */
  keptAt?: string;
}

export interface ChatItem {
  id: string;
  title: string;
  updatedAt: string;
  messages: number;
  /** ADR-098: true for a chat another surface writes (Telegram, the local API). The window reads it only. Absent means false. */
  readOnly?: true;
}

/** ADR-091: token counts and API-equivalent dollars. */
export interface UsageTotalsItem {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  dollars: number;
  runs: number;
}

/** ADR-091: the Dashboard's tokens: today, the week, each day, each worker (name; null for ZENO's chat), each model. */
export interface UsageItem {
  today: UsageTotalsItem;
  week: UsageTotalsItem;
  days: (UsageTotalsItem & { day: string })[];
  byWorker: (UsageTotalsItem & { helper: string | null; name: string })[];
  byModel: (UsageTotalsItem & { model: string })[];
  /** ADR-098 item 9: ZENO's last chat answers read nothing from the prompt cache. */
  chatCacheCold?: boolean;
}

/** ADR-090: an MCP server as the island sees it: never a secret value. */
/** B3.5, ADR-102: one flag from the review of a hub skill (kind, how much it matters, and the text that raised it). */
export interface HubFlagItem {
  kind: string;
  severity: "warn" | "info";
  excerpt: string;
}

/** B3.5: the skills hub as the window shows it: the last search, the skills that wait for an answer, and the installed ones. */
export interface SkillHubItem {
  results: { name: string; description: string; repo: string; path: string; sha: string; source: number }[];
  pending: { id: number; kind: "new" | "update"; name: string; description: string; repo: string; path: string; sha: string; text: string; flags: HubFlagItem[] }[];
  installed: { name: string; repo: string; path: string; sha: string }[];
  /** A plain message: a search without hits, GitHub's limit, an unreachable host, "up to date". */
  message?: string;
}

/** ADR-094: Tinker's draft of a new skill, with a short preview of its steps. */
export interface SkillDraftItem {
  id: number;
  jobId: number;
  helper: string;
  name: string;
  description: string;
  preview: string;
  state: "pending" | "approved" | "rejected";
  createdAt: string;
}

/** ADR-094: Tinker's edit to one of ZENO's skills: why, and a compact before and after (from the first changed line). */
export interface SkillEditItem {
  id: number;
  skill: string;
  jobId: number;
  reason: string;
  before: string;
  after: string;
  state: "pending" | "accepted" | "rejected" | "undone";
  createdAt: string;
  /** ADR-098 item 8: its test cases' outcome, when it has any. */
  tests?: TestsItem;
}

/** ADR-098 item 8: one saved test case (task text cut; the saved report is never sent). */
export interface TestCaseItem {
  id: number;
  kind: "soul" | "skill";
  target: string;
  jobId: number;
  task: string;
  createdAt: string;
}

/** ADR-098 item 8: a soul proposal's or skill edit's test run: counts, and per case the cut answers and the judge's reason. */
export interface TestsItem {
  better: number;
  same: number;
  worse: number;
  notRun: number;
  failed: number;
  running: number;
  results: { caseId: number; task: string; state: "running" | "done" | "failed" | "skipped"; better?: "old" | "new" | "same"; reason?: string; oldAnswer?: string; newAnswer?: string }[];
}

export interface McpItem {
  id: number;
  name: string;
  kind: "command" | "url";
  command?: string;
  args: string[];
  url?: string;
  transport: "http" | "sse";
  envKeys: string[];
  headerKeys: string[];
  enabled: boolean;
  trusted: boolean;
  workers: string[];
  tools: string[];
  testedAt?: string;
  problem?: string;
}

/** Task 3.16: a task ZENO handed to Keshab's Paperclip. Titles and results never logged. */
export interface PaperclipItem {
  id: string;
  identifier?: string;
  title: string;
  agent: string;
  status: string;
  createdAt: string;
  result?: string;
}

/** One model the Claude plan offers to worker jobs (ADR-083). */
export interface ModelItem {
  id: string;
  name: string;
  tier: "small" | "medium" | "large";
}

/** A worker's soul (ADR-082, Task 3.3). Travels only over the private pipe; never logged. */
export interface SoulItem {
  name: string;
  personality: string;
  howItWorks: string;
  rules: string;
  lessons: string;
}

/** One helper and its newest jobs (ADR-081), in the fixed order. */
export interface HelperItem {
  id: string;
  /** The soul's name. */
  name: string;
  available: boolean;
  role: string;
  /** ADR-088: what it may use (fixed in code), and whether Keshab added it. */
  kit: "research" | "folders" | "think";
  custom: boolean;
  soul: SoulItem;
  soulVersion: number;
  /** Newest first, at most 10; `createdAt` is ISO 8601. */
  soulVersions: { version: number; createdAt: string }[];
  app: string | null;
  /** The pinned model id (ADR-083), or null to let Laya choose. */
  pinnedModel: string | null;
  /** Task 3.7: the daily cap in dollars of API-equivalent use (null: none) and today's spend. */
  budget: { cap: number | null; spent: number };
  /** Task 3.8: its new tasks plan first. */
  planFirst: boolean;
  /** ADR-098: its runs get the browser (default false). */
  browser?: boolean;
  /**
   * Task 3.9: its routines: `when` in words ("Every day at 8:00 AM"), when it last came due, and whether that was skipped.
   * ADR-094: whether it is paused, and when it next comes due (absent while paused).
   */
  routines: { id: number; task: string; when: string; lastAt?: string; lastSkipped?: boolean; paused?: boolean; nextAt?: string; schedule?: RoutineSchedule; notifyTelegram?: boolean; webhook?: boolean }[];
  /** ADR-094: its wake-ups (absent: off): how often, in words, paused, the last and next wake. */
  wakeUp?: WakeUpItem;
  /** Task 3.11: the folders it may work in (coder, designer, documenter). */
  grants: string[];
  /** Task 3.12: the skills chosen for it. */
  skills: string[];
  /** Task 3.13: Tinker's proposals for its soul: `field` changed to `text`, why, the task reviewed, and their state. */
  proposals: { id: number; field: string; text: string; reason: string; jobId: number; state: string; createdAt: string; tests?: TestsItem }[];
  /** ADR-095: its Manager's id; absent when it has none. */
  manager?: string;
  jobs: JobItem[];
}

/** ADR-095: a Manager: a domain with Agents under it, its mode, budget and its own runs (plan mode). */
export interface ManagerItem {
  id: string;
  name: string;
  /** "plan": plans and reviews (short no-tools runs); "group": a department only, no model calls. */
  mode: "plan" | "group";
  soul: SoulItem;
  soulVersion: number;
  budget: { cap: number | null; spent: number };
  /** Its Agents' ids. */
  agents: string[];
  jobs: JobItem[];
}

/** ADR-094: a worker's wake-ups. `nextAt` is ISO 8601 (the time it would wake, also while paused). */
/** ADR-097: a routine's schedule as numbers, so the window's form can show it for editing. */
export interface RoutineSchedule {
  kind: "daily" | "weekly" | "hours";
  minute?: number;
  weekday?: number;
  every?: number;
}

export interface WakeUpItem {
  every: "15m" | "1h" | "4h" | "1d";
  when: string;
  paused?: boolean;
  lastAt?: string;
  nextAt: string;
}

/** ADR-094: a task posted to the team, waiting to be taken (no `role`: anyone). Task text never logged. */
export interface TeamTaskItem {
  id: number;
  task: string;
  role?: string;
  createdAt: string;
}

/** One job's report (ADR-081). Never logged. */
export interface ReportEvent {
  type: "report";
  id: number;
  title: string;
  summary: string;
  body: string;
  sources: { title: string; url: string }[];
}

/** Claude plan usage (ADR-076): the share of each window used, 0.42 = 42%. Each field only when the SDK sent a sane one. */
export interface PlanUsageEvent {
  type: "plan.usage";
  fiveHour?: number;
  sevenDay?: number;
  overage?: boolean;
}

export type IslandEvent =
  | { type: "ready"; protocol: number; provider: string; model: string; microphone: string; voice: boolean; telegram?: boolean }
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
  | { type: "conversation.reset" }
  | { type: "computer.step"; text: string }
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
  | { type: "memory"; enabled: boolean; count: number; memories: MemoryItem[]; episodes: EpisodeItem[]; chats?: MemoryChatItem[] }
  /** ADR-091: Keshab's chats, newest first, and the one ZENO is in now (voice goes to it). */
  /** ADR-097: `currentProvider` / `currentModel`: the current chat's own model; absent when it uses the default. */
  | { type: "chats"; chats: ChatItem[]; current: string; currentProvider?: string; currentModel?: string }
  /** ADR-091: ZENO's task branches, like pull requests; a branch's changes as a patch. */
  | { type: "git"; branches: GitBranchItem[] }
  | { type: "git.diff"; repo: string; branch: string; text: string; truncated: boolean }
  /** ADR-091: a chat was opened: its turns, to show. */
  | { type: "chat.opened"; id: string; messages: { role: "user" | "assistant"; text: string }[] }
  | {
      type: "helpers";
      helpers: HelperItem[];
      apps: string[];
      allowLarge?: boolean;
      models?: ModelItem[];
      /** Task 3.7: the team's daily cap and spend, and the plan limit (percent) above which new runs wait. */
      team?: { cap: number | null; spent: number };
      planLimit?: number;
      /** ADR-095: "Runs at once", the team-wide limit on runs at the same time. */
      maxRunning?: number;
      /** ADR-098 item 7: "Use Codex when the Claude plan limit is reached", and whether Codex is found and signed in. */
      codexFallback?: boolean;
      codexReady?: boolean;
      /** Task 3.12: the skills to choose from: Keshab's in ~/.claude/skills ("yours") and, ADR-094, ZENO's own ("zeno"). */
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
      /** ADR-093: agent folders whose soul.md could not be loaded (folder name and why); absent when there are none. */
      agentProblems?: { id: string; problem: string }[];
      /** ADR-094: the team tasks waiting to be taken, oldest first. */
      teamTasks?: TeamTaskItem[];
      /** ADR-095: the Managers, by folder name; absent when there are none. */
      managers?: ManagerItem[];
    }
  | ThreadEvent
  | SearchResultsEvent
  /** Task 3.15: a line from the team (a goal done, a plan waiting), sent just before ZENO says it. */
  | { type: "worker.line"; line: string }
  | { type: "error"; stage: ErrorStage; message: string; kind?: string; retryable?: boolean };

const COMMANDS = new Set<IslandCommand["type"]>([
  "talk.start",
  "talk.send",
  "talk.cancel",
  "conversation.reset",
  "model.set",
  "model.refresh",
  "chat.model",
  "approval.answer",
  "memory.list",
  "chats.list",
  "chat.open",
  "chat.delete",
  "memory.keepChat",
  "memory.dropChat",
  "git.list",
  "git.push",
  "git.diff",
  "memory.forget",
  "memory.clear",
  "text.send",
  "episode.forget",
  "episode.clear",
  "context.window",
  "helpers.list",
  "speech.set",
  "telegram.set",
  "api.set",
  "tools.scan",
  "helper.set",
  "job.add",
  "plan.approve",
  "plan.reject",
  "helper.planFirst",
  "helper.browser",
  "routine.delete",
  "routine.pause",
  "routine.add",
  "routine.update",
  "team.add",
  "team.delete",
  "helper.wakeUp",
  "helper.wakeUp.pause",
  "grant.add",
  "helper.skills",
  "job.rate",
  "job.open",
  "job.retry",
  "mcp.add",
  "mcp.remove",
  "mcp.set",
  "mcp.test",
  "agent.create",
  "agent.remove",
  "manager.create",
  "manager.rename",
  "manager.mode",
  "manager.delete",
  "agent.manager",
  "proposal.accept",
  "proposal.reject",
  "proposal.undo",
  "skill.make",
  "skill.hub.search",
  "skill.hub.preview",
  "skill.hub.approve",
  "skill.hub.reject",
  "skill.hub.uninstall",
  "skill.hub.update",
  "skill.approve",
  "skill.reject",
  "skill.edit.accept",
  "skill.edit.reject",
  "skill.edit.undo",
  "testcase.save",
  "testcase.delete",
  "testcase.run",
  "grant.remove",
  "job.stop",
  "job.fresh",
  "job.delete",
  "helper.pin",
  "helpers.settings",
  "helper.budget",
  "soul.set",
  "soul.restore",
  "job.block",
  "comment.add",
  "job.steer",
  "job.interrupt",
  "job.undo",
  "search",
  "job.label.add",
  "job.label.remove",
  "thread.get",
  "quit",
]);

export type ParsedLine = { command: IslandCommand } | { error: string } | { blank: true };

/** Parses one line from the island. Never throws: a bad line becomes an error to report. */
export function parseCommand(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === "") return { blank: true };
  if (trimmed.length > MAX_COMMAND_LENGTH) return { error: `Command too long (${trimmed.length} characters, limit ${MAX_COMMAND_LENGTH}).` };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { error: "Command is not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "Command must be a JSON object." };
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return { error: 'Command has no "type".' };
  if (!COMMANDS.has(type as IslandCommand["type"])) return { error: `Unknown command "${type.slice(0, 40)}".` };
  if (type === "model.set") {
    const { provider, model } = value as { provider?: unknown; model?: unknown };
    if (typeof provider !== "string") return { error: 'model.set needs a "provider" string.' };
    if (typeof model !== "string") return { error: 'model.set needs a "model" string.' };
    return { command: { type, provider, model } };
  }
  if (type === "chat.model") {
    const { id, provider, model } = value as { id?: unknown; provider?: unknown; model?: unknown };
    if (typeof id !== "string" || !/^[\w-]{0,100}$/.test(id)) return { error: 'chat.model needs the chat\'s "id" ("" for the chat in use).' };
    if (typeof provider !== "string" || typeof model !== "string") return { error: 'chat.model needs "provider" and "model" strings ("" for the default).' };
    return { command: { type, id, provider, model } };
  }
  if (type === "approval.answer") {
    const { id, approved } = value as { id?: unknown; approved?: unknown };
    if (typeof id !== "string" || id === "") return { error: 'approval.answer needs an "id" string.' };
    if (typeof approved !== "boolean") return { error: 'approval.answer needs "approved" to be true or false.' };
    return { command: { type, id, approved } };
  }
  if (type === "text.send") {
    const { text } = value as { text?: unknown };
    if (typeof text !== "string" || !text.trim()) return { error: 'text.send needs a non-empty "text".' };
    if (text.length > 4000) return { error: "text.send: the text is longer than 4000 characters." };
    return { command: { type, text } };
  }
  if (type === "context.window") {
    const { bundleId, name } = value as { bundleId?: unknown; name?: unknown };
    const ok = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= 200;
    if (!ok(bundleId) || !ok(name)) return { error: 'context.window needs "bundleId" and "name" strings (1 to 200 characters).' };
    return { command: { type, bundleId, name } };
  }
  if (type === "helper.set") {
    const { helper, app } = value as { helper?: unknown; app?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.set needs a "helper" string.' };
    if (typeof app !== "string") return { error: 'helper.set needs an "app" string ("" for none).' };
    return { command: { type, helper, app } };
  }
  if (type === "job.add") {
    // An empty or long task is the store's to refuse (stage "settings"), as the protocol says.
    const { helper, task } = value as { helper?: unknown; task?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'job.add needs a "helper" string.' };
    if (typeof task !== "string") return { error: 'job.add needs a "task" string.' };
    const { blockedBy, planFirst } = value as { blockedBy?: unknown; planFirst?: unknown };
    if (blockedBy !== undefined && !isIdList(blockedBy)) return { error: 'job.add needs "blockedBy" to be a list of whole numbers.' };
    if (planFirst !== undefined && typeof planFirst !== "boolean") return { error: 'job.add needs "planFirst" to be true or false.' };
    return { command: { type, helper, task, ...(blockedBy !== undefined ? { blockedBy } : {}), ...(planFirst !== undefined ? { planFirst } : {}) } };
  }
  if (type === "agent.create") {
    // Names, roles, kits and soul limits are the store's to refuse (stage "settings").
    const v = value as Record<string, unknown>;
    const text = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
    if (text("name") === undefined || text("role") === undefined || text("personality") === undefined) return { error: 'agent.create needs "name", "role" and "personality" strings.' };
    const kit = text("kit");
    if (kit !== "research" && kit !== "folders" && kit !== "think") return { error: 'agent.create needs "kit": "research", "folders" or "think".' };
    return { command: { type, name: text("name")!, role: text("role")!, kit, personality: text("personality")!, howItWorks: text("howItWorks") ?? "", rules: text("rules") ?? "" } };
  }
  if (type === "agent.remove") {
    const { id } = value as { id?: unknown };
    if (typeof id !== "string" || !id) return { error: 'agent.remove needs an "id" string.' };
    return { command: { type, id } };
  }
  if (type === "manager.create" || type === "manager.rename") {
    // Names are the store's to refuse (stage "settings").
    const { id, name, mode } = value as { id?: unknown; name?: unknown; mode?: unknown };
    if (typeof name !== "string") return { error: `${type} needs a "name" string.` };
    if (type === "manager.rename") {
      if (typeof id !== "string" || !id) return { error: 'manager.rename needs an "id" string.' };
      return { command: { type, id, name } };
    }
    if (mode !== undefined && mode !== "plan" && mode !== "group") return { error: 'manager.create needs "mode": "plan" or "group" (or left out).' };
    return { command: { type, name, ...(mode ? { mode } : {}) } };
  }
  if (type === "manager.mode") {
    const { id, mode } = value as { id?: unknown; mode?: unknown };
    if (typeof id !== "string" || !id) return { error: 'manager.mode needs an "id" string.' };
    if (mode !== "plan" && mode !== "group") return { error: 'manager.mode needs "mode": "plan" or "group".' };
    return { command: { type, id, mode } };
  }
  if (type === "manager.delete") {
    const { id } = value as { id?: unknown };
    if (typeof id !== "string" || !id) return { error: 'manager.delete needs an "id" string.' };
    return { command: { type, id } };
  }
  if (type === "agent.manager") {
    const { helper, manager } = value as { helper?: unknown; manager?: unknown };
    if (typeof helper !== "string" || !helper || typeof manager !== "string" || !manager) return { error: 'agent.manager needs "helper" and "manager" strings.' };
    return { command: { type, helper, manager } };
  }
  if (type === "mcp.add") {
    // Names, commands, addresses and lines are the store's to refuse (stage "settings").
    const v = value as Record<string, unknown>;
    const lines = (k: string) => (Array.isArray(v[k]) && (v[k] as unknown[]).every((x) => typeof x === "string") ? (v[k] as string[]).slice(0, 40) : undefined);
    if (typeof v.name !== "string" || (v.kind !== "command" && v.kind !== "url")) return { error: 'mcp.add needs a "name" and a "kind" ("command" or "url").' };
    return {
      command: {
        type, name: v.name, kind: v.kind,
        ...(typeof v.command === "string" ? { command: v.command } : {}),
        ...(lines("args") ? { args: lines("args") } : {}),
        ...(lines("env") ? { env: lines("env") } : {}),
        ...(typeof v.url === "string" ? { url: v.url } : {}),
        ...(v.transport === "sse" || v.transport === "http" ? { transport: v.transport } : {}),
        ...(lines("headers") ? { headers: lines("headers") } : {}),
      },
    };
  }
  if (type === "mcp.set") {
    const { id, enabled, trusted, workers } = value as { id?: unknown; enabled?: unknown; trusted?: unknown; workers?: unknown };
    if (!isId(id)) return { error: 'mcp.set needs an "id" that is a whole number.' };
    if (enabled !== undefined && typeof enabled !== "boolean") return { error: 'mcp.set needs "enabled" to be true or false.' };
    if (trusted !== undefined && typeof trusted !== "boolean") return { error: 'mcp.set needs "trusted" to be true or false.' };
    if (workers !== undefined && !(Array.isArray(workers) && workers.length <= 40 && workers.every((w) => typeof w === "string"))) return { error: 'mcp.set needs "workers", a list of worker ids.' };
    return { command: { type, id, ...(enabled !== undefined ? { enabled } : {}), ...(trusted !== undefined ? { trusted } : {}), ...(workers !== undefined ? { workers } : {}) } };
  }
  if (type === "api.set") {
    const { on } = value as { on?: unknown };
    if (typeof on !== "boolean") return { error: 'api.set needs "on" to be true or false.' };
    return { command: { type, on } };
  }
  if (type === "telegram.set") {
    const { push } = value as { push?: unknown };
    if (typeof push !== "boolean") return { error: 'telegram.set needs "push" to be true or false.' };
    return { command: { type, push } };
  }
  if (type === "speech.set") {
    const { reports, updates, chime } = value as { reports?: unknown; updates?: unknown; chime?: unknown };
    if (typeof reports !== "boolean" || typeof updates !== "boolean") return { error: 'speech.set needs "reports" and "updates", each true or false.' };
    if (chime !== undefined && typeof chime !== "boolean") return { error: 'speech.set needs "chime" to be true or false (or left out).' };
    return { command: { type, reports, updates, ...(chime !== undefined ? { chime } : {}) } };
  }
  if (type === "job.rate") {
    const { id, good, comment } = value as { id?: unknown; good?: unknown; comment?: unknown };
    if (!isId(id)) return { error: 'job.rate needs an "id" that is a whole number.' };
    if (typeof good !== "boolean") return { error: 'job.rate needs "good" to be true or false.' };
    if (comment !== undefined && typeof comment !== "string") return { error: 'job.rate needs "comment" to be a string.' };
    return { command: { type, id, good, ...(comment !== undefined ? { comment } : {}) } };
  }
  if (type === "helper.skills") {
    const { helper, skills } = value as { helper?: unknown; skills?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.skills needs a "helper" string.' };
    if (!Array.isArray(skills) || skills.length > 20 || !skills.every((s) => typeof s === "string")) return { error: 'helper.skills needs "skills", a list of names.' };
    return { command: { type, helper, skills } };
  }
  if (type === "grant.add" || type === "grant.remove") {
    // Which folders may be granted is the store's to refuse (stage "settings").
    const { helper, path } = value as { helper?: unknown; path?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: `${type} needs a "helper" string.` };
    if (typeof path !== "string" || path === "" || path.length > 1024) return { error: `${type} needs a "path" string.` };
    return { command: { type, helper, path } };
  }
  if (type === "helper.planFirst" || type === "helper.browser") {
    const { helper, on } = value as { helper?: unknown; on?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: `${type} needs a "helper" string.` };
    if (typeof on !== "boolean") return { error: `${type} needs "on" to be true or false.` };
    return { command: { type, helper, on } };
  }
  if (type === "routine.pause") {
    const { id, paused } = value as { id?: unknown; paused?: unknown };
    if (!isId(id)) return { error: 'routine.pause needs an "id" that is a whole number.' };
    if (typeof paused !== "boolean") return { error: 'routine.pause needs "paused" to be true or false.' };
    return { command: { type, id, paused } };
  }
  if (type === "routine.add" || type === "routine.update") {
    const id = (value as { id?: unknown }).id;
    if (type === "routine.update" && !isId(id)) return { error: 'routine.update needs an "id" that is a whole number.' };
    const input = routineInput(type, value as Record<string, unknown>);
    if ("error" in input) return input;
    return { command: type === "routine.update" ? { type, id: id as number, ...input } : { type, ...input } };
  }
  if (type === "team.add") {
    // An empty or long task, and a role no worker has, are the store's to refuse (stage "settings").
    const { task, role } = value as { task?: unknown; role?: unknown };
    if (typeof task !== "string") return { error: 'team.add needs a "task" string.' };
    if (role !== undefined && (typeof role !== "string" || role.length > 40)) return { error: 'team.add needs "role" to be a role name (or left out for anyone).' };
    return { command: { type, task, ...(role ? { role } : {}) } };
  }
  if (type === "helper.wakeUp") {
    const { helper, every } = value as { helper?: unknown; every?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.wakeUp needs a "helper" string.' };
    if (every !== "off" && every !== "15m" && every !== "1h" && every !== "4h" && every !== "1d") return { error: 'helper.wakeUp needs "every": "off", "15m", "1h", "4h" or "1d".' };
    return { command: { type, helper, every } };
  }
  if (type === "helper.wakeUp.pause") {
    const { helper, paused } = value as { helper?: unknown; paused?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.wakeUp.pause needs a "helper" string.' };
    if (typeof paused !== "boolean") return { error: 'helper.wakeUp.pause needs "paused" to be true or false.' };
    return { command: { type, helper, paused } };
  }
  if (type === "job.block") {
    const { id, blockedBy } = value as { id?: unknown; blockedBy?: unknown };
    if (!isId(id)) return { error: 'job.block needs an "id" that is a whole number.' };
    if (!isIdList(blockedBy)) return { error: 'job.block needs "blockedBy" to be a list of whole numbers.' };
    return { command: { type, id, blockedBy } };
  }
  if (type === "comment.add") {
    // An empty or long note is the store's to refuse (stage "settings").
    const { id, text } = value as { id?: unknown; text?: unknown };
    if (!isId(id)) return { error: 'comment.add needs an "id" that is a whole number.' };
    if (typeof text !== "string") return { error: 'comment.add needs a "text" string.' };
    return { command: { type, id, text } };
  }
  if (type === "job.steer") {
    const { id, text } = value as { id?: unknown; text?: unknown };
    if (!isId(id)) return { error: 'job.steer needs an "id" that is a whole number.' };
    if (typeof text !== "string" || !text.trim() || text.trim().length > MAX_STEER_CHARS) return { error: `job.steer needs a "text" of 1 to ${MAX_STEER_CHARS} characters.` };
    return { command: { type, id, text } };
  }
  if (type === "search") {
    const { query } = value as { query?: unknown };
    if (typeof query !== "string" || query.length > MAX_SEARCH_QUERY) return { error: `search needs a "query" string of at most ${MAX_SEARCH_QUERY} characters.` };
    return { command: { type, query } };
  }
  if (type === "job.undo") {
    const { id, path, force } = value as { id?: unknown; path?: unknown; force?: unknown };
    if (!isId(id)) return { error: 'job.undo needs an "id" that is a whole number.' };
    if (path !== undefined && (typeof path !== "string" || !path || path.length > 4096)) return { error: 'job.undo needs "path" to be a non-empty string.' };
    if (force !== undefined && typeof force !== "boolean") return { error: 'job.undo needs "force" to be true or false.' };
    return { command: { type, id, ...(path !== undefined ? { path } : {}), ...(force !== undefined ? { force } : {}) } };
  }
  if (type === "job.label.add" || type === "job.label.remove") {
    // Which labels are allowed is the store's to refuse (stage "settings").
    const { id, label } = value as { id?: unknown; label?: unknown };
    if (!isId(id)) return { error: `${type} needs an "id" that is a whole number.` };
    if (typeof label !== "string" || label.length > 100) return { error: `${type} needs a "label" string.` };
    return { command: { type, id, label } };
  }
  if (type === "helper.pin") {
    // Whether the model is offered is the helpers' to refuse (stage "settings"), as the protocol says.
    const { helper, model } = value as { helper?: unknown; model?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.pin needs a "helper" string.' };
    if (typeof model !== "string") return { error: 'helper.pin needs a "model" string ("" to let Laya choose).' };
    return { command: { type, helper, model } };
  }
  if (type === "helpers.settings") {
    // The ranges are the store's to refuse (stage "settings").
    const { allowLarge, planLimit, maxRunning, codexFallback } = value as { allowLarge?: unknown; planLimit?: unknown; maxRunning?: unknown; codexFallback?: unknown };
    if (allowLarge !== undefined && typeof allowLarge !== "boolean") return { error: 'helpers.settings needs "allowLarge" to be true or false.' };
    if (planLimit !== undefined && typeof planLimit !== "number") return { error: 'helpers.settings needs "planLimit" to be a number.' };
    if (maxRunning !== undefined && typeof maxRunning !== "number") return { error: 'helpers.settings needs "maxRunning" to be a number.' };
    if (codexFallback !== undefined && typeof codexFallback !== "boolean") return { error: 'helpers.settings needs "codexFallback" to be true or false.' };
    if (allowLarge === undefined && planLimit === undefined && maxRunning === undefined && codexFallback === undefined) {
      return { error: 'helpers.settings needs "allowLarge", "planLimit", "maxRunning" or "codexFallback".' };
    }
    return {
      command: {
        type,
        ...(allowLarge !== undefined ? { allowLarge } : {}),
        ...(planLimit !== undefined ? { planLimit } : {}),
        ...(maxRunning !== undefined ? { maxRunning } : {}),
        ...(codexFallback !== undefined ? { codexFallback } : {}),
      },
    };
  }
  if (type === "helper.budget") {
    // The amount's range is the store's to refuse (stage "settings").
    const { helper, cap } = value as { helper?: unknown; cap?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.budget needs a "helper" string ("team" for the team).' };
    if (cap !== null && typeof cap !== "number") return { error: 'helper.budget needs a "cap" number, or null for none.' };
    return { command: { type, helper, cap } };
  }
  if (type === "soul.set") {
    // Lengths, names and empty fields are the store's to refuse (stage "settings"), as the protocol says.
    const { helper, soul } = value as { helper?: unknown; soul?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'soul.set needs a "helper" string.' };
    if (typeof soul !== "object" || soul === null || Array.isArray(soul)) return { error: 'soul.set needs a "soul" object.' };
    const fields = ["name", "personality", "howItWorks", "rules", "lessons"] as const;
    const s = soul as Record<string, unknown>;
    const missing = fields.find((f) => typeof s[f] !== "string");
    if (missing) return { error: `soul.set needs "soul.${missing}" as a string.` };
    const clean = Object.fromEntries(fields.map((f) => [f, s[f]])) as unknown as SoulItem; // extra fields dropped
    return { command: { type, helper, soul: clean } };
  }
  if (type === "soul.restore") {
    const { helper, version } = value as { helper?: unknown; version?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'soul.restore needs a "helper" string.' };
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return { error: 'soul.restore needs a "version" that is a whole number.' };
    return { command: { type, helper, version } };
  }
  if (type === "git.push" || type === "git.diff") {
    // Which repositories and branches are allowed is the runtime's to check (only ZENO's task branches, in granted folders).
    const { repo, branch } = value as { repo?: unknown; branch?: unknown };
    if (typeof repo !== "string" || !repo.startsWith("/") || repo.length > 1000 || typeof branch !== "string" || !/^zeno\/task-\d{1,9}$/.test(branch)) {
      return { error: `${type} needs a "repo" (a full path) and a "branch" (zeno/task-<id>).` };
    }
    return { command: { type, repo, branch } };
  }
  if (type === "chat.open" || type === "chat.delete" || type === "memory.keepChat" || type === "memory.dropChat") {
    const { id } = value as { id?: unknown };
    if (typeof id !== "string" || !/^[\w-]{1,100}$/.test(id)) return { error: `${type} needs the chat's "id".` };
    return { command: { type, id } };
  }
  if (type === "testcase.save") {
    const { jobId, kind, target } = value as { jobId?: unknown; kind?: unknown; target?: unknown };
    if (typeof jobId !== "number" || !Number.isInteger(jobId) || jobId < 1) return { error: 'testcase.save needs a "jobId" that is a whole number.' };
    if (kind !== "soul" && kind !== "skill") return { error: 'testcase.save needs "kind": "soul" or "skill".' };
    if (typeof target !== "string" || target === "" || target.length > 100) return { error: 'testcase.save needs a "target" string.' };
    return { command: { type, jobId, kind, target } };
  }
  if (type === "testcase.run") {
    const { proposalKind, id } = value as { proposalKind?: unknown; id?: unknown };
    if (proposalKind !== "soul" && proposalKind !== "skill") return { error: 'testcase.run needs "proposalKind": "soul" or "skill".' };
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return { error: 'testcase.run needs an "id" that is a whole number.' };
    return { command: { type, proposalKind, id } };
  }
  if (type === "testcase.delete") {
    const { id } = value as { id?: unknown };
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return { error: 'testcase.delete needs an "id" that is a whole number.' };
    return { command: { type, id } };
  }
  if (type === "skill.hub.search") {
    const { query } = value as { query?: unknown };
    if (typeof query !== "string" || query.trim() === "" || query.length > 60) return { error: 'skill.hub.search needs a "query" of 1 to 60 characters.' };
    return { command: { type, query } };
  }
  if (type === "skill.hub.preview") {
    const { source, path } = value as { source?: unknown; path?: unknown };
    if (typeof source !== "number" || !Number.isInteger(source) || source < 0) return { error: 'skill.hub.preview needs a "source" that is a whole number.' };
    if (typeof path !== "string" || path === "" || path.length > 200) return { error: 'skill.hub.preview needs a "path" string.' };
    return { command: { type, source, path } };
  }
  if (type === "skill.hub.uninstall" || type === "skill.hub.update") {
    const { name, force } = value as { name?: unknown; force?: unknown };
    if (typeof name !== "string" || name === "" || name.length > 64) return { error: `${type} needs a "name" string.` };
    if (type === "skill.hub.update") return { command: { type, name } };
    if (force !== undefined && typeof force !== "boolean") return { error: 'skill.hub.uninstall needs "force" to be true or false (or left out).' };
    return { command: { type, name, ...(force !== undefined ? { force } : {}) } };
  }
  if (type === "skill.hub.approve" || type === "skill.hub.reject") {
    const { id } = value as { id?: unknown };
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return { error: `${type} needs an "id" that is a whole number.` };
    return { command: { type, id } };
  }
  if (type === "memory.forget" || type === "episode.forget" || type === "job.stop" || type === "job.interrupt" || type === "job.fresh" || type === "plan.approve" || type === "plan.reject" || type === "routine.delete" || type === "team.delete" || type === "job.open" || type === "job.retry" || type === "mcp.remove" || type === "mcp.test" || type === "proposal.accept" || type === "proposal.reject" || type === "proposal.undo" || type === "job.delete" || type === "thread.get" || type === "skill.make" || type === "skill.approve" || type === "skill.reject" || type === "skill.edit.accept" || type === "skill.edit.reject" || type === "skill.edit.undo") {
    const { id } = value as { id?: unknown };
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return { error: `${type} needs an "id" that is a whole number.` };
    return { command: { type, id } };
  }
  return { command: { type } as IslandCommand }; // extra fields are ignored (forward compatibility)
}

/** ADR-097: the shape of a schedule from the form. The numbers' ranges, the worker and the task are the store's to refuse. */
function routineInput(type: string, v: Record<string, unknown>): RoutineInput | { error: string } {
  const { helper, task, kind, minute, weekday, every, startAt, notifyTelegram, webhook } = v;
  const whole = (n: unknown) => n === undefined || (typeof n === "number" && Number.isInteger(n));
  if (typeof helper !== "string" || helper === "") return { error: `${type} needs a "helper" string.` };
  if (typeof task !== "string") return { error: `${type} needs a "task" string.` };
  if (kind !== "daily" && kind !== "weekly" && kind !== "hours") return { error: `${type} needs "kind": "daily", "weekly" or "hours".` };
  if (!whole(minute) || !whole(weekday) || !whole(every)) return { error: `${type} needs "minute", "weekday" and "every" to be whole numbers.` };
  if (startAt !== undefined && (typeof startAt !== "string" || Number.isNaN(Date.parse(startAt)))) return { error: `${type} needs "startAt" to be an ISO 8601 time.` };
  if (notifyTelegram !== undefined && typeof notifyTelegram !== "boolean") return { error: `${type} needs "notifyTelegram" to be true or false (or left out).` };
  if (webhook !== undefined && typeof webhook !== "boolean") return { error: `${type} needs "webhook" to be true or false (or left out).` };
  return {
    helper, task, kind,
    ...(minute !== undefined ? { minute: minute as number } : {}),
    ...(weekday !== undefined ? { weekday: weekday as number } : {}),
    ...(every !== undefined ? { every: every as number } : {}),
    ...(startAt !== undefined ? { startAt: startAt as string } : {}),
    ...(notifyTelegram !== undefined ? { notifyTelegram } : {}),
    ...(webhook !== undefined ? { webhook } : {}),
  };
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isIdList = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 20 && v.every(isId);

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
