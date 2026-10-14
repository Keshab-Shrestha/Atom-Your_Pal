// Item and event shapes of the island protocol (moved from island-protocol.ts; docs/island-protocol.md is the specification).

import type { Capability } from "@atom/tool-engine";

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
  /** ADR-093: the AI tools found on this Mac (found, signed in, what ATOM does with them). */
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
  /** Why a runnable task waits for Keshab (a plan to approve, an interrupted run); it shows under "Needs you". */
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
  /** ADR-098 item 8: the ATOM-made skills a done task's runs used (each can take it as a test case). */
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

/** ADR-091: one of ATOM's task branches, with the task's title. */
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
  /** True while ATOM writes the summary and the index. */
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
  /** ADR-107: the project this chat belongs to. Absent for a plain chat. */
  projectId?: string;
}

/** ADR-107: one project, for the sidebar. Names and folders travel only over the private pipe; never logged. */
export interface ProjectItem {
  id: string;
  name: string;
  /** The folder with the home folder as `~`. */
  folderLabel: string;
  /** The folder is gone or no longer allowed: its chats open as text only. */
  missing: boolean;
  archived: boolean;
  chatCount: number;
  /** Web search in the project's chats. */
  web: boolean;
  /** The project's own Agent (a worker id) that does every write. Absent when it has none. */
  agent?: string;
  /** The project's own model; absent when the global model applies. */
  provider?: string;
  model?: string;
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

/** ADR-091: the Dashboard's tokens: today, the week, each day, each worker (name; null for ATOM's chat), each model. */
export interface UsageItem {
  today: UsageTotalsItem;
  week: UsageTotalsItem;
  days: (UsageTotalsItem & { day: string })[];
  byWorker: (UsageTotalsItem & { helper: string | null; name: string })[];
  byModel: (UsageTotalsItem & { model: string })[];
  /** ADR-098 item 9: ATOM's last chat answers read nothing from the prompt cache. */
  chatCacheCold?: boolean;
  /** Token cost, job 4: the newest calls, newest first. Absent from an older runtime. */
  recent?: { at: string; kind: "turn" | "note" | "job"; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; gapMs?: number }[];
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

/** ADR-094: Tinker's edit to one of ATOM's skills: why, and a compact before and after (from the first changed line). */
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

/** The second brain: one note in the graph. Titles are the user's own words. */
export interface BrainNodeItem {
  id: number;
  title: string;
  kind: "note" | "memory" | "episode" | "chat" | "project" | "entity";
  ghost: boolean;
  tags: string[];
  degree: number;
  updatedAt: string;
}

export interface BrainEdgeItem {
  a: number;
  b: number;
  /** Found by ATOM, not written in a note. */
  auto: boolean;
}

export interface BrainLinkItem {
  id: number;
  title: string;
  kind: BrainNodeItem["kind"];
  ghost?: boolean;
  auto: boolean;
}

/** One note with its text, links and backlinks. */
export interface BrainNoteItem {
  id: number;
  title: string;
  body: string;
  kind: BrainNodeItem["kind"];
  ghost: boolean;
  tags: string[];
  links: BrainLinkItem[];
  backlinks: BrainLinkItem[];
  updatedAt: string;
}

export interface BrainHitItem {
  id: number;
  title: string;
  kind: BrainNodeItem["kind"];
  snippet: string;
}

/** ADR-111: one portion of a work plan. `job` is its Board task once it started. Task text is Keshab's own. */
export interface PlanPortionItem {
  n: number;
  agent: string;
  name: string;
  task: string;
  after: number[];
  job?: number;
  state: "waiting" | "running" | "done" | "failed" | "stopped" | "blocked";
}

/** ADR-111: a work plan with the state of each portion (the notch's dots and the Board's plan card). */
export interface PlanItem {
  id: number;
  goal: string;
  createdAt: string;
  portions: PlanPortionItem[];
  complete: boolean;
  stuck: boolean;
}

/** Task 3.16: a task ATOM handed to Keshab's Paperclip. Titles and results never logged. */
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
  /** Task 3.8: its new tasks plan first. */
  planFirst: boolean;
  /** ADR-098: its runs get the browser (default false). */
  browser?: boolean;
  /**
   * Task 3.9: its routines: `when` in words ("Every day at 8:00 AM"), when it last came due, and whether that was skipped.
   * ADR-094: whether it is paused, and when it next comes due (absent while paused).
   */
  routines: { id: number; task: string; when: string; lastAt?: string; lastSkipped?: boolean; paused?: boolean; nextAt?: string; schedule?: RoutineSchedule; notifyTelegram?: boolean; webhook?: boolean }[];
  /** Task 3.11: the folders it may work in (coder, designer, documenter). */
  grants: string[];
  /** Task 3.12: the skills chosen for it. */
  skills: string[];
  /** Task 3.13: Tinker's proposals for its soul: `field` changed to `text`, why, the task reviewed, and their state. */
  proposals: { id: number; field: string; text: string; reason: string; jobId: number; state: string; createdAt: string; tests?: TestsItem }[];
  jobs: JobItem[];
}

/** ADR-097: a routine's schedule as numbers, so the window's form can show it for editing. */
export interface RoutineSchedule {
  kind: "daily" | "weekly" | "hours";
  minute?: number;
  weekday?: number;
  every?: number;
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
