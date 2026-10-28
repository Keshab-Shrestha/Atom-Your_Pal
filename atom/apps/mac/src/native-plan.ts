import type { ToolRunner } from "@atom/contracts";
import { HANDOFF_WORDS, PLAN_PARALLEL, parseWorkPlan, planTable, portionContextBudget, readyPortions, workflowTaskContract, workflowTaskContext, taskEvidenceText, budgetContext, WORKFLOW_CONTEXT_BYTES, bindPlanWriteScopes, currentWriteScope, writeScopesOverlap, type HelperStore, type HelperView, type PlanView, type PlanPortionView, type PortionResult, type ContextBudgetReceipt, type ContextPart } from "@atom/helpers";
import type { Tool } from "@atom/tool-engine";
import { nativeMembers } from "./native-agents.ts";
import { workflowForPlan, workflowReference, workflowUnavailable, workflowWorkerContext } from "@atom/helpers";
import { taskFileChecks } from "@atom/helpers";
import { workflowRetryContext } from "@atom/helpers";
import { workflowRecoveryLabel, workflowRecoveryText } from "@atom/helpers";
import { redact } from "@atom/llm-gateway";
import type { AccessApproval } from "./chat-access.ts";

/**
 * ADR-111 (slices C and D): work plans in a native chat. The main agent makes one plan with `plan_work` and starts each
 * portion with the Agent tool, description "P<n>". The safety gate calls `claim`: code checks the order and builds the
 * portion's prompt (its stored task, the goal, and the reports of the portions it waited for), so the main agent never
 * copies a report from one agent to the next. Logs ids only.
 */

export type PlanStore = Pick<HelperStore, "addPlan" | "latestPlan" | "list" | "report" | "get"> & Partial<Pick<HelperStore, "taskEvidence" | "runningNativeJobs" | "planForChat" | "planHistory" | "nativeRetryPlan" | "nativeWorkflowScope" | "preparePlanRepair" | "acceptPlanRepair">>;

// The same store is shared by Claude/Codex books. Admission holds must survive book recreation while model choice awaits.
const admissions = new WeakMap<PlanStore, { planned: Set<string>; unplanned: Map<string, string>; familyPlanned: Map<string, string> }>();

/** The portion number in an Agent call's description: "P2", "P2: price the kits". */
const TAG = /^\s*P(\d{1,2})\b/;

export type Claim =
  | { kind: "none" }
  | { kind: "deny"; message: string }
  | { kind: "ok"; plan: number; n: number; task: string; prompt: string };

export interface PlanBook {
  /** `plan_work` and `plan_status` for this chat. */
  tools(): Tool[];
  /** The gate's check of an Agent call. `none`: not a plan call (the gate handles it as before). */
  claim(description: string, member: HelperView): Claim;
  /** The portion has its Board job now (or the call was refused after the claim). */
  release(plan: number, n: number): void;
  /** Recheck metadata after asynchronous model/repository preparation, immediately before job creation. */
  confirm?(plan: number, n: number): string | undefined;
  reserveUnplanned?(call: string, member: HelperView): string | undefined;
  releaseUnplanned?(call: string): void;
  /** Refresh advisory web availability without replacing the gate/Board of running jobs. */
  setWebAvailable?(available: boolean): void;
}

const nameOf = (store: PlanStore) => (id: string) => store.list().find((h) => h.id === id)?.name ?? id;
const resultJob = (p: PlanPortionView) => p.repair?.state === "accepted" && p.resultJob === p.repair.receipt.retryJob ? p.resultJob : p.job;
const repairLabel = (p: PlanPortionView) => p.repair?.state === "accepted" ? `; report accepted from retry #${p.repair.receipt.retryJob} (no file transfer)`
  : p.repair ? "; repair handoff unavailable; review required" : "";

