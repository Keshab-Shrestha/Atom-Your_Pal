// ADR-081: the helper store as the island sees it (wire shapes, ISO dates, sorted app names).

import { HelperError, describeSchedule, describeWake, nextDue, type HelperStore, type Job, type PlanModel, type Schedule, type TaskSearchHit, type TestKind } from "@atom/helpers";
import type { IslandHelpers } from "./island.ts";
import type { JobItem, ManagerItem, RoutineInput, SkillDraftItem, SkillEditItem, TestCaseItem, TestsItem } from "./island-protocol.ts";

/** ADR-097: the form's schedule as the store's; missing numbers become -1, which the store refuses with words. */
const scheduleOf = (input: RoutineInput): Schedule =>
  input.kind === "hours" ? { kind: "hours", every: input.every ?? -1 }
  : input.kind === "weekly" ? { kind: "weekly", weekday: input.weekday ?? -1, minute: input.minute ?? -1 }
  : { kind: "daily", minute: input.minute ?? -1 };

/** ADR-097: an hourly schedule's first time; at most a year ahead, so a typo cannot park it for ever. */
function startOf(input: RoutineInput): Date | undefined {
  if (input.kind !== "hours" || !input.startAt) return undefined;
  const at = new Date(input.startAt);
  if (at.getTime() > Date.now() + 366 * 86_400_000) throw new HelperError("The first time must be within a year.");
  return at;
}

/** ADR-094: how much of a draft's steps, and of each side of an edit, the window shows. */
const PREVIEW_CHARS = 400;
const CHANGE_LINES = 6;

const cut = (text: string) => (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text);

/** ADR-098 item 8: how much of a test case's task and of each answer the window shows. */
const TEST_TASK_CHARS = 200;
const TEST_ANSWER_CHARS = 800;
const cutTo = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** ADR-098 item 8: a soul proposal's or skill edit's test run as the window shows it; undefined when it has none. */
export function testsOf(store: HelperStore, kind: TestKind, id: number): TestsItem | undefined {
  const results = store.testResults(kind, id);
  if (!results.length) return undefined;
  const count = (f: (r: (typeof results)[number]) => boolean) => results.filter(f).length;
  return {
    better: count((r) => r.better === "new"),
    same: count((r) => r.better === "same"),
    worse: count((r) => r.better === "old"),
    notRun: count((r) => r.state === "skipped"),
    failed: count((r) => r.state === "failed"),
    running: count((r) => r.state === "running"),
    results: results.map((r) => ({
      caseId: r.caseId,
      task: cutTo(r.task, TEST_TASK_CHARS),
      state: r.state,
      ...(r.better ? { better: r.better } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.oldAnswer ? { oldAnswer: cutTo(r.oldAnswer, TEST_ANSWER_CHARS) } : {}),
      ...(r.newAnswer ? { newAnswer: cutTo(r.newAnswer, TEST_ANSWER_CHARS) } : {}),
    })),
  };
}

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
  ...(job.interrupted ? { interrupted: true } : {}),
  ...(job.planFirst ? { planFirst: true } : {}),
  ...(job.planStatus ? { planStatus: job.planStatus } : {}),
  ...(job.planSummary ? { planSummary: job.planSummary } : {}),
  ...(job.rating ? { rating: job.rating } : {}),
  ...(job.reviews !== undefined ? { reviews: job.reviews } : {}),
  ...(job.autoRetries ? { autoRetries: job.autoRetries } : {}),
  ...(job.parentId !== undefined ? { parentId: job.parentId } : {}),
  ...(job.subAgents?.length ? { subAgents: job.subAgents } : {}),
  ...(job.labels?.length ? { labels: job.labels } : {}),
});

/**
 * `apps` lists installed app names (`installedApps` from the tool engine); `models` the plan's models for worker jobs
 * (ADR-083), empty when the provider is not the Claude plan.
 */
