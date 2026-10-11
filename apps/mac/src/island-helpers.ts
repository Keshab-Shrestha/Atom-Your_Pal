// ADR-081: the helper store as the island sees it (wire shapes, ISO dates, sorted app names).

import { HelperError, describeSchedule, type HelperStore, type Job, type PlanModel } from "@zeno/helpers";
import type { IslandHelpers } from "./island.ts";
import type { JobItem, SkillDraftItem, SkillEditItem } from "./island-protocol.ts";

/** ADR-094: how much of a draft's steps, and of each side of an edit, the window shows. */
const PREVIEW_CHARS = 400;
const CHANGE_LINES = 6;

const cut = (text: string) => (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text);

/** A compact before and after: from the first line that differs, a few lines of each. */
export function compactChange(before: string, after: string): { before: string; after: string } {
  const a = before.split("\n");
  const b = after.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const part = (lines: string[]) => cut(lines.slice(i, i + CHANGE_LINES).join("\n"));
  return { before: part(a), after: part(b) };
}

const toJobItem = (job: Job, held?: string): JobItem => ({
  id: job.id,
  task: job.task,
  state: job.state,
  createdAt: job.createdAt.toISOString(),
  ...(job.endedAt ? { endedAt: job.endedAt.toISOString() } : {}),
  ...(job.step ? { step: job.step } : {}),
  ...(job.partial ? { partial: true } : {}),
  ...(job.title !== undefined ? { title: job.title } : {}),
  ...(job.summary !== undefined ? { summary: job.summary } : {}),
  ...(job.error ? { error: job.error } : {}),
  ...(job.model ? { model: job.model } : {}),
  ...(job.modelReason ? { modelReason: job.modelReason } : {}),
  blockedBy: job.blockedBy,
  waitingFor: job.waitingFor,
  comments: job.comments,
  ...(job.goal ? { goal: job.goal } : {}),
  ...(job.goalId !== undefined ? { goalId: job.goalId } : {}),
  ...(job.goalEnded ? { goalEnded: true } : {}),
  ...(job.resumable ? { resumable: true } : {}),
  ...(held ? { held } : {}),
  ...(job.planFirst ? { planFirst: true } : {}),
  ...(job.planStatus ? { planStatus: job.planStatus } : {}),
  ...(job.planSummary ? { planSummary: job.planSummary } : {}),
  ...(job.rating ? { rating: job.rating } : {}),
  ...(job.reviews !== undefined ? { reviews: job.reviews } : {}),
  ...(job.autoRetries ? { autoRetries: job.autoRetries } : {}),
  ...(job.parentId !== undefined ? { parentId: job.parentId } : {}),
});

/**
 * `apps` lists installed app names (`installedApps` from the tool engine); `models` the plan's models for worker jobs
 * (ADR-083), empty when the provider is not the Claude plan.
 */
