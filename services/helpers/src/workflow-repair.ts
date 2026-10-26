import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { HelperError } from "./jobs.ts";
import type { planTable, StoredPlan } from "./plans.ts";
import type { HelperStore, Job, PlanView, Report } from "./store-types.ts";
import type { TaskEvidence } from "./task-evidence.ts";
import { fileCheckManifest, taskFileChecks } from "./file-checks.ts";
import { workflowTaskContract } from "./workflow-contract.ts";
import { workflowReference } from "./workflow-routing.ts";
import { parseWriteScope } from "./write-scopes.ts";

export interface PlanRepairReceipt {
  schema: "atom.plan-repair/v1";
  plan: number;
  portion: number;
  sourceJob: number;
  retryJob: number;
  retryAttempt: string;
  definitionDigest: string;
  reportDigest: string;
  evidenceDigest: string;
  reviewDigest: string;
  at: string;
}
export type PlanRepairView = { n: number; state: "accepted"; receipt: PlanRepairReceipt } | { n: number; state: "unavailable" };
export interface PlanRepairReview extends Omit<PlanRepairReceipt, "schema" | "at"> {
  report: Report;
  declaredChecks: number;
  accepted: boolean;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digest = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const positive = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0;
const reviewIdentity = (r: Omit<PlanRepairReceipt, "schema" | "at" | "reviewDigest">) => ({ plan: r.plan, portion: r.portion,
  sourceJob: r.sourceJob, retryJob: r.retryJob, retryAttempt: r.retryAttempt, definitionDigest: r.definitionDigest,
  reportDigest: r.reportDigest, evidenceDigest: r.evidenceDigest });
const definition = (plan: StoredPlan, n: number) => {
  const p = plan.portions.find((p) => p.n === n);
  if (!p) throw new HelperError("There is no such plan portion.");
  workflowTaskContract(p.contract); workflowReference(p.workflow); taskFileChecks(p.fileChecks); parseWriteScope(p.writeScope);
  return hash({ goal: plan.goal, portion: p });
};
function decode(raw: string): PlanRepairReceipt | undefined {
  try {
    if (Buffer.byteLength(raw, "utf8") > 4096) return;
    const r = JSON.parse(raw) as PlanRepairReceipt;
    if (r.schema !== "atom.plan-repair/v1" || Object.keys(r).some((k) => !["schema", "plan", "portion", "sourceJob", "retryJob", "retryAttempt", "definitionDigest", "reportDigest", "evidenceDigest", "reviewDigest", "at"].includes(k))
      || ![r.plan, r.portion, r.sourceJob, r.retryJob].every(positive) || !uuid.test(r.retryAttempt)
      || ![r.definitionDigest, r.reportDigest, r.evidenceDigest, r.reviewDigest].every((s) => typeof s === "string" && digest.test(s))
      || typeof r.at !== "string" || new Date(r.at).toISOString() !== r.at || hash(reviewIdentity(r)) !== r.reviewDigest) return;
    return r;
  } catch { return; }
}

/** One report handoff per portion. Original job links, task outcomes and evidence are never rewritten. */
export function planRepairStore(db: DatabaseSync, deps: {
  plans: ReturnType<typeof planTable>;
  get(id: number): Job | undefined;
  report(id: number): Report | undefined;
  evidence(id: number): TaskEvidence | undefined;
  retry(chat: string): ReturnType<HelperStore["nativeRetryPlan"]>;
  view(plan: StoredPlan): PlanView;
  scope(chat: string): ReturnType<HelperStore["nativeWorkflowScope"]>;
  transaction(work: () => void): void;
  now(): Date;
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS plan_repairs (
    plan_id INTEGER NOT NULL, n INTEGER NOT NULL, source_job_id INTEGER NOT NULL,
    retry_job_id INTEGER NOT NULL UNIQUE, receipt TEXT NOT NULL, PRIMARY KEY(plan_id, n)
  )`);
  const rows = db.prepare("SELECT * FROM plan_repairs WHERE plan_id = ? ORDER BY n");
  const rowOf = db.prepare("SELECT * FROM plan_repairs WHERE plan_id = ? AND n = ?");
  const save = db.prepare("INSERT INTO plan_repairs(plan_id, n, source_job_id, retry_job_id, receipt) VALUES (?, ?, ?, ?, ?)");
  type Row = { plan_id: number; n: number; source_job_id: number; retry_job_id: number; receipt: string };
  const bound = (plan: StoredPlan, row: Row): PlanRepairReceipt | undefined => {
    try {
      const r = decode(row.receipt), original = deps.plans.jobs(plan.id).find((p) => p.n === row.n);
      const portion = plan.portions.find((p) => p.n === row.n);
      const source = deps.get(row.source_job_id), retry = deps.get(row.retry_job_id);
      const report = deps.report(row.retry_job_id), evidence = deps.evidence(row.retry_job_id);
      if (!r || r.plan !== plan.id || r.portion !== row.n || r.sourceJob !== row.source_job_id || r.retryJob !== row.retry_job_id
        || !portion || original?.job !== r.sourceJob || source?.chatId !== plan.chatId || source.helper !== portion.agent || source.task !== portion.task
        || (source.state !== "failed" && source.state !== "stopped")
        || retry?.state !== "done" || retry.partial || retry.recoveryNeeded || !report || evidence?.state !== "reported"
        || retry.helper !== source.helper || retry.task !== portion.task
        || evidence.attempt !== r.retryAttempt || definition(plan, row.n) !== r.definitionDigest
        || hash(report) !== r.reportDigest || hash(evidence) !== r.evidenceDigest) return;
      return r;
    } catch { return; } // Damaged historical metadata cannot unblock work.
  };
  const prepare = (chat: string, planId: number, n: number, retryId: number): PlanRepairReview => {
    if (![planId, n, retryId].every(positive) || /^task-retry-\d+$/.test(chat)) throw new HelperError("Repair handoff belongs to the original plan's chat and requires positive plan, portion and retry ids.");
    const plan = deps.plans.getInChat(chat, planId);
    if (!plan || deps.plans.latestOf(chat)?.id !== planId) throw new HelperError("Only this chat's current plan can receive a repair handoff.");
    const portion = plan.portions.find((p) => p.n === n), sourceId = deps.plans.jobs(planId).find((p) => p.n === n)?.job;
    const source = sourceId !== undefined ? deps.get(sourceId) : undefined, retry = deps.get(retryId);
    const ineligible = () => new HelperError("That completed retry is not eligible for this plan portion. Review the source task and its retry lineage.");
    if (!portion || !source || source.chatId !== chat || (source.state !== "failed" && source.state !== "stopped")
      || !retry?.chatId || retry.state !== "done" || retry.partial || retry.recoveryNeeded || retry.helper !== source.helper || retry.task !== portion.task) throw ineligible();
    const seen = new Set<number>();
    let ancestor: Job | undefined = retry;
    while (ancestor && ancestor.id !== source.id) {
      if (seen.has(ancestor.id) || seen.size >= 1000 || ancestor.retryOf === undefined) throw ineligible();
      seen.add(ancestor.id); ancestor = deps.get(ancestor.retryOf);
    }
    if (!ancestor || retry.id === source.id) throw ineligible();
    const retryPlan = deps.retry(retry.chatId);
    if (retryPlan?.job !== retry.id || !retryPlan.plan) throw ineligible();
    const copy = retryPlan.plan.portions[0];
    if (!copy || copy.agent !== portion.agent || (["contract", "workflow", "fileChecks", "writeScope", "scopeBinding"] as const)
      .some((field) => JSON.stringify(copy[field]) !== JSON.stringify(portion[field]))) throw ineligible();
    const report = deps.report(retry.id), evidence = deps.evidence(retry.id);
    if (!report?.body.trim() || !report.summary.trim() || evidence?.state !== "reported") throw new HelperError("The retry needs a complete saved report and its own finished host attempt record.");
    const checks = taskFileChecks(portion.fileChecks);
    if (checks?.length && (!evidence.verification || evidence.verification.attempt !== evidence.attempt
      || evidence.verification.manifestDigest !== fileCheckManifest(checks) || evidence.verification.checks.length !== checks.length
      || evidence.verification.checks.some((c) => c.state !== "matched"))) throw new HelperError("Declared file checks need matched host receipts from this retry's own attempt before its report can be accepted.");
    const identity = { plan: planId, portion: n, sourceJob: source.id, retryJob: retry.id, retryAttempt: evidence.attempt,
      definitionDigest: definition(plan, n), reportDigest: hash(report), evidenceDigest: hash(evidence) };
    const reviewDigest = hash(identity), existing = rowOf.get(planId, n) as Row | undefined;
    if (existing) {
      const receipt = bound(plan, existing);
      if (!receipt || receipt.reviewDigest !== reviewDigest) throw new HelperError("This portion already has a different or unavailable repair handoff. Review its history and prepare a new plan.");
      return { ...identity, reviewDigest, report, declaredChecks: checks?.length ?? 0, accepted: true };
    }
    if (deps.scope(chat).jobs.length) throw new HelperError("Wait for this chat's workflow and retry tasks to finish before accepting a repair handoff.");
    const view = deps.view(plan);
    if (portion.after.some((dep) => view.portions.find((p) => p.n === dep)?.state !== "done")) throw new HelperError("The original prerequisites are not complete; this repair cannot unblock later portions.");
    const descendants = new Set<number>([n]);
    for (let i = 0; i < plan.portions.length; i++) for (const p of plan.portions) if (p.after.some((dep) => descendants.has(dep))) descendants.add(p.n);
    if (view.portions.some((p) => p.n !== n && descendants.has(p.n) && p.job !== undefined)) throw new HelperError("A dependent portion already started. Prepare a new plan instead of changing its prerequisite result retroactively.");
    return { ...identity, reviewDigest, report, declaredChecks: checks?.length ?? 0, accepted: false };
  };
  return {
    ofPlan(plan: StoredPlan): PlanRepairView[] {
      return (rows.all(plan.id) as Row[]).map((row): PlanRepairView => {
        const receipt = bound(plan, row);
        return receipt ? { n: row.n, state: "accepted", receipt } : { n: row.n, state: "unavailable" };
      });
    },
    prepare,
    accept(chat: string, plan: number, portion: number, retry: number, reviewDigest: string): PlanRepairReceipt {
      let receipt: PlanRepairReceipt | undefined;
      deps.transaction(() => {
        const checked = prepare(chat, plan, portion, retry);
        if (checked.reviewDigest !== reviewDigest) throw new HelperError("The reviewed retry, report or host evidence changed. Inspect it again before approval.");
        if (checked.accepted) { receipt = decode((rowOf.get(plan, portion) as Row).receipt)!; return; }
        receipt = { schema: "atom.plan-repair/v1", ...reviewIdentity(checked), reviewDigest, at: deps.now().toISOString() };
        save.run(plan, portion, receipt.sourceJob, retry, JSON.stringify(receipt));
      });
      return receipt!;
    },
  };
}
