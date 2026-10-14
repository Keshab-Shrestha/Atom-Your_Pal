import { randomUUID } from "node:crypto";
import type { ProjectFiles } from "@atom/contracts";
import type { HelperStore, HelperView } from "@atom/helpers";
import { TOOL_SERVER, MAX_PROJECT_FILE_CALLS } from "@atom/llm-gateway";
import { BROWSER_SERVER, browserCheck } from "./browser.ts";
import { checkpointBefore, folderCheck } from "./folder-run.ts";
import { mcpCheck } from "./mcp-servers.ts";
import { grantedServers, kitTools, nativeMembers } from "./native-agents.ts";
import type { BoardRecorder } from "./native-board.ts";
import { commitWork, git, prepareWorkdir, type Workdir } from "./worktree.ts";

/**
 * ADR-110: the permission gate of a native chat session. `allowedTools` is empty, so every tool call comes here. The
 * PreToolUse hook decides first (before Claude Code's own rules, so no read-only tool skips it); canUseTool gives the
 * main thread the same decision, counted once per call id. Claude Code may not call canUseTool for a background
 * sub-agent, so every sub-agent decision lives in the hook, which carries its agent_id and agent_type (Phase N2).
 *
 * Main thread (no agent_id):
 * - ATOM's tools (the `atom` server) and ToolSearch: allowed; ATOM's tool engine keeps its own approvals.
 * - Agent: only one of ATOM's agents (never general-purpose or another built-in); the call makes the Board job, and
 *   gets its model from Laya unless the agent is pinned. Only description, prompt and subagent_type pass on.
 * - Any tool outside the chat's set: denied. Bash, Write and Edit are never in a main thread's set.
 * - Read, Glob, Grep (project chat, ADR-107): the project's read check, at most MAX_PROJECT_FILE_CALLS per answer.
 *
 * Sub-agents (agent_type = the worker's id): only the tools of its kit, its granted MCP servers, the browser (when
 * granted), ToolSearch (with MCP servers or the browser), its own skills and, plan-first, ExitPlanMode on Keshab's
 * approval card; a plan-first agent changes no file before that approval. Files: its grants plus its worktree. Bash
 * only in a project chat (Keshab, 2026-10-14), sandboxed, classified in code, risky ones on the card.
 */

const READ_TOOLS = ["Read", "Glob", "Grep"];
const FILE_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];
/** A plan-first agent may not use these before Keshab approved its plan (Keshab, 2026-10-14). */
const CHANGE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"];
/** The only fields of an Agent call that pass on; `mode`, `name`, `team_name`, `effort` and the rest never do. */
const AGENT_FIELDS = ["description", "prompt", "subagent_type"];
/** A Bash call may wait for Keshab's answer on the approval card. */
export const HOOK_TIMEOUT_S = 600;
const MAX_REMEMBERED = 500;

export interface TeamScope {
  chatId: string;
  helpers: Pick<HelperStore, "list" | "mcpServers" | "addNativeJob" | "checkpoint" | "setModel">;
  board: BoardRecorder;
  approve(request: { summary: string; reason: string }): Promise<boolean>;
  /** Laya's model alias for this Agent call; undefined keeps the definition's model. */
  chooseModel?(task: string, member: HelperView): Promise<string | undefined>;
  /** Where task worktrees go (ATOM's worktrees folder). */
  worktrees: string;
  /** A project chat: its folder. Bash exists only here; a folders agent works in a worktree of it. */
  project?: { cwd: string };
  log?(event: string, fields: Record<string, unknown>): void;
}

export interface NativeScope {
  /** Claude Code's own tools of this chat's main thread. */
  tools: readonly string[];
  /** A project chat's read access; undefined: no file reads. */
  files?: ProjectFiles;
  /** Phase N2: the chat's sub-agents. Without it the Agent tool is refused. */
  team?: TeamScope;
}

type Verdict = { allow: true; input: Record<string, unknown> } | { allow: false; message: string };

export interface NativeGate {
  canUseTool: (name: string, input: Record<string, unknown>, extra?: { toolUseID?: string; agentID?: string }) => Promise<Record<string, unknown>>;
  hooks: Record<string, unknown>;
  /** A new answer starts: the file-read count starts again, with the project's read access as it is now. */
  newAnswer(files?: ProjectFiles): void;
  /** A sub-agent's job ended: its worktree is committed (task branch, never pushed), its browser freed. */
  agentEnded(job: number): Promise<void>;
}