export function islandHelpers(
  store: HelperStore,
  apps: () => Promise<string[]>,
  models: () => PlanModel[] = () => [],
  /** Task 3.7: why a task may not start now (budgets, the plan's window), if so. */
  held: (job: Job) => string | undefined = () => undefined,
  /** Task 3.12, ADR-094: the skills to choose from, Keshab's and ZENO's (default: none, for tests). */
  skills: () => { name: string; description: string; source?: "yours" | "zeno" }[] = () => [],
): IslandHelpers {
  return {
    list: () =>
      store.list().map((h) => ({
        ...h,
        soulVersions: h.soulVersions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString() })),
        routines: h.routines.map((r) => ({
          id: r.id,
          task: r.task,
          when: describeSchedule(r.schedule),
          ...(r.lastAt ? { lastAt: r.lastAt.toISOString() } : {}),
          ...(r.lastSkipped ? { lastSkipped: true } : {}),
        })),
        proposals: h.proposals.map((p) => ({ id: p.id, field: p.field, text: p.text, reason: p.reason, jobId: p.jobId, state: p.state, createdAt: p.createdAt.toISOString() })),
        jobs: h.jobs.map((job) => toJobItem(job, held(job))),
      })),
    budgets: () => {
      const { team, planLimit } = store.budgets();
      return { team, planLimit };
    },
    setBudget: (helper, cap) => store.setBudget(helper, cap),
    setPlanLimit: (percent) => store.setPlanLimit(percent),
    apps: async () => [...(await apps())].sort((a, b) => a.localeCompare(b)),
    setApp: (helper, app) => store.setApp(helper, app),
    addJob: (helper, task, blockedBy, planFirst) =>
      void store.addJob(helper, task, { ...(blockedBy ? { blockedBy } : {}), ...(planFirst !== undefined ? { planFirst } : {}) }),
    approvePlan: (id) => store.approvePlan(id),
    rejectPlan: (id) => store.rejectPlan(id),
    setPlanFirst: (helper, on) => store.setPlanFirst(helper, on),
    removeRoutine: (id) => store.removeRoutine(id),
    createAgent: (input) => void store.createAgent(input),
    removeAgent: (id) => store.removeAgent(id),
    agentProblems: () => store.agentProblems().map(({ id, problem }) => ({ id, problem })),
    retry: (id) => store.retry(id),
    usage: () => {
      const summary = store.usage();
      const names = new Map(store.list().map((h) => [h.id, h.name]));
      return { ...summary, byWorker: summary.byWorker.map((w) => ({ ...w, name: w.helper === null ? "ZENO chat" : (names.get(w.helper) ?? w.helper) })) };
    },
    mcp: () =>
      store.mcpServers().map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        ...(s.command ? { command: s.command } : {}),
        args: s.args,
        ...(s.url ? { url: s.url } : {}),
        transport: s.transport,
        envKeys: Object.keys(s.env),
        headerKeys: Object.keys(s.headers),
        enabled: s.enabled,
        trusted: s.trusted,
        workers: s.workers,
        tools: s.tools,
        ...(s.testedAt ? { testedAt: s.testedAt.toISOString() } : {}),
        ...(s.problem ? { problem: s.problem } : {}),
      })),
    addMcp: ({ name, kind, command, args, env, url, transport, headers }) =>
      void store.addMcpServer({ name, kind, ...(command !== undefined ? { command } : {}), ...(args ? { args } : {}), ...(env ? { env } : {}), ...(url !== undefined ? { url } : {}), ...(transport ? { transport } : {}), ...(headers ? { headers } : {}) }),
    removeMcp: (id) => store.removeMcpServer(id),
    setMcp: (id, { enabled, trusted, workers }) =>
      store.setMcpServer(id, { ...(enabled !== undefined ? { enabled } : {}), ...(trusted !== undefined ? { trusted } : {}), ...(workers ? { workers } : {}) }),
    rate: (id, good, comment) => store.rate(id, good, comment),
    acceptProposal: (id) => store.acceptProposal(id),
    rejectProposal: (id) => store.rejectProposal(id),
    undoProposal: (id) => store.undoProposal(id),
    skills,
    skillDrafts: (): SkillDraftItem[] =>
      store.skillDrafts().map((d) => ({ id: d.id, jobId: d.jobId, helper: d.helper, name: d.name, description: d.description, preview: cut(d.body), state: d.state, createdAt: d.createdAt.toISOString() })),
    skillEdits: (): SkillEditItem[] =>
      store.skillEdits().map((e) => ({ id: e.id, skill: e.skill, jobId: e.jobId, reason: e.reason, ...compactChange(e.oldBody, e.newBody), state: e.state, createdAt: e.createdAt.toISOString() })),
    makeSkill: (id) => store.makeSkill(id),
    approveSkillDraft: (id) => store.approveSkillDraft(id),
    rejectSkillDraft: (id) => store.rejectSkillDraft(id),
    acceptSkillEdit: (id) => store.acceptSkillEdit(id),
    rejectSkillEdit: (id) => store.rejectSkillEdit(id),
    undoSkillEdit: (id) => store.undoSkillEdit(id),
    setSkills: (helper, names) => {
      const known = new Set(skills().map((s) => s.name));
      const missing = names.find((n) => !known.has(n));
      if (missing !== undefined) throw new HelperError(`There is no skill called "${missing.slice(0, 40)}" in ~/.claude/skills or ZENO's skills.`);
      store.setSkills(helper, names);
    },
    addGrant: (helper, path) => store.addGrant(helper, path),
    removeGrant: (helper, path) => store.removeGrant(helper, path),
    setBlockers: (id, blockedBy) => store.setBlockers(id, blockedBy),
    addComment: (id, text) => store.addComment(id, text),
    startFresh: (id) => store.startFresh(id),
    thread: (id) => {
      const thread = store.thread(id);
      if (!thread) return undefined;
      const { report } = thread;
      const goalId = store.get(id)?.goalId;
      const goal = goalId === undefined ? undefined : store.goal(goalId);
      return {
        id,
        comments: thread.comments.map((c) => ({ id: c.id, text: c.text, createdAt: c.createdAt.toISOString() })),
        activity: thread.activity.map((a) => ({ kind: a.kind, at: a.at.toISOString() })),
        ...(thread.plan ? { plan: thread.plan } : {}),
        ...(thread.handOffs.length ? { handOffs: thread.handOffs } : {}),
        ...(report ? { report: { title: report.title, summary: report.summary, body: report.body, sources: report.sources } } : {}),
        ...(goal
          ? {
              goal: {
                id: goal.id,
                text: goal.text,
                ended: Boolean(goal.endedAt),
                tasks: goal.tasks.map((t) => t.id),
                ...(goal.report ? { report: goal.report } : {}),
              },
            }
          : {}),
      };
    },
    pin: (helper, model) => {
      if (model && !models().some((m) => m.id === model)) throw new HelperError("That model is not offered for helper jobs.");
      store.pin(helper, model);
    },
    saveSoul: (helper, soul) => store.saveSoul(helper, soul),
    restoreSoul: (helper, version) => store.restoreSoul(helper, version),
    allowLarge: () => store.allowLarge(),
    setAllowLarge: (allowed) => store.setAllowLarge(allowed),
    models: () => models().map(({ id, name, tier }) => ({ id, name, tier })),
    stop: (id) => store.stop(id),
    remove: (id) => store.remove(id),
    onChange: (listener) => store.onChange(listener),
  };
}
