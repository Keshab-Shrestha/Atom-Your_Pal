// ADR-081: the helper store as the island sees it (wire shapes, ISO dates, sorted app names).

import type { HelperStore, Job } from "@zeno/helpers";
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
});

/** `apps` lists installed app names (`installedApps` from the tool engine). */
export function islandHelpers(store: HelperStore, apps: () => Promise<string[]>): IslandHelpers {
  return {
    list: () => store.list().map((h) => ({ ...h, jobs: h.jobs.map(toJobItem) })),
    apps: async () => [...(await apps())].sort((a, b) => a.localeCompare(b)),
    setApp: (helper, app) => store.setApp(helper, app),
    addJob: (helper, task) => void store.addJob(helper, task),
    stop: (id) => store.stop(id),
    remove: (id) => store.remove(id),
    report: (id) => {
      const report = store.report(id);
      return report && { id, title: report.title, summary: report.summary, body: report.body, sources: report.sources };
    },
    onChange: (listener) => store.onChange(listener),
  };
}