const deny = (message: string): Verdict => ({ allow: false, message });
const isRepo = (cwd: string) => git(cwd, "rev-parse", "--show-toplevel").then(() => true, () => false);

export function nativeGate(scope: NativeScope): NativeGate {
  let files = scope.files;
  let fileCalls = new Map<string, string | undefined>();
  const agentCalls = new Map<string, Promise<Verdict>>();
  const team = scope.team;
  const work = new Map<number, Workdir>();
  const planApproved = new Set<string>(); // agent ids whose ExitPlanMode Keshab approved on the card
  const pendingTrees: number[] = []; // jobs whose Agent call asked for a worktree, oldest first
  const browsers = new Map<number, { policy: ReturnType<typeof browserCheck>; release?: () => void; stop: AbortController }>();
  const log = (event: string, fields: Record<string, unknown>) => {
    try {
      team?.log?.(event, { chatId: team.chatId, ...fields });
    } catch {
      // the log is a help
    }
  };

  /** The main thread's Agent call: one of ATOM's agents; makes the Board job; Laya's model; a worktree in a project. */
  const agentCall = async (input: Record<string, unknown>, id: string): Promise<Verdict> => {
    if (!team) return deny("This chat has no agents.");
    const type = typeof input.subagent_type === "string" ? input.subagent_type : "general-purpose";
    const member = nativeMembers(team.helpers.list()).find((m) => m.id === type);
    if (!member) return deny(`"${type.slice(0, 40)}" is not one of your agents. Pick one by its description, or make one with create_agent.`);
    const updated: Record<string, unknown> = Object.fromEntries(AGENT_FIELDS.filter((k) => k in input).map((k) => [k, input[k]]));
    updated.run_in_background = true;
    if (!member.pinnedModel && team.chooseModel) {
      const model = await team.chooseModel(String(input.prompt ?? ""), member).catch(() => undefined);
      if (model) updated.model = model;
    }
    let job;
    try {
      job = team.helpers.addNativeJob(member.id, String(input.prompt ?? ""), { chatId: team.chatId });
    } catch (error) {
      return deny(error instanceof Error ? error.message : String(error));
    }
    team.board.opened(id, job.id, String(input.description ?? ""));
    // Phase N3: the Board shows the model at once (the pin or Laya's choice); the recorder puts the exact one when it runs.
    const chosen = typeof updated.model === "string" ? updated.model : member.pinnedModel;
    if (chosen) team.helpers.setModel(job.id, chosen, updated.model ? "Chosen by Laya." : "Pinned by Keshab.");
    if (member.kit === "folders" && team.project && (await isRepo(team.project.cwd))) {
      updated.isolation = "worktree";
      pendingTrees.push(job.id);
    }
    log("agent.call", { job: job.id, helper: member.id, ...(typeof updated.model === "string" ? { model: updated.model } : {}) });
    return { allow: true, input: updated };
  };

  const mainDecide = async (name: string, input: Record<string, unknown>, id: string): Promise<Verdict> => {
    if (name.startsWith(`mcp__${TOOL_SERVER}__`) || name === "ToolSearch") return { allow: true, input };
    if (!scope.tools.includes(name)) {
      return deny(`${name} is not available in this chat. Hand file changes and multi-step work to one of your agents with the Agent tool.`);
    }
    if (name === "Agent") {
      if (!agentCalls.has(id)) agentCalls.set(id, agentCall(input, id));
      return agentCalls.get(id)!;
    }
    if (!READ_TOOLS.includes(name)) return { allow: true, input };
    if (!files) return deny("This chat has no file access now. Answer from the chat.");
    if (!fileCalls.has(id) && fileCalls.size >= MAX_PROJECT_FILE_CALLS) {
      return deny(`That is the limit of ${MAX_PROJECT_FILE_CALLS} file reads for one answer. Answer now with what you have, and say what you did not read.`);
    }
    if (!fileCalls.has(id)) fileCalls.set(id, await files.check(name, input));
    const problem = fileCalls.get(id);
    return problem ? deny(problem) : { allow: true, input: files.prepare?.(name, input) ?? input };
  };

  /** A sub-agent's tool call: decided in code from its kit and grants. */
  const subDecide = async (name: string, input: Record<string, unknown>, agentId: string, agentType: string, cwd: string | undefined): Promise<Verdict> => {
    if (!team) return deny("There are no agents in this chat.");
    const member = nativeMembers(team.helpers.list()).find((m) => m.id === agentType);
    if (!member) return deny("This agent is not one of ATOM's.");
    const job = team.board.jobOfAgent(agentId, agentType);
    const project = Boolean(team.project);
    const say = (verdict: string) => log("agent.tool", { helper: member.id, ...(job !== undefined ? { job } : {}), tool: name.slice(0, 60), verdict });

    if (name.startsWith(`mcp__${BROWSER_SERVER}__`)) {
      if (member.kit === "think" || !member.browser) return say("refused"), deny(`${member.name} has no browser.`);
      return browserCall(member, job, name, input);
    }
    if (name.startsWith("mcp__")) {
      const servers = member.kit === "think" ? [] : grantedServers(team.helpers.mcpServers(), member.id);
      const problem = await mcpCheck({ servers, worker: member.name, approve: team.approve })(name);
      return say(problem ? "refused" : "allowed"), problem ? deny(problem) : { allow: true, input };
    }
    if (name === "Bash" && !project) return say("refused"), deny("Commands run only in a project chat. Do the task with the file tools.");
    // Its MCP and browser tools are deferred (ENABLE_TOOL_SEARCH=force): an agent with them needs ToolSearch to load them.
    const deferred = member.kit !== "think" && (member.browser || grantedServers(team.helpers.mcpServers(), member.id).length > 0);
    // Skill for every kit, think too: a skill is instructions, not a tool (Keshab, 2026-10-14).
    const kit = new Set([
      ...kitTools(member.kit, project),
      ...(member.skills.length ? ["Skill"] : []),
      ...(member.planFirst ? ["ExitPlanMode"] : []),
      ...(deferred ? ["ToolSearch"] : []),
    ]);
    if (!kit.has(name)) return say("refused"), deny(`${name} is not in ${member.name}'s kit (${member.kit}).`);
    if (name === "Skill") {
      const skill = String(input.skill ?? "").split(":").at(-1) ?? "";
      return member.skills.includes(skill) ? { allow: true, input } : (say("refused"), deny(`${skill || "That skill"} is not one of ${member.name}'s skills.`));
    }
    if (name === "ExitPlanMode") {
      const plan = typeof input.plan === "string" ? input.plan : "";
      const ok = await team.approve({ summary: `${member.name} has a plan for the task`, reason: plan.slice(0, 600) || "Approve the plan to let it start." });
      say(ok ? "allowed" : "declined");
      if (ok) planApproved.add(agentId);
      return ok ? { allow: true, input } : deny("Keshab did not approve this plan. Stop and report what you planned, so he can change the task.");
    }
    if (member.planFirst && CHANGE_TOOLS.includes(name) && !planApproved.has(agentId)) {
      return say("refused"), deny(`${member.name} plans first: no file changes before Keshab approves the plan. Call ExitPlanMode with your plan.`);
    }
    if (!FILE_TOOLS.includes(name)) return { allow: true, input }; // WebSearch, WebFetch, ToolSearch
    if (name === "Bash" && input.dangerouslyDisableSandbox) return say("refused"), deny("Commands always run in the sandbox.");
    const tree = job !== undefined ? work.get(job) : undefined;
    const roots = [...member.grants, ...(tree ? [tree.dir] : team.project ? [team.project.cwd] : [])];
    if (!roots.length) return say("refused"), deny(`${member.name} has no folder to work in. Say in the report that Keshab must grant one on ${member.name}'s page.`);
    const check = folderCheck({
      roots,
      cwd: tree?.dir ?? cwd ?? roots[0]!,
      name: member.name,
      approve: team.approve,
      onCheck: (e) => say(e.verdict),
      ...(job !== undefined
        ? {
            before: checkpointBefore({ roots, ...(tree?.tree ? { tree: tree.tree } : {}), keep: (r, p) => team.helpers.checkpoint(job, r, p) }),
            onBeforeError: () => log("agent.checkpoint_failed", { job, tool: name }),
          }
        : {}),
    });
    const problem = await check(name, input);
    return problem ? deny(problem) : { allow: true, input };
  };

  /** ADR-098 item 4: the browser, one task per worker at a time, each site on Keshab's card. */
  const browserCall = async (member: HelperView, job: number | undefined, name: string, input: Record<string, unknown>): Promise<Verdict> => {
    if (job === undefined) return deny("The browser is for an agent's task only.");
    let state = browsers.get(job);
    if (!state) {
      state = { policy: browserCheck({ name: member.name, helper: member.id, grants: member.grants, approve: team!.approve }), stop: new AbortController() };
      browsers.set(job, state);
      state.release = await state.policy.acquire(state.stop.signal, () => {});
    }
    const verdict = await state.policy.check(name, input);
    return "deny" in verdict ? deny(verdict.deny) : { allow: true, input };
  };

  // One decision per sub-agent call id: the hook decides; a canUseTool call for the same id (it carries only the
  // agent's id) gets the same answer, so Keshab is never asked twice.
  const subCalls = new Map<string, Promise<Verdict>>();
  const typeOf = new Map<string, string>();
  const subOnce = (id: string, name: string, input: Record<string, unknown>, agentId: string, agentType: string | undefined, cwd?: string) => {
    if (agentType) typeOf.set(agentId, agentType);
    if (!subCalls.has(id)) {
      subCalls.set(id, subDecide(name, input, agentId, agentType ?? typeOf.get(agentId) ?? "", cwd));
      if (subCalls.size > MAX_REMEMBERED) subCalls.delete(subCalls.keys().next().value!);
    }
    return subCalls.get(id)!;
  };
  const decide = (hook: Record<string, any>, name: string, input: Record<string, unknown>, id: string) =>
    typeof hook.agent_id === "string" && hook.agent_id
      ? subOnce(id, name, input, hook.agent_id, typeof hook.agent_type === "string" ? hook.agent_type : undefined, typeof hook.cwd === "string" ? hook.cwd : undefined)
      : mainDecide(name, input, id);

  const hooks: Record<string, unknown> = {
    PreToolUse: [
      {
        timeout: HOOK_TIMEOUT_S,
        hooks: [
          async (hook: Record<string, any>, toolUseID: string | undefined) => {
            const input = hook.tool_input && typeof hook.tool_input === "object" ? (hook.tool_input as Record<string, unknown>) : {};
            const v = await decide(hook, String(hook.tool_name), input, toolUseID ?? hook.tool_use_id ?? randomUUID()).catch(
              (error: unknown): Verdict => deny(`ATOM could not check this call: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)),
            );
            return v.allow
              ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: v.input } }
              : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: v.message } };
          },
        ],
      },
    ],
  };
  if (team) {
    hooks.PostToolUse = [
      {
        matcher: `^mcp__${BROWSER_SERVER}__`,
        hooks: [
          async (hook: Record<string, any>) => {
            const job = typeof hook.agent_id === "string" ? team.board.jobOfAgent(hook.agent_id) : undefined;
            if (job !== undefined) browsers.get(job)?.policy.seen(hook.tool_response);
            return {};
          },
        ],
      },
    ];
    // A folders agent in a project chat works in a worktree of the project on its task's branch (prepareWorkdir).
    hooks.WorktreeCreate = [
      {
        hooks: [
          async () => {
            const job = pendingTrees.shift();
            if (job === undefined || !team.project) throw new Error("No ATOM task asked for this worktree.");
            const made = await prepareWorkdir(team.project.cwd, job, team.worktrees);
            work.set(job, made);
            log("agent.worktree", { job, branch: Boolean(made.branch) });
            return { hookSpecificOutput: { hookEventName: "WorktreeCreate", worktreePath: made.dir } };
          },
        ],
      },
    ];
  }

  return {
    canUseTool: async (name, input, extra) => {
      const id = extra?.toolUseID ?? randomUUID();
      const v = await (extra?.agentID ? subOnce(id, name, input, extra.agentID, undefined) : mainDecide(name, input, id));
      return v.allow ? { behavior: "allow", updatedInput: v.input } : { behavior: "deny", message: v.message };
    },
    hooks,
    newAnswer(next) {
      files = next;
      fileCalls = new Map();
    },
    async agentEnded(job) {
      const browser = browsers.get(job);
      browsers.delete(job);
      browser?.stop.abort();
      browser?.release?.();
      const tree = work.get(job);
      work.delete(job);
      if (tree?.tree) {
        const committed = await commitWork(tree.dir, `ATOM task ${job}`);
        log("agent.commit", { job, committed });
      }
    },
  };
}
