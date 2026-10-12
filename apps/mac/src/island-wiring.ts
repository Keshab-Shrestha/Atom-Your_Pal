// Pieces of the island's helper wiring, moved out of runtime.ts without changes: ZENO's task branches (ADR-091) and
// the board's Paperclip section (Task 3.16).

import type { HelperStore } from "@zeno/helpers";
import type { IslandGit, IslandHelpers } from "./island.ts";
import { branchDiff, pushBranch, repositoriesOf, zenoBranches } from "./git-branches.ts";
import type { createPaperclip, issueTracker } from "./paperclip.ts";

/** The Paperclip connection createRuntime builds when ZENO_PAPERCLIP_URL is set. */
export type Paperclip = { client: ReturnType<typeof createPaperclip>; tracker: ReturnType<typeof issueTracker> };

/** ADR-091: ZENO's task branches in the repositories Keshab granted; pushing one is his alone, asked from the window. */
export function createIslandGit(helpers: HelperStore): IslandGit {
  const grantedRepos = () => repositoriesOf([...new Set((helpers?.list() ?? []).flatMap((h) => h.grants ?? []))]);
  const allowedRepo = async (repo: string) => {
    if (!(await grantedRepos()).includes(repo)) throw new Error("That repository is not in a folder you granted.");
  };
  return {
    list: async () => {
      const branches = (await Promise.all((await grantedRepos()).map((r) => zenoBranches(r).catch(() => [])))).flat();
      return branches.map((b) => {
        const title = helpers.report(b.task)?.title ?? helpers.get(b.task)?.task.split("\n")[0]?.slice(0, 80);
        return { ...b, ...(title ? { title } : {}) };
      });
    },
    push: async (repo, branch) => {
      await allowedRepo(repo);
      await pushBranch(repo, branch);
    },
    diff: async (repo, branch) => {
      await allowedRepo(repo);
      return branchDiff(repo, branch);
    },
  };
}

/** The board's Paperclip section and its updates, when the connection is on. */
export function withPaperclip(paperclip: Paperclip | undefined, paperclipListeners: Set<() => void>, island: IslandHelpers): IslandHelpers {
  if (!paperclip) return island;
  return {
    ...island,
    paperclip: () => ({ issues: paperclip.tracker.list().map(({ told: _told, ...item }) => item) }),
    onChange: (listener) => {
      const stop = island.onChange(listener);
      paperclipListeners.add(listener);
      return () => {
        stop();
        paperclipListeners.delete(listener);
      };
    },
  };
}