/** One line a portion, for the main agent: the ids it needs for the Agent tool. */
function statusText(view: PlanView, ready: number[], holds: string[] = [], historical = false, unavailableJobs: ReadonlySet<number> = new Set()): string {
  const workflowLabel = (p: PlanPortionView) => {
    try { const ref = workflowReference(p.workflow); return ref ? `; ${ref.id} workflow r${ref.revision}` : ""; }
    catch { return "; invalid workflow metadata (replan required)"; }
  };
  const lines = view.portions.map((p) => `P${p.n} ${p.name} (${p.agent})${p.after.length ? ` after ${p.after.map((a) => `P${a}`).join(", ")}` : ""}: ${p.job !== undefined && unavailableJobs.has(p.job) ? "task record unavailable" : p.recovery ? workflowRecoveryLabel(p.recovery) : p.state}${p.job !== undefined ? `; original task #${p.job}` : ""}${repairLabel(p)}${p.contract !== undefined ? "; task contract recorded" : ""}${workflowLabel(p)}`);
  const uncertain = view.portions.some((p) => p.recovery && ["interrupted", "unconfirmed", "repair-unavailable"].includes(p.recovery.kind));
  const tail = historical
    ? "Read-only saved-plan inspection. Portion states reflect linked task records; receipts describe their recorded observations, not current files or new attempts. This does not select this plan for execution, restart work or grant access. Use plan_status without plan for current admission guidance."
    : view.complete && uncertain
    ? "Task records indicate reported completion, but some outcomes cannot be confirmed. Review the affected tasks and saved results before claiming completion; this summary does not restart work."
    : view.complete
    ? view.portions.some((p) => p.contract !== undefined)
      ? "Every portion reported done. Summarize deliverables and checks actually observed; recorded verification criteria are not proof those checks passed. Name unmet or unverified criteria."
      : "The plan is complete. Answer the user in one to three short sentences from the reports."
    : view.stuck
      ? "The plan is stuck: a portion failed or was stopped. Tell the user which one and what they can do."
      : ready.length
        ? `Ready now: ${ready.map((n) => `P${n}`).join(", ")}. Start each with the Agent tool: description "P<n>", the agent's id as subagent_type, prompt "go". At most ${PLAN_PARALLEL} portions run at once.`
        : holds.length ? "No compatible portion can start now. Resolve the holds below; do not bypass them with an unnumbered file task." : "Nothing to start now: wait for the running portions to report.";
  const recovery = workflowRecoveryText(view);
  return `Plan #${view.id}\n${view.goal}\n${lines.join("\n")}\n${tail}${holds.length ? `\n${holds.join("\n")}` : ""}${recovery ? `\n${recovery}` : ""}`;
}

export function planBook(store: PlanStore, chatId: string, log?: (event: string, fields: Record<string, unknown>) => void, options: { projectRoot?: string; web?: boolean; approve?: AccessApproval; allowed?(): boolean } = {}): PlanBook {
  let webAvailable = options.web === true;
  const retryChat = /^task-retry-\d+$/.test(chatId);
  let shared = admissions.get(store);
  if (!shared) admissions.set(store, (shared = { planned: new Set(), unplanned: new Map(), familyPlanned: new Map() }));
  const { planned: reserved, unplanned, familyPlanned } = shared;
  const key = (plan: number, n: number) => `${plan}.${n}`;
  const unplannedKey = (call: string) => JSON.stringify([chatId, call]);
  const note = (event: string, fields: Record<string, unknown>) => {
    try {
      log?.(event, { chatId, ...fields });
    } catch {
      // the log is a help
    }
  };

  const mayWrite = (p: PlanPortionView, members: readonly HelperView[]): boolean => {
    const member = members.find((h) => h.id === p.agent);
    return Boolean(p.writeScope?.length) || !member || member.kit === "folders";
  };
  const activePortions = (view: PlanView) => view.portions.filter((p) => p.state === "running" || reserved.has(key(view.id, p.n)));
  const familyChat = () => store.nativeWorkflowScope?.(chatId).chatId ?? chatId;
  const pendingOtherPlan = (view?: PlanView) => [...familyPlanned].some(([k, chat]) => chat === familyChat() && (!view || !k.startsWith(`${view.id}.`)));
  const fileJobs = (members: readonly HelperView[] = store.list()) => {
    // Production uses the unbounded store query; the fallback supports existing lightweight host adapters.
    const jobs = store.nativeWorkflowScope?.(chatId).jobs ?? store.runningNativeJobs?.(chatId) ?? members.flatMap((h) => h.jobs).filter((j) => j.chatId === chatId && j.state === "running");
    return jobs.filter((j) => j.nativeScope !== "advisory" && (members.find((h) => h.id === j.helper)?.kit === "folders" || !members.some((h) => h.id === j.helper)));
  };
  const pendingUnplanned = () => [...unplanned.values()].some((chat) => chat === familyChat());
  const fileHold = (view: PlanView, portion: PlanPortionView, active: PlanPortionView[], members: readonly HelperView[] = store.list()): string | undefined => {
    // Validate binding even for a non-file kit so project changes cannot silently reuse a saved plan.
    let scope;
    try {
      const checks = taskFileChecks(portion.fileChecks);
      if (checks?.length && (!options.projectRoot || members.find((h) => h.id === portion.agent)?.kit !== "folders")) return "Declared file checks require a project folder worker. Prepare a compatible plan.";
      const workflow = workflowReference(portion.workflow);
      if (workflow) {
        if (!workflowTaskContract(portion.contract)) return "The workflow task contract is missing. Prepare a new plan.";
        const problem = workflowUnavailable(workflow, { project: Boolean(options.projectRoot), web: webAvailable, kits: nativeMembers(members).map((h) => h.kit) });
        if (problem) return problem;
      }
      scope = currentWriteScope(portion, options.projectRoot);
    }
    catch (error) { return error instanceof Error ? error.message : "Its saved write scope is invalid; prepare a new plan."; }
    if (!mayWrite(portion, members)) return;
    if (pendingOtherPlan(view)) return "Wait for file work starting in the source chat or one of its explicit retries.";
    const linked = new Set(view.portions.flatMap((p) => p.job === undefined ? [] : [p.job]));
    if (pendingUnplanned() || fileJobs(members).some((j) => !linked.has(j.id))) return "Wait for file work in this chat or its explicit retry family to finish.";
    for (const other of active.filter((p) => mayWrite(p, members))) {
      try {
        if (writeScopesOverlap(scope, currentWriteScope(other, options.projectRoot))) return `Its write scope overlaps P${other.n}; wait for that portion to finish.`;
      } catch { return `P${other.n} has an unavailable or changed write scope; wait for it to end, then prepare a new plan.`; }
    }
  };

  /** A compatible suggested batch, including slots and shared in-flight admissions. Claim rechecks actual state. */
  const schedule = (view: PlanView): { ready: number[]; holds: string[] } => {
    const done = new Set(view.portions.filter((p) => p.state === "done").map((p) => p.n));
    const started = new Set(view.portions.filter((p) => p.state !== "waiting").map((p) => p.n));
    for (const k of reserved) {
      const [plan, n] = k.split(".").map(Number);
      if (plan === view.id) started.add(n!);
    }
    const active = activePortions(view), ready: number[] = [], holds: string[] = [], members = store.list();
    for (const n of readyPortions({ goal: view.goal, portions: view.portions }, done, started)) {
      const portion = view.portions.find((p) => p.n === n)!;
      const hold = active.length >= PLAN_PARALLEL ? `The ${PLAN_PARALLEL} execution slots are occupied or reserved.` : fileHold(view, portion, active, members);
      if (hold) holds.push(`P${n} held: ${hold}`);
      else { ready.push(n); active.push(portion); }
    }
    return { ready, holds };
  };
  const status = (view: PlanView) => { const s = schedule(view); return statusText(view, s.ready, s.holds); };

  const planWork: Tool = {
    spec: {
      name: "plan_work",
      description:
        "Plan a big job that has several parts. goal: one short sentence for the whole job. portions: 1 to 6 objects " +
        "{agent, task, after}: agent is an agent's name from your agent list, task says exactly what that agent finds or " +
        "makes, after lists the numbers of earlier portions it needs (omit when none). ATOM checks the plan, keeps the " +
        "order and passes each agent the reports it needs. For new portions include contract: {deliverable, scope, " +
        "verify, stopWhen}, stating the output, work boundary, check and stopping condition. Contracts grant no " +
        "permissions and are not verification evidence. Optionally declare writeScope: literal project-relative file/folder " +
        "paths. Missing/empty scopes are conservative, not read-only. Overlapping explicit scopes need an after dependency. " +
        "Dependencies pass reports, not worktree file changes; do not assume a predecessor's edits are in your files. " +
        "Optional workflow selects ATOM's research, build or review guide; it requires complete portion contracts and grants no access. " +
        "A project folder portion may include fileChecks: up to six {kind: exists|contains|sha256, path, expected?} literal relative text-file predicates, one per file. " +
        "Exists has no expected; contains takes a literal; sha256 takes a lowercase digest. Files must fit the complete UTF-8 reader (32 KiB/1,000 lines, no links or hidden controls). " +
        "This requests bounded host readback after an eligible Claude or Codex worker reports, not tests or code execution. " +
        "Other paths remain unverified without a host receipt. Then start ready portions with Agent.",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string", description: "The whole job in one short sentence" },
          workflow: { type: "string", description: "Optional built-in research, build or review guide; existing workers, permissions and user constraints remain authoritative" },
          portions: { type: "array", description: "1 to 6 objects {agent, task, after, writeScope?: string[], fileChecks?: [{kind, path, expected?}], contract: {deliverable, scope, verify, stopWhen}}" },
        },
        required: ["goal", "portions"],
      },
    },
    run(input) {
      if (retryChat || store.nativeRetryPlan?.(chatId)) throw new Error("This chat belongs to an explicit retry. Its host-bound plan cannot be replaced; inspect plan_status or start a separate task for different work.");
      const previous = store.latestPlan(chatId);
      if ((previous && activePortions(previous).length) || pendingUnplanned() || pendingOtherPlan(previous) || fileJobs().length) throw new Error("This chat or its explicit retry family has file work or plan portions running/starting. Wait for them to end before replacing its plan.");
      const available = nativeMembers(store.list());
      const workflow = workflowForPlan(input.workflow);
      if (workflow) {
        const problem = workflowUnavailable(workflow, { project: Boolean(options.projectRoot), web: webAvailable, kits: available.map((h) => h.kit) });
        if (problem) throw new Error(problem);
      }
      const members = available.map((h) => ({ id: h.id, name: h.name, available: h.available, role: h.role }));
      const plan = bindPlanWriteScopes(parseWorkPlan(input, members), options.projectRoot);
      if (plan.portions.some((p) => p.fileChecks?.length && (!options.projectRoot || available.find((h) => h.id === p.agent)?.kit !== "folders"))) throw new Error("Declared file checks require a selected project and a folder worker for that portion.");
      const view = store.addPlan(chatId, plan);
      note("plan.made", { plan: view.id, portions: view.portions.length, ...(workflow ? { workflow: workflow.id, revision: workflow.revision } : {}) });
      return `${planTable(plan, nameOf(store))}\n\n${status(view)}`;
    },
  };

  const planStatus: Tool = {
    spec: {
      name: "plan_status",
      description: "Where this chat's current plan stands and which portions can start. Supply portion for its saved contract, workflow guide, declared paths and host evidence. Optional plan selects a plan id from plan_history in this chat for read-only inspection; it never changes execution or makes historical evidence current.",
      inputSchema: { type: "object", properties: {
        portion: { type: "integer", description: "Optional portion number whose task contract to inspect" },
        plan: { type: "integer", description: "Optional positive saved plan id from this chat's plan_history; read-only inspection" },
      } },
    },
    run(input) {
      const historical = input.plan !== undefined;
      if (historical && (!Number.isSafeInteger(input.plan) || Number(input.plan) < 1)) throw new Error("plan must be a positive plan id from this chat's history.");
      if (historical && !store.planForChat) throw new Error("Saved-plan inspection is unavailable in this host. No current-plan fallback was used.");
      const view = historical ? store.planForChat!(chatId, Number(input.plan)) : store.latestPlan(chatId);
      if ((historical && !view) || (view && view.chatId !== chatId)) throw new Error("There is no such saved plan in this chat.");
      if (!view) return "There is no plan in this chat. Make one with plan_work.";
      const unavailableJobs = new Set(view.portions.flatMap((p) => p.job !== undefined && store.get(p.job)?.chatId !== chatId ? [p.job] : []));
      const evidenceOf = (p: PlanPortionView) => {
        const job = resultJob(p);
        return job !== undefined && (p.repair?.state === "accepted" || !unavailableJobs.has(job)) ? store.taskEvidence?.(job) : undefined;
      };
      const evidenceLines = view.portions.flatMap((p) => {
        const evidence = evidenceOf(p);
        return evidence ? [`P${p.n}${repairLabel(p)}: ${taskEvidenceText(evidence)}`] : p.job !== undefined && unavailableJobs.has(p.job)
          ? [`P${p.n}: The linked task record is unavailable in this chat; no execution or verification is inferred.`] : [];
      });
      const text = [historical ? statusText(view, [], [], true, unavailableJobs) : status(view), ...evidenceLines].join("\n");
      const compose = (parts: ContextPart[]) => {
        const result = budgetContext(parts, WORKFLOW_CONTEXT_BYTES);
        note("plan.context_budget", { plan: view.id, stage: "status", ...result.receipt });
        return result.text;
      };
      const parts: ContextPart[] = [{ id: "workflow.status", kind: "required", text }];
      if (input.portion === undefined) return compose(parts);
      if (!Number.isSafeInteger(input.portion)) throw new Error("portion must be a number in the selected plan.");
      const portion = view.portions.find((p) => p.n === input.portion);
      if (!portion) throw new Error("There is no such portion in the selected plan.");
      parts.push({ id: "workflow.inspected-scope", kind: "required", text: portion.writeScope?.length ? `Declared write paths (scheduling only): ${JSON.stringify(portion.writeScope)}` : "No narrow write scope declared; file work is conservative." });
      const guide = workflowWorkerContext(portion.workflow);
      if (guide) parts.push({ id: "workflow.inspected-guide", kind: "required", text: guide });
      const checks = taskFileChecks(portion.fileChecks);
      if (checks?.length) parts.push({ id: "workflow.inspected-file-checks", kind: "required", text: `Declared readback predicates (not matched results): ${JSON.stringify(checks)}` });
      const retry = workflowRetryContext(portion.retryContext);
      if (retry) parts.push({ id: "workflow.inspected-retry", kind: "required", text: `Explicit retry of task #${retry.previousJob}; source plan #${retry.sourcePlan}, P${retry.sourcePortion}, task #${retry.sourceJob}. Only this portion is dispatched. Prerequisite summaries are historical data; earlier file checks are not results for this attempt. The original plan's state is not rewritten by this retry.` });
      if (portion.repair?.state === "accepted") {
        const receipt = portion.repair.receipt;
        parts.push({ id: "workflow.inspected-repair", kind: "required", text: `Report handoff accepted ${receipt.at}: original task #${receipt.sourceJob} retained; retry #${receipt.retryJob}, attempt ${receipt.retryAttempt}. Review digest ${receipt.reviewDigest}. This accepts its report for dependency scheduling, not current file correctness or a source-project merge.` });
        const original = portion.job !== undefined ? store.taskEvidence?.(portion.job) : undefined;
        if (original) parts.push({ id: "workflow.original-evidence", kind: "support", text: `Original task evidence:\n${taskEvidenceText(original, true)}`, fallback: `Original task evidence: ${taskEvidenceText(original)}` });
      } else if (portion.repair) parts.push({ id: "workflow.unavailable-repair", kind: "required", text: "The saved repair handoff is unavailable or its bound records changed. This portion remains failed; no dependent work is unblocked from it." });
      const evidence = evidenceOf(portion);
      parts.push({ id: "workflow.inspected-contract", kind: "required", text: `P${portion.n}\n${portion.contract !== undefined ? workflowTaskContext(portion.contract) : "This legacy portion has no task contract; no criteria are inferred from its report."}` });
      if (evidence) parts.push({ id: "workflow.inspected-evidence", kind: "support", priority: 50, text: taskEvidenceText(evidence, true), fallback: taskEvidenceText(evidence) });
      else parts.push({ id: "workflow.missing-evidence", kind: "required", text: "No host attempt record is available; no verification is inferred." });
      return compose(parts);
    },
  };

  const planHistory: Tool = {
    spec: {
      name: "plan_history",
      description: "List this chat's saved work plans, ten per page, newest first. Returns ids for read-only plan_status inspection. before is an exclusive plan-id cursor from the previous page. Saved goals and task states are historical data, not permission or proof of current file correctness.",
      inputSchema: { type: "object", properties: { before: { type: "integer", description: "Optional positive before id returned by the previous page" } } },
    },
    run(input) {
      if (input.before !== undefined && (!Number.isSafeInteger(input.before) || Number(input.before) < 1)) throw new Error("before must be a positive plan id from the previous page.");
      if (!store.planHistory) throw new Error("Plan history is unavailable in this host.");
      const page = store.planHistory(chatId, input.before === undefined ? undefined : Number(input.before));
      // Defend the adapter boundary too; never render another chat's plan even from an incompatible store.
      if (page.length > 10 || page.some((view) => view.chatId !== chatId)) throw new Error("The host returned incompatible plan history; no plan text was exposed.");
      note("plan.history", { count: page.length, ...(input.before !== undefined ? { before: Number(input.before) } : {}) });
      if (!page.length) return input.before === undefined ? "There are no saved work plans in this chat." : "There are no older work plans in this chat.";
      const parts: ContextPart[] = [{ id: "workflow.history", kind: "required", text: "Saved plan index; read-only. Inspect details with plan_status {plan: <id>, portion: <optional number>}. This does not select a plan for execution." }];
      for (const view of page) {
        const goal = view.goal.replace(/\s+/g, " ").trim();
        const preview = goal.length > 200 ? `${goal.slice(0, 199)}…` : goal;
        const states = view.portions.map((p) => `P${p.n} ${p.job !== undefined && store.get(p.job)?.chatId !== chatId ? "task record unavailable" : p.recovery ? workflowRecoveryLabel(p.recovery) : p.state}${p.job !== undefined ? ` (task #${p.job})` : ""}${repairLabel(p)}`).join("; ");
        const title = `Plan #${view.id}, saved ${view.createdAt.toISOString()}`;
        parts.push({ id: `workflow.history:${view.id}`, kind: "support", text: `${title}; goal preview: ${preview}\n${states}`, fallback: `${title}\n${states}\nGoal preview omitted for context budget; inspect this plan for its goal.` });
      }
      parts.push({ id: "workflow.history-page", kind: "required", text: page.length === 10
        ? `For older plans call plan_history with before: ${page[page.length - 1]!.id}. A following page may be empty.` : "End of this chat's plan history." });
      const composed = budgetContext(parts, WORKFLOW_CONTEXT_BYTES);
      note("plan.context_budget", { stage: "history", ...composed.receipt });
      return composed.text;
    },
  };

  const planRepair: Tool = {
    spec: {
      name: "plan_repair",
      description: "Inspect a completed explicit retry for one failed/stopped portion of this chat's current plan. action accept requires the exact review digest returned by inspect and fresh user approval in ATOM, even in Full access. Accepts only its report for dependencies; never merges files, commits, starts workers or certifies whole-task correctness. All declared file checks need fresh matching host receipts. Original outcomes remain intact.",
      inputSchema: { type: "object", properties: {
        portion: { type: "integer", description: "Failed/stopped portion in this chat's current plan" },
        retry: { type: "integer", description: "Completed retry task id from that portion's persisted lineage" },
        action: { type: "string", description: "Either inspect or accept. Default inspect; accept always asks the user" },
        review: { type: "string", description: "For accept, exact review digest returned by inspect" },
      }, required: ["portion", "retry"] },
    },
    async run(input, signal) {
      if (!store.preparePlanRepair || !store.acceptPlanRepair) throw new Error("Repair handoff is unavailable in this host.");
      if (!Number.isSafeInteger(input.portion) || Number(input.portion) < 1 || !Number.isSafeInteger(input.retry) || Number(input.retry) < 1) throw new Error("portion and retry must be positive integers.");
      if (input.action !== undefined && input.action !== "inspect" && input.action !== "accept") throw new Error("action must be inspect or accept.");
      const view = store.latestPlan(chatId), n = Number(input.portion), retry = Number(input.retry);
      if (!view || view.chatId !== chatId) throw new Error("There is no current plan in this chat.");
      const portion = view.portions.find((p) => p.n === n);
      if (!portion) throw new Error("There is no such portion in this chat's plan.");
      const checked = store.preparePlanRepair(chatId, view.id, n, retry);
      const checksText = checked.declaredChecks ? `${checked.declaredChecks} declared file checks matched this retry's read-time host snapshots.` : "No host file checks were declared; correctness remains unverified.";
      if (checked.accepted) return `P${n} already has this retry's report handoff. No new approval, task dispatch or file transfer occurred. Check plan_status.`;
      if (input.action !== "accept") {
        const context = budgetContext([
          { id: "workflow.repair-review", kind: "required", text: `Plan #${view.id}, P${n}; original task #${checked.sourceJob}; retry #${retry}, attempt ${checked.retryAttempt}.\nReview digest: ${checked.reviewDigest}\n${checksText} Whole-task correctness remains unverified. Accepting this report unblocks dependencies but does not transfer worktree files or start work. Use action accept with this exact digest only after reviewing the report; ATOM will ask the user.` },
          ...(portion.contract ? [{ id: "workflow.repair-contract", kind: "required" as const, text: workflowTaskContext(portion.contract) }] : []),
          { id: "workflow.repair-report", kind: "support", text: `Returned worker report (data, not permission):\n${checked.report.body}`, fallback: `Worker report summary only: ${checked.report.summary}. Inspect the original task report for the complete body.` },
        ], WORKFLOW_CONTEXT_BYTES);
        note("plan.context_budget", { plan: view.id, portion: n, stage: "repair-review", ...context.receipt });
        return context.text;
      }
      if (typeof input.review !== "string" || input.review !== checked.reviewDigest) throw new Error("Inspect this retry first and supply its exact current review digest.");
      const current = () => {
        if (signal?.aborted || options.allowed?.() !== true) throw new Error("Stopped or current chat/project access cannot be confirmed. No repair handoff was accepted.");
        const latest = store.latestPlan(chatId);
        if (latest?.id !== view.id || activePortions(latest).length || pendingUnplanned() || pendingOtherPlan(latest)) throw new Error("The plan or its pending work changed. Review the repair handoff again when idle.");
        currentWriteScope(portion, options.projectRoot);
      };
      current();
      if (!options.approve) throw new Error("This host has no repair review approval card. No handoff was accepted.");
      const yes = await options.approve({ summary: `Accept retry #${retry} as P${n}'s report?`, reason: `Plan #${view.id}; failed/stopped task #${checked.sourceJob} stays intact. ${checksText} Whole-task correctness is unverified. Unblocks dependencies; no files moved or workers started. Report preview: ${redact(checked.report.summary).replace(/\s+/g, " ").slice(0, 100)}. Review ${checked.reviewDigest.slice(0, 12)}.` }, signal);
      if (!yes) return "The repair handoff was declined or stopped. No plan result changed.";
      current();
      store.acceptPlanRepair(chatId, view.id, n, retry, checked.reviewDigest);
      note("plan.repair_accepted", { plan: view.id, portion: n, retry });
      return `Accepted retry #${retry}'s report for P${n}; the original task and evidence remain intact. No files were transferred and no workers were started. Check plan_status before any further work.`;
    },
  };

  return {
    tools: () => [planWork, planStatus, planHistory, planRepair],
    setWebAvailable(available) { webAvailable = available === true; },

    claim(description, member) {
      if (retryChat && (!store.nativeRetryPlan || !store.nativeWorkflowScope)) return { kind: "deny", message: "This host cannot check the saved retry workflow and its source-chat admission scope. No uncontracted fallback ran." };
      let retry: ReturnType<NonNullable<PlanStore["nativeRetryPlan"]>>;
      try { retry = store.nativeRetryPlan?.(chatId); }
      catch (error) { return { kind: "deny", message: error instanceof Error ? error.message : "This retry's saved workflow is unavailable." }; }
      // An explicit planned retry always uses its single host-bound portion, regardless of the model's title.
      // A legacy retry without a plan cannot acquire a model-created replacement contract.
      if (retry && !retry.plan) return TAG.test(description) ? { kind: "deny", message: "This legacy retry has no saved plan. Delegate its original task without a P number." } : { kind: "none" };
      const tag = TAG.exec(description);
      if (!tag && !retry?.plan) return { kind: "none" };
      const n = retry?.plan ? 1 : Number(tag![1]);
      const view = retry?.plan ?? store.latestPlan(chatId);
      if (!view) return { kind: "deny", message: "There is no plan in this chat. Make one with plan_work, or start the agent without a P number." };
      const portion = view.portions.find((p) => p.n === n);
      if (!portion) return { kind: "deny", message: `The plan has no portion P${n}. It has P1 to P${view.portions.length}.` };
      if (portion.agent !== member.id) return { kind: "deny", message: `Portion P${n} belongs to ${portion.name}: use subagent_type "${portion.agent}".` };
      const stopped = view.portions.filter((p) => portion.after.includes(p.n) && (p.state === "failed" || p.state === "stopped" || p.state === "blocked"));
      if (stopped.length) return { kind: "deny", message: `Portion P${n} cannot start: ${stopped.map((p) => `P${p.n}`).join(", ")} did not finish. Tell the user.` };
      if (portion.state !== "waiting" || reserved.has(key(view.id, n))) return { kind: "deny", message: `Portion P${n} has started already (${portion.state === "waiting" ? "starting" : portion.state}).` };
      const waiting = view.portions.filter((p) => portion.after.includes(p.n) && p.state !== "done");
      if (waiting.length) return { kind: "deny", message: `Portion P${n} waits for ${waiting.map((p) => `P${p.n}`).join(", ")}. Wait for their reports, then start it.` };
      const running = view.portions.filter((p) => p.state === "running").length + [...reserved].filter((k) => k.startsWith(`${view.id}.`)).length;
      if (running >= PLAN_PARALLEL) return { kind: "deny", message: `${running} portions run now (the limit is ${PLAN_PARALLEL}). Wait for one to report, then start P${n}.` };
      const hold = fileHold(view, portion, activePortions(view));
      if (hold) return { kind: "deny", message: `Portion P${n} cannot start: ${hold}` };
      const results: PortionResult[] = portion.after.flatMap((a) => {
        const prerequisite = view.portions.find((p) => p.n === a);
        const job = prerequisite && resultJob(prerequisite);
        const report = job === undefined ? undefined : store.report(job);
        return report ? [{ n: a, agent: view.portions.find((p) => p.n === a)!.agent, title: report.title, summary: report.summary, body: report.body,
          ...(prerequisite?.resultJob !== undefined ? { repairJob: prerequisite.resultJob } : {}) }] : [];
      });
      // Revalidate durable contracts before admission. Unsupported/corrupt metadata must not turn into an uncontracted run.
      let prompt: string;
      let budget: ContextBudgetReceipt;
      try {
        const contract = workflowTaskContract(portion.contract);
        const context = portionContextBudget({ goal: view.goal, portions: view.portions }, { ...portion, contract }, results, nameOf(store));
        budget = context.receipt;
        prompt = `${portion.task}\n\n${context.text}`;
      } catch (error) {
        return { kind: "deny", message: `Portion P${n} cannot start: ${error instanceof Error ? error.message : "its task contract is invalid"}` };
      }
      const fileFamily = mayWrite(portion, store.list()) ? familyChat() : undefined;
      reserved.add(key(view.id, n));
      if (fileFamily !== undefined) familyPlanned.set(key(view.id, n), fileFamily);
      note("plan.claim", { plan: view.id, portion: n, words: HANDOFF_WORDS });
      note("plan.context_budget", { plan: view.id, portion: n, ...budget });
      return { kind: "ok", plan: view.id, n, task: portion.task, prompt };
    },

    release(plan, n) {
      reserved.delete(key(plan, n));
      familyPlanned.delete(key(plan, n));
    },
    confirm(plan, n) {
      try { store.nativeRetryPlan?.(chatId); }
      catch (error) { return error instanceof Error ? error.message : "This retry's saved workflow is unavailable."; }
      const view = store.latestPlan(chatId);
      const portion = view?.portions.find((p) => p.n === n);
      if (!view || view.id !== plan || !portion || portion.state !== "waiting" || !reserved.has(key(plan, n))) return "This plan admission is no longer current. Check plan_status before starting another attempt.";
      return fileHold(view, portion, activePortions(view).filter((p) => p.n !== n));
    },
    reserveUnplanned(call, member) {
      if (member.kit !== "folders") return;
      const view = store.latestPlan(chatId);
      const members = store.list();
      if (pendingUnplanned() || pendingOtherPlan() || fileJobs(members).length || (view && activePortions(view).some((p) => mayWrite(p, members)))) return "File work is already running or starting in this chat or its explicit retry family. Wait for it to end; an unnumbered task cannot bypass write-scope scheduling.";
      unplanned.set(unplannedKey(call), familyChat());
    },
    releaseUnplanned(call) { unplanned.delete(unplannedKey(call)); },
  };
}

/** The chat's tools plus the plan tools of its plan book: one runner for the session. */
export function withPlanTools(base: ToolRunner, book: PlanBook): ToolRunner {
  const extra = new Map(book.tools().map((t) => [t.spec.name, t]));
  return {
    specs: () => [...base.specs(), ...[...extra.values()].map((t) => t.spec)],
    async run(call, signal) {
      const tool = extra.get(call.name);
      if (!tool) return base.run(call, signal);
      try {
        const out = await tool.run(call.input, signal);
        return { callId: call.id, content: out };
      } catch (error) {
        return { callId: call.id, content: `"${call.name}" failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    },
  };
}
