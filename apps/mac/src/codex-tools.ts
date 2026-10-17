import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelRequest, ToolCall, ToolResult, ToolRunner, ToolSpec } from "@atom/contracts";
import { createGateway, createCodexSessionAdapter, redact, type CodexSessionOptions } from "@atom/llm-gateway";
import { realish } from "@atom/helpers";
import { agentDefinition, nativeMembers } from "./native-agents.ts";
import { boardRecorder } from "./native-board.ts";
import { nativeGate, type NativeGate } from "./native-safety.ts";
import { planBook, withPlanTools } from "./native-plan.ts";
import type { NativeTeamDeps } from "./native-core.ts";

const MAX_FILE_BYTES = 1024 * 1024;
const READ_NAMES = ["Read", "Glob", "Grep"];
const FILE_NAMES = [...READ_NAMES, "Write", "Edit"];
const property = (description: string) => ({ type: "string", description });
const fileSpecs: ToolSpec[] = [
  { name: "Read", description: "Read one text file, up to 1 MB. Use an absolute file_path.", inputSchema: { type: "object", properties: { file_path: property("Absolute file path") }, required: ["file_path"] } },
  { name: "Glob", description: "Find files by name under path, up to four directories deep and 200 results. Protected folders and symlinks are skipped.", inputSchema: { type: "object", properties: { path: property("Absolute folder path"), pattern: property("File name glob, e.g. *.html or **/test.html") }, required: ["path", "pattern"] } },
  { name: "Grep", description: "Find a literal text pattern in one text file. Returns at most 100 matching lines.", inputSchema: { type: "object", properties: { path: property("Absolute file path"), pattern: property("Literal text to find") }, required: ["path", "pattern"] } },
  { name: "Write", description: "ATOM host tool: create or replace a text file, up to 1 MB. This tool works independently of Codex's read-only native sandbox. ATOM checks access, asks for approval when needed and keeps an undo copy.", inputSchema: { type: "object", properties: { file_path: property("Absolute file path"), content: property("Full new text") }, required: ["file_path", "content"] } },
  { name: "Edit", description: "ATOM host tool: replace exactly one occurrence of old_string in a text file. This tool has its own approval checks; Codex's native read-only sandbox does not prevent using it.", inputSchema: { type: "object", properties: { file_path: property("Absolute file path"), old_string: property("Exact existing text, nonempty and unique"), new_string: property("Replacement text") }, required: ["file_path", "old_string", "new_string"] } },
];
const exposed = (spec: ToolSpec): ToolSpec => ({ ...spec, name: `atom_${spec.name}` });
const result = (call: ToolCall, content: string, isError = false): ToolResult => ({ callId: call.id, content, ...(isError ? { isError } : {}) });

export interface CodexToolRouterOptions {
  program: string;
  model: string;
  tools: ToolRunner;
  team?: NativeTeamDeps;
  session?: Pick<CodexSessionOptions, "transport">;
  onUsage?: CodexSessionOptions["onUsage"];
  home?: string;
}