export function islandHelpers(
  store: HelperStore,
  apps: () => Promise<string[]>,
  models: () => PlanModel[] = () => [],
  /** Why a queued task waits for Keshab (a plan to approve, an interrupted run), if so. */
  held: (job: Job) => string | undefined = () => undefined,
  /** Task 3.12, ADR-094: the skills to choose from, Keshab's and ATOM's (default: none, for tests). */
  skills: () => { name: string; description: string; source?: "yours" | "zeno" | "hub" }[] = () => [],
  /** ADR-094: the clock for routines' next times (tests pass their own). */
  now: () => Date = () => new Date(),
): IslandHelpers {
  return {
    list: () =>
      store.list().map(({ wakeUp, ...h }) => ({
        ...h,
        soulVersions: h.soulVersions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString() })),
        routines: h.routines.map((r) => ({
          id: r.id,
          task: r.task,
          when: describeSchedule(r.schedule),
          schedule: r.schedule,
          ...(r.lastAt ? { lastAt: r.lastAt.toISOString() } : {}),
          ...(r.lastSkipped ? { lastSkipped: true } : {}),
          ...(r.paused ? { paused: true } : { nextAt: nextDue(r.schedule, r.createdAt, now()).toISOString() }),
          ...(r.notifyTelegram ? { notifyTelegram: true } : {}),
          ...(r.webhook ? { webhook: true } : {}),
        })),
        ...(wakeUp
          ? {
              wakeUp: {
                every: wakeUp.every,
                when: describeWake(wakeUp.every),
                ...(wakeUp.paused ? { paused: true } : {}),
                ...(wakeUp.lastAt ? { lastAt: wakeUp.lastAt.toISOString() } : {}),
                nextAt: wakeUp.nextAt.toISOString(),
              },
            }
          : {}),
        proposals: h.proposals.map((p) => {
          const tests = testsOf(store, "soul", p.id);
          return { id: p.id, field: p.field, text: p.text, reason: p.reason, jobId: p.jobId, state: p.state, createdAt: p.createdAt.toISOString(), ...(tests ? { tests } : {}) };
        }),
        jobs: h.jobs.map((job) => toJobItem(job, held(job))),
      })),
    apps: async () => [...(await apps())].sort((a, b) => a.localeCompare(b)),
    setApp: (helper, app) => store.setApp(helper, app),
    addJob: (helper, task, blockedBy, planFirst) =>
      void store.addJob(helper, task, { ...(blockedBy ? { blockedBy } : {}), ...(planFirst !== undefined ? { planFirst } : {}) }),
    approvePlan: (id) => store.approvePlan(id),
    rejectPlan: (id) => store.rejectPlan(id),
    setPlanFirst: (helper, on) => store.setPlanFirst(helper, on),
    setBrowser: (helper, on) => store.setBrowser(helper, on),
    addRoutine: (input) => void store.addRoutine(input.helper, input.task, scheduleOf(input), startOf(input), input.notifyTelegram, input.webhook),
    updateRoutine: (id, input) => void store.updateRoutine(id, input.helper, input.task, scheduleOf(input), startOf(input), input.notifyTelegram, input.webhook),
    removeRoutine: (id) => store.removeRoutine(id),
    pauseRoutine: (id, paused) => store.pauseRoutine(id, paused),
    teamTasks: () => store.teamTasks().map((t) => ({ id: t.id, task: t.task, ...(t.role ? { role: t.role } : {}), createdAt: t.createdAt.toISOString() })),
    addTeamTask: (task, role) => void store.addTeamTask(task, role ?? null),
    removeTeamTask: (id) => store.removeTeamTask(id),
    setWakeUp: (helper, every) => store.setWakeUp(helper, every === "off" ? null : every),
    pauseWakeUp: (helper, paused) => store.pauseWakeUp(helper, paused),
    createAgent: (input) => void store.createAgent(input),
    removeAgent: (id) => store.removeAgent(id),
    agentProblems: () => store.agentProblems().map(({ id, problem }) => ({ id, problem })),
    managers: (): ManagerItem[] =>
      store.managers().map((m) => ({ id: m.id, name: m.name, mode: m.mode, soul: m.soul, soulVersion: m.soulVersion, agents: m.agents, jobs: m.jobs.map((job) => toJobItem(job, held(job))) })),
    createManager: (name, mode) => void store.createManager({ name, ...(mode ? { mode } : {}) }),
    renameManager: (id, name) => store.renameManager(id, name),
    setManagerMode: (id, mode) => store.setManagerMode(id, mode),
    removeManager: (id) => store.removeManager(id),
    setManager: (helper, manager) => store.setManager(helper, manager),
    retry: (id) => store.retry(id),
    usage: () => {
      const summary = store.usage();
      const names = new Map([...store.list(), ...store.managers()].map((h) => [h.id, h.name]));
      return { ...summary, byWorker: summary.byWorker.map((w) => ({ ...w, name: w.helper === null ? "ATOM chat" : (names.get(w.helper) ?? w.helper) })) };
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
      store.skillEdits().map((e) => {
        const tests = testsOf(store, "skill", e.id);
        return { id: e.id, skill: e.skill, jobId: e.jobId, reason: e.reason, ...compactChange(e.oldBody, e.newBody), state: e.state, createdAt: e.createdAt.toISOString(), ...(tests ? { tests } : {}) };
      }),
    testCases: (): TestCaseItem[] =>
      store.testCases().map((c) => ({ id: c.id, kind: c.kind, target: c.target, jobId: c.jobId, task: cutTo(c.task, TEST_TASK_CHARS), createdAt: c.createdAt.toISOString() })),
    saveTestCase: (jobId, kind, target) => void store.saveTestCase(jobId, kind, target),
    deleteTestCase: (id) => store.deleteTestCase(id),
    makeSkill: (id) => store.makeSkill(id),
    approveSkillDraft: (id) => store.approveSkillDraft(id),
    rejectSkillDraft: (id) => store.rejectSkillDraft(id),
    acceptSkillEdit: (id) => store.acceptSkillEdit(id),
    rejectSkillEdit: (id) => store.rejectSkillEdit(id),
    undoSkillEdit: (id) => store.undoSkillEdit(id),
    setSkills: (helper, names) => {
      const known = new Set(skills().map((s) => s.name));
      const missing = names.find((n) => !known.has(n));
      if (missing !== undefined) throw new HelperError(`There is no skill called "${missing.slice(0, 40)}" in ~/.claude/skills or ATOM's skills.`);
      store.setSkills(helper, names);
    },
    addGrant: (helper, path) => store.addGrant(helper, path),
    removeGrant: (helper, path) => store.removeGrant(helper, path),
    setBlockers: (id, blockedBy) => store.setBlockers(id, blockedBy),
    addComment: (id, text) => store.addComment(id, text),
    addLabel: (id, label) => void store.addLabel(id, label),
    removeLabel: (id, label) => store.removeLabel(id, label),
    search: (query) => {
      const hit = (h: TaskSearchHit) => ({ id: h.id, title: h.title, snippet: h.snippet, at: h.at.toISOString() });
      const { tasks, reports } = store.search(query);
      return { tasks: tasks.map(hit), reports: reports.map(hit) };
    },
    startFresh: (id) => store.startFresh(id),
    undo: (id, options) => {
      const results = store.undoCheckpoints(id, options);
      // The thread (sent on the change) shows what is left; a file that could not be put back is also told in words.
      const failed = results.filter((r) => r.result !== "restored" && r.result !== "skipped");
      if (failed.length) throw new HelperError(`${failed.length} of ${results.length} files not undone: ${[...new Set(failed.map((r) => r.reason ?? r.result))].join(", ")}.`);
    },
    thread: (id) => {
      // ADR-098 item 8: the ATOM-made skills a done task's runs used.
      const testSkillsOf = (jobId: number) => {
        if (store.get(jobId)?.state !== "done") return {};
        const zeno = new Set(skills().filter((s) => s.source === "zeno").map((s) => s.name));
        const used = store.skillsUsed(jobId).filter((name) => zeno.has(name));
        return used.length ? { testSkills: used } : {};
      };
      const thread = store.thread(id);
      if (!thread) return undefined;
      const calls = store.toolCalls(id);
      const kept = store.checkpoints(id); // B3.4
      const { report } = thread;
      const goalId = store.get(id)?.goalId;
      const goal = goalId === undefined ? undefined : store.goal(goalId);
      return {
        id,
        comments: thread.comments.map((c) => ({ id: c.id, text: c.text, createdAt: c.createdAt.toISOString(), ...(c.delivery ? { delivery: c.delivery } : {}) })),
        activity: thread.activity.map((a) => ({ kind: a.kind, at: a.at.toISOString() })),
        ...(thread.plan ? { plan: thread.plan } : {}),
        ...(thread.handOffs.length ? { handOffs: thread.handOffs } : {}),
        ...testSkillsOf(id),
        ...(calls.length ? { toolCalls: calls } : {}),
        ...(kept.length ? { checkpoints: kept } : {}),
        ...(store.bashRan(id) ? { bashRan: true as const } : {}),
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
