// The commands from the island, their allowlist and the parser (moved from island-protocol.ts; docs/island-protocol.md is the specification).

import type { RoutineInput, SoulItem } from "./island-items.ts";
import { BRANCH_COMMAND_PATTERN, BRANCH_SHAPE } from "./branch-prefix.ts";

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
  /** The second brain: the graph (and, from then on, again after each change), one note, a save (new, or a rename with `id`), a delete, a search. */
  | { type: "brain.get" }
  | { type: "brain.note"; id: number }
  | { type: "brain.save"; id?: number; title: string; body: string }
  | { type: "brain.delete"; id: number }
  | { type: "brain.search"; query: string }
  /** Plugins → Skills: one skill's whole SKILL.md for the editor, and Keshab's save of it (the answer is `skill.file`). */
  /** The "/" picker: ask for Keshab's Claude commands (ADR-117; the answer is `commands`). */
  | { type: "commands.list" }
  | { type: "skill.get"; name: string }
  | { type: "skill.save"; name: string; text: string }
  | { type: "chats.list" }
  /** ADR-107: a new chat, in a project when `projectId` is given (`conversation.reset` is the same without a project). */
  | { type: "chat.new"; projectId?: string }
  /** ADR-107: Keshab's own title for a chat (any chat the window writes). */
  | { type: "chat.rename"; id: string; title: string }
  /** ADR-107: projects. `path` is the folder's full path; `deleteChats` false (the default) keeps the chats as plain chats. */
  | { type: "project.add"; name: string; path: string }
  | { type: "project.rename"; id: string; name: string }
  | { type: "project.remove"; id: string; deleteChats?: boolean }
  | { type: "project.archive"; id: string; archived: boolean }
  /** provider and model "" clear the project's model (the global model applies). */
  | { type: "project.model"; id: string; provider: string; model: string }
  | { type: "project.web"; id: string; web: boolean }
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
  | { type: "text.send"; text: string; files?: string[] }
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
  /** ADR-094: pause or resume a routine. */
  | { type: "routine.pause"; id: number; paused: boolean }
  /** ADR-097: Keshab's own schedule from the Scheduled page, new or changed. */
  | ({ type: "routine.add" } & RoutineInput)
  | ({ type: "routine.update"; id: number } & RoutineInput)
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
  | { type: "proposal.accept"; id: number }
  | { type: "proposal.reject"; id: number }
  | { type: "proposal.undo"; id: number }
  // ADR-098 item 8: save a done task as a test case (for its agent's soul or a ATOM-made skill its run used), delete one,
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
  | { type: "helpers.settings"; allowLarge?: boolean }
  | { type: "soul.set"; helper: string; soul: SoulItem }
  | { type: "soul.restore"; helper: string; version: number }
  | { type: "quit" };

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
  "brain.get",
  "brain.note",
  "brain.save",
  "brain.delete",
  "brain.search",
  "commands.list",
  "skill.get",
  "skill.save",
  "chats.list",
  "chat.new",
  "chat.rename",
  "project.add",
  "project.rename",
  "project.remove",
  "project.archive",
  "project.model",
  "project.web",
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
    const { text, files } = value as { text?: unknown; files?: unknown };
    // Files may go with the words (ADR-113): up to 5 full paths; the words may then be empty.
    if (files !== undefined && (!Array.isArray(files) || files.length > 5 || files.some((f) => typeof f !== "string" || f === "" || f.length > 1000))) {
      return { error: 'text.send: "files" is a list of up to 5 full paths.' };
    }
    const attached = (files as string[] | undefined) ?? [];
    if (typeof text !== "string" || (!text.trim() && !attached.length)) return { error: 'text.send needs a non-empty "text".' };
    if (text.length > 4000) return { error: "text.send: the text is longer than 4000 characters." };
    return { command: { type, text, ...(attached.length ? { files: attached } : {}) } };
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
    const { allowLarge } = value as { allowLarge?: unknown };
    if (typeof allowLarge !== "boolean") return { error: 'helpers.settings needs "allowLarge" to be true or false.' };
    return { command: { type, allowLarge } };
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
    // Which repositories and branches are allowed is the runtime's to check (only ATOM's task branches, in granted folders).
    const { repo, branch } = value as { repo?: unknown; branch?: unknown };
    if (typeof repo !== "string" || !repo.startsWith("/") || repo.length > 1000 || typeof branch !== "string" || !BRANCH_COMMAND_PATTERN.test(branch)) {
      return { error: `${type} needs a "repo" (a full path) and a "branch" (${BRANCH_SHAPE}).` };
    }
    return { command: { type, repo, branch } };
  }
  const projects = projectCommand(type, value as Record<string, unknown>);
  if (projects) return projects;
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
  if (type === "brain.note" || type === "brain.delete") {
    const { id } = value as { id?: unknown };
    if (!isId(id)) return { error: `${type} needs an "id" that is a whole number.` };
    return { command: { type, id } };
  }
  if (type === "brain.save") {
    // The title and body limits are the brain's to refuse (stage "settings").
    const { id, title, body } = value as { id?: unknown; title?: unknown; body?: unknown };
    if (id !== undefined && !isId(id)) return { error: 'brain.save needs "id" to be a whole number (or left out for a new note).' };
    if (typeof title !== "string" || typeof body !== "string") return { error: 'brain.save needs "title" and "body" strings.' };
    if (title.length > 400 || body.length > 100_000) return { error: "brain.save: the note is too long." };
    return { command: { type, ...(id !== undefined ? { id } : {}), title, body } };
  }
  if (type === "skill.get" || type === "skill.save") {
    // The name is checked again where the file is read or written (SKILL_NAME); here only the shape and size.
    const { name, text } = value as { name?: unknown; text?: unknown };
    if (typeof name !== "string" || !name || name.length > 64) return { error: `${type} needs a skill "name".` };
    if (type === "skill.get") return { command: { type, name } };
    if (typeof text !== "string" || text.length > 100_000) return { error: 'skill.save needs "text", a string.' };
    return { command: { type, name, text } };
  }
  if (type === "brain.search") {
    const { query } = value as { query?: unknown };
    if (typeof query !== "string" || query.length > 200) return { error: 'brain.search needs a "query" string of at most 200 characters.' };
    return { command: { type, query } };
  }
  if (type === "memory.forget" || type === "episode.forget" || type === "job.stop" || type === "job.interrupt" || type === "job.fresh" || type === "plan.approve" || type === "plan.reject" || type === "routine.delete" || type === "job.open" || type === "job.retry" || type === "mcp.remove" || type === "mcp.test" || type === "proposal.accept" || type === "proposal.reject" || type === "proposal.undo" || type === "job.delete" || type === "thread.get" || type === "skill.make" || type === "skill.approve" || type === "skill.reject" || type === "skill.edit.accept" || type === "skill.edit.reject" || type === "skill.edit.undo") {
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

/** ADR-107: a project or chat id as it travels: letters, digits, `_` and `-`. */
const ID_SHAPE = /^[\w-]{1,100}$/;
export const MAX_PROJECT_PATH = 1000;

/** ADR-107: the project commands, chat.new and chat.rename. Undefined for any other command. */
function projectCommand(type: string, v: Record<string, unknown>): ParsedLine | undefined {
  const text = (key: string, max: number) => typeof v[key] === "string" && (v[key] as string).length <= max;
  const idOk = typeof v.id === "string" && ID_SHAPE.test(v.id);
  switch (type) {
    case "chat.new": {
      if (v.projectId === undefined) return { command: { type } };
      if (typeof v.projectId !== "string" || !ID_SHAPE.test(v.projectId)) return { error: 'chat.new: "projectId" must be a project id.' };
      return { command: { type, projectId: v.projectId } };
    }
    case "chat.rename":
      if (!idOk || !text("title", 200)) return { error: 'chat.rename needs the chat\'s "id" and a "title" string.' };
      return { command: { type, id: v.id as string, title: v.title as string } };
    case "project.add": {
      const path = v.path;
      if (!text("name", 200)) return { error: 'project.add needs a "name" string.' };
      if (typeof path !== "string" || !path.startsWith("/") || path.length > MAX_PROJECT_PATH || path.includes("\0") || path.split("/").includes("..")) {
        return { error: 'project.add needs a "path": the folder\'s full path, with no "..".' };
      }
      return { command: { type, name: v.name as string, path } };
    }
    case "project.rename":
      if (!idOk || !text("name", 200)) return { error: 'project.rename needs the project\'s "id" and a "name" string.' };
      return { command: { type, id: v.id as string, name: v.name as string } };
    case "project.remove":
      if (!idOk) return { error: 'project.remove needs the project\'s "id".' };
      if (v.deleteChats !== undefined && typeof v.deleteChats !== "boolean") return { error: 'project.remove: "deleteChats" must be true or false.' };
      return { command: { type, id: v.id as string, ...(v.deleteChats !== undefined ? { deleteChats: v.deleteChats as boolean } : {}) } };
    case "project.archive":
      if (!idOk || typeof v.archived !== "boolean") return { error: 'project.archive needs the project\'s "id" and "archived" (true or false).' };
      return { command: { type, id: v.id as string, archived: v.archived } };
    case "project.model":
      if (!idOk || !text("provider", 100) || !text("model", 200)) return { error: 'project.model needs the project\'s "id", and "provider" and "model" strings ("" for the global model).' };
      return { command: { type, id: v.id as string, provider: v.provider as string, model: v.model as string } };
    case "project.web":
      if (!idOk || typeof v.web !== "boolean") return { error: 'project.web needs the project\'s "id" and "web" (true or false).' };
      return { command: { type, id: v.id as string, web: v.web } };
    default:
      return undefined;
  }
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isIdList = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 20 && v.every(isId);