/** Codex requests policy-checked host tools; it never receives an unrestricted shell or direct write access. */
export function createCodexToolRouter(options: CodexToolRouterOptions) {
  const chats = new Map<string, { gate: NativeGate; board?: ReturnType<typeof boardRecorder>; tools: ToolRunner; cwd?: string }>();
  const running = new Map<number, AbortController>();
  const approvalSignal = new AsyncLocalStorage<AbortSignal | undefined>();

  async function checked(gate: NativeGate, call: ToolCall, worker?: { id: string; type: string; cwd: string }) {
    // Separate Codex processes may reuse RPC call ids. A host operation always needs a fresh policy decision.
    const checkId = randomUUID();
    if (!worker) return gate.canUseTool(call.name, call.input, { toolUseID: checkId });
    const pre = (gate.hooks.PreToolUse as { hooks: ((hook: Record<string, unknown>, id: string) => Promise<any>)[] }[])[0]!.hooks[0]!;
    const verdict = (await pre({ agent_id: worker.id, agent_type: worker.type, cwd: worker.cwd, tool_name: call.name, tool_input: call.input }, checkId)).hookSpecificOutput;
    return verdict.permissionDecision === "allow" ? { behavior: "allow" as const, updatedInput: verdict.updatedInput as Record<string, unknown> } : { behavior: "deny" as const, message: verdict.permissionDecisionReason as string };
  }

  async function file(gate: NativeGate, call: ToolCall, worker?: { id: string; type: string; cwd: string }, signal?: AbortSignal): Promise<ToolResult> {
    const input = { ...call.input };
    const field = call.name === "Glob" || call.name === "Grep" ? "path" : "file_path";
    if (typeof input[field] !== "string" || !input[field] || !String(input[field]).startsWith("/")) return result(call, "Use an absolute file or folder path.", true);
    // Use the checked canonical path for the operation as well as the permission lookup.
    input[field] = realish(resolve(String(input[field])));
    const validated = { ...call, input };
    const verdict = await approvalSignal.run(signal, () => checked(gate, validated, worker));
    if (signal?.aborted) return result(call, "The task was stopped; no file operation ran.", true);
    if (verdict.behavior !== "allow") return result(call, verdict.message ?? "Not allowed.", true);
    // This implementation returns matching lines: apply the full Read checks, including secret-content scanning.
    if (call.name === "Grep") {
      const readable = await checked(gate, { id: randomUUID(), name: "Read", input: { file_path: input[field] } }, worker);
      if (readable.behavior !== "allow") return result(call, readable.message ?? "That file cannot be read.", true);
    }
    const path = String(input[field]);
    try {
      if (call.name === "Glob") {
        const pattern = input.pattern;
        if (typeof pattern !== "string" || pattern.length > 200) return result(call, "Use a file-name pattern of at most 200 characters.", true);
        const namePattern = pattern.split("/").at(-1)!;
        const recursive = pattern.includes("/");
        const matcher = new RegExp(`^${namePattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "u");
        const found: string[] = []; let visited = 0;
        async function walk(dir: string, depth: number) {
          if (depth > 4 || visited >= 600 || found.length >= 200) return;
          if ((await checked(gate, { id: randomUUID(), name: "Glob", input: { path: dir, pattern: "*" } }, worker)).behavior !== "allow") return;
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (signal?.aborted) return;
            if (++visited > 600 || found.length >= 200) break;
            if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const child = join(dir, entry.name);
            if (entry.isDirectory()) { if (recursive) await walk(child, depth + 1); }
            else if (matcher.test(entry.name) && (await checked(gate, { id: randomUUID(), name: "Read", input: { file_path: child } }, worker)).behavior === "allow") found.push(child);
          }
        }
        await walk(path, 0);
        return result(call, `${found.join("\n") || "No matching files."}${visited >= 600 ? "\nSearch stopped after 600 entries; narrow the path if needed." : ""}`);
      }
      if (call.name === "Write") {
        if (typeof input.content !== "string" || Buffer.byteLength(input.content) > MAX_FILE_BYTES) return result(call, "Text must be at most 1 MB.", true);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, input.content, "utf8");
        return result(call, "File saved.");
      }
      if ((await stat(path)).size > MAX_FILE_BYTES) return result(call, "That file is larger than 1 MB; narrow the task.", true);
      const text = await readFile(path, "utf8");
      if (call.name === "Read") return result(call, text);
      if (call.name === "Grep") {
        if (typeof input.pattern !== "string" || !input.pattern || input.pattern.length > 1000) return result(call, "Use a nonempty literal pattern of at most 1000 characters.", true);
        return result(call, text.split("\n").map((line, i) => ({ line, i })).filter(({ line }) => line.includes(String(input.pattern))).slice(0, 100).map(({ line, i }) => `${i + 1}: ${line.slice(0, 500)}`).join("\n") || "No matching lines.");
      }
      if (typeof input.old_string !== "string" || !input.old_string || typeof input.new_string !== "string") return result(call, "Edit needs nonempty old_string and a new_string.", true);
      const at = text.indexOf(input.old_string);
      if (at < 0 || text.indexOf(input.old_string, at + 1) >= 0) return result(call, "The old text must occur exactly once. Read the file and use a unique passage.", true);
      const changed = text.slice(0, at) + input.new_string + text.slice(at + input.old_string.length);
      if (Buffer.byteLength(changed) > MAX_FILE_BYTES) return result(call, "The changed file would exceed 1 MB.", true);
      await writeFile(path, changed, "utf8");
      return result(call, "File changed.");
    } catch { return result(call, "The file operation failed. Check the path and try again.", true); }
  }

  function state(req: ModelRequest) {
    const chat = req.context.sessionId;
    let entry = chats.get(chat);
    if (entry && entry.cwd !== req.files?.cwd) { if (entry.board?.running().length) throw new Error("Wait for this chat's agent to finish before changing its project."); chats.delete(chat); entry = undefined; }
    if (!entry) {
      const team = options.team;
      let gate: NativeGate;
      const board = team && boardRecorder(team.helpers, chat);
      const plans = team && planBook(team.helpers, chat);
      gate = nativeGate({
        tools: [...(req.files ? READ_NAMES : []), ...(team ? ["Agent"] : [])],
        ...(req.files ? { files: req.files } : {}),
        ...(team && board ? {
          team: {
            chatId: chat, helpers: team.helpers, board, approve: team.approve, preloadedSkills: false,
            ...(options.home ? { home: options.home } : {}),
            ...(team.approveFile ? {
              approveFile: async (request) => {
                const signal = approvalSignal.getStore();
                if (signal?.aborted) return false;
                const answer = await team.approveFile!(request, signal);
                return signal?.aborted ? false : answer;
              },
            } : {}),
            ...(team.filePermissions ? { permissions: team.filePermissions.forChat(chat) } : {}),
            worktrees: team.worktrees,
            ...(plans ? { plans } : {}),
            ...(req.files ? { project: { cwd: req.files.cwd } } : {}),
          },
        } : {}),
      });
      entry = { gate, ...(board ? { board } : {}), tools: plans ? withPlanTools(options.tools, plans) : options.tools, ...(req.files ? { cwd: req.files.cwd } : {}) };
      chats.set(chat, entry);
    }
    entry.gate.newAnswer(req.files);
    return entry;
  }

  async function delegate(req: ModelRequest, entry: ReturnType<typeof state>, call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    const team = options.team;
    if (!team || !entry.board) return result(call, "This chat has no agents.", true);
    if (typeof call.input.prompt !== "string" || typeof call.input.subagent_type !== "string" || typeof call.input.description !== "string") return result(call, "Provide subagent_type, description and prompt.", true);
    const verdict = await entry.gate.canUseTool("Agent", call.input, { toolUseID: call.id });
    if (verdict.behavior !== "allow") return result(call, verdict.message ?? "That agent cannot start.", true);
    const member = nativeMembers(team.helpers.list()).find((m) => m.id === call.input.subagent_type)!;
    const id = `codex-${randomUUID()}`;
    const job = entry.board.jobOfAgent(id, member.id);
    if (job === undefined) return result(call, "ATOM could not link that agent's task.", true);
    const controller = new AbortController();
    const cancel = () => controller.abort(); signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    running.set(job, controller);
    team.helpers.linkNativeTask(job, id);
    entry.board.onEvent({ type: "system", subtype: "task_started", tool_use_id: call.id, task_id: id });
    team.helpers.setModel(job, options.model, "Uses this chat's Codex model.");
    const worker = { id, type: member.id, cwd: req.files?.cwd ?? options.home ?? homedir() };
    // Codex has no shell. A project worker uses its own worktree for the same undo/branch policy as Claude.
    const names = member.kit === "folders" ? FILE_NAMES : [];
    const specs: ToolSpec[] = [...fileSpecs.filter((s) => names.includes(s.name)), ...(member.planFirst ? [{ name: "ExitPlanMode", description: "Ask the user to approve your plan before changing files.", inputSchema: { type: "object" as const, properties: { plan: property("The proposed plan") }, required: ["plan"] } }] : [])];
    const runner: ToolRunner = {
      specs: () => specs.map(exposed),
      async run(workerCall, toolSignal) {
        const name = workerCall.name.replace(/^atom_/, "");
        if (!specs.some((s) => s.name === name)) return result(workerCall, "That tool is outside this agent's kit.", true);
        team.helpers.step(job, `Using ${name}`);
        const checkCall = { ...workerCall, name };
        if (name === "ExitPlanMode") {
          const v = await checked(entry.gate, checkCall, worker);
          return result(workerCall, v.behavior === "allow" ? "Plan approved." : v.message ?? "Plan not approved.", v.behavior !== "allow");
        }
        if (toolSignal?.aborted || controller.signal.aborted) return result(workerCall, "The task was stopped.", true);
        return file(entry.gate, checkCall, worker, controller.signal);
      },
    };
    const adapter = createCodexSessionAdapter({ program: options.program, model: options.model, runner: () => runner, ...options.session, ...(options.onUsage ? { onUsage: (u, r, model) => options.onUsage!(u, { ...r, context: { ...r.context, sessionId: req.context.sessionId, requestId: `job:${job}` } }, model) } : {}) });
    try {
      if (verdict.updatedInput.isolation === "worktree") {
        const hook = (entry.gate.hooks.WorktreeCreate as { hooks: (() => Promise<any>)[] }[])[0]!.hooks[0]!;
        worker.cwd = (await hook()).hookSpecificOutput.worktreePath;
      }
      const definition = agentDefinition(member, req.files ? { project: { cwd: worker.cwd } } : {});
      const system = [
        definition.prompt,
        "You run on Codex with ATOM's host tools. Codex's native filesystem is intentionally read-only and native approvals are disabled. Those restrictions do NOT prevent calling atom_Write or atom_Edit: ATOM executes those host tools under its own file policy and approval cards. For a requested edit, call the provided host tool and use its actual result. Never claim you lack permission merely because the native sandbox is read-only. A tool denial must be reported honestly; never try to bypass it.",
        "Use only the provided atom_ tools; no shell, external MCP, browser or web access is available in this worker yet.",
        `Your working directory is ${worker.cwd}.`,
      ].join("\n\n");
      const reply = await createGateway({ provider: adapter, timeoutMs: 300_000, maxRetries: 0 }).complete({ system, messages: [{ role: "user", content: String(verdict.updatedInput?.prompt ?? call.input.prompt) }], context: { ...req.context, sessionId: `${req.context.sessionId}:job:${job}` } }, controller.signal);
      entry.board.onEvent({ type: "system", subtype: "task_notification", task_id: id, status: "completed", summary: reply.text });
      return result(call, `${member.name}'s report (task ${job}):\n${reply.text}`);
    } catch (error) {
      entry.board.onEvent({ type: "system", subtype: "task_notification", task_id: id, status: controller.signal.aborted ? "stopped" : "failed", summary: redact(error instanceof Error ? error.message : "Codex task failed.") });
      return result(call, controller.signal.aborted ? "The agent was stopped." : "The agent failed. Read the failure in the Board; no successful report is claimed.", true);
    } finally {
      adapter.close?.(); running.delete(job); signal?.removeEventListener("abort", cancel); await entry.gate.agentEnded(job);
    }
  }

  return {
    stopJob(job: number) { const controller = running.get(job); controller?.abort(); return Boolean(controller); },
    close() { for (const controller of running.values()) controller.abort(); chats.clear(); },
    revoke(chat: string) { chats.get(chat)?.gate.revokeFilePermissions(); },
    forRequest(req: ModelRequest): ToolRunner {
      const entry = state(req);
      const members = options.team ? nativeMembers(options.team.helpers.list()) : [];
      const specs = [...entry.tools.specs().map(exposed), ...(req.files ? fileSpecs.filter((s) => READ_NAMES.includes(s.name)).map(exposed) : []), ...(members.length ? [{ name: "atom_delegate", description: `Run an ATOM agent and return its actual report. Agents: ${members.map((m) => `${m.id} (${m.name}: ${m.role})`).join(", ")}. Give the complete task in prompt.`, inputSchema: { type: "object" as const, properties: { subagent_type: property("Agent id"), description: property("Short task title"), prompt: property("Complete task, relevant context and end condition") }, required: ["subagent_type", "description", "prompt"] } }] : [])];
      return {
        specs: () => specs,
        async run(call, signal) {
          if (signal?.aborted) return result(call, "Stopped.", true);
          if (!specs.some((s) => s.name === call.name)) return result(call, "Unknown ATOM tool.", true);
          if (call.name === "atom_delegate") return delegate(req, entry, call, signal);
          const name = call.name.replace(/^atom_/, "");
          if (READ_NAMES.includes(name)) return file(entry.gate, { ...call, name }, undefined, signal);
          const verdict = await entry.gate.canUseTool(`mcp__atom__${name}`, call.input, { toolUseID: call.id });
          if (verdict.behavior !== "allow") return result(call, verdict.message ?? "Not allowed.", true);
          return entry.tools.run({ ...call, name }, signal);
        },
      };
    },
  };
}
