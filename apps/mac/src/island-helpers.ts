// ADR-081: the helper store as the island sees it (wire shapes, ISO dates, sorted app names).

import { HelperError, type HelperStore, type Job, type PlanModel } from "@zeno/helpers";
import type { IslandHelpers } from "./island.ts";
import type { JobItem } from "./island-protocol.ts";

const toJobItem = (job: Job): JobItem => ({
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
  ...(job.parentId !== undefined ? { parentId: job.parentId } : {}),
});

/**
 * `apps` lists installed app names (`installedApps` from the tool engine); `models` the plan's models for worker jobs
 * (ADR-083), empty when the provider is not the Claude plan.
 */
export function islandHelpers(store: HelperStore, apps: () => Promise<string[]>, models: () => PlanModel[] = () => []): IslandHelpers {
  return {
    list: () =>
      store.list().map((h) => ({
        ...h,
        soulVersions: h.soulVersions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString() })),
        jobs: h.jobs.map(toJobItem),
      })),
    apps: async () => [...(await apps())].sort((a, b) => a.localeCompare(b)),
    setApp: (helper, app) => store.setApp(helper, app),
    addJob: (helper, task, blockedBy) => void store.addJob(helper, task, blockedBy ? { blockedBy } : {}),
    setBlockers: (id, blockedBy) => store.setBlockers(id, blockedBy),
    addComment: (id, text) => store.addComment(id, text),
    thread: (id) => {
      const thread = store.thread(id);
      if (!thread) return undefined;
      const { report } = thread;
      return {
        id,
        comments: thread.comments.map((c) => ({ id: c.id, text: c.text, createdAt: c.createdAt.toISOString() })),
        activity: thread.activity.map((a) => ({ kind: a.kind, at: a.at.toISOString() })),
        ...(report ? { report: { title: report.title, summary: report.summary, body: report.body, sources: report.sources } } : {}),
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
    report: (id) => {
      const report = store.report(id);
      return report && { id, title: report.title, summary: report.summary, body: report.body, sources: report.sources };
    },
    onChange: (listener) => store.onChange(listener),
  };
}
