// Pieces of the island's helper wiring, moved out of runtime.ts without changes: ATOM's task branches (ADR-091) and
// the board's Paperclip section (Task 3.16).

import { realpathSync } from "node:fs";
import type { HelperStore } from "@atom/helpers";
import type { IslandGit, IslandHelpers } from "./island.ts";
import { branchDiff, pushBranch, repositoriesOf, zenoBranches, taskWorkingCopy } from "./git-branches.ts";
import { workingCopyDirty } from "./git-review.ts";
import type { createPaperclip, issueTracker } from "./paperclip.ts";

/** The Paperclip connection createRuntime builds when ATOM_PAPERCLIP_URL is set. */
export type Paperclip = { client: ReturnType<typeof createPaperclip>; tracker: ReturnType<typeof issueTracker> };

/** ADR-091: ATOM's task branches in the repositories Keshab granted; pushing one is his alone, asked from the window. */
export function createIslandGit(helpers: HelperStore, options: { worktrees?: string; projectFolders?: () => readonly string[] } = {}): IslandGit {
  const grantedRepos = () => repositoriesOf([...new Set((helpers?.list() ?? []).flatMap((h) => h.grants ?? []))]);
  const readableRepos = async () => {
    const granted = await grantedRepos();
    const folders = options.projectFolders?.() ?? [];
    // A subfolder project is not authority to read branch changes across its parent repository.
    const current = (folder: string) => (options.projectFolders?.() ?? []).includes(folder);
    const project = (await Promise.all(folders.map(async (folder) => {
      const [repo] = await repositoriesOf([folder]);
      try { return repo && current(folder) && realpathSync.native(folder) === repo ? repo : undefined; } catch { return undefined; }
    }))).filter((r): r is string => Boolean(r));
    return [...new Set([...granted, ...project])];
  };
  const allowedRepo = async (repo: string) => {
    if (!(await grantedRepos()).includes(repo)) throw new Error("That repository is not in a folder you granted.");
  };
  return {
    list: async () => {
      const branches = (await Promise.all((await readableRepos()).map((r) => zenoBranches(r, options.worktrees)))).flat();
      const pushAllowed = await grantedRepos();
      const stillAllowed = await readableRepos();
      return branches.filter((b) => stillAllowed.includes(b.repo)).map((b) => {
        const title = helpers.report(b.task)?.title ?? helpers.get(b.task)?.task.split("\n")[0]?.slice(0, 80);
        return { ...b, pushAllowed: pushAllowed.includes(b.repo), ...(title ? { title } : {}) };
      });
    },
    push: async (repo, branch) => {
      await allowedRepo(repo);
      const review = (await zenoBranches(repo, options.worktrees)).find((b) => b.branch === branch);
      if (review?.baseSource === "unavailable") throw new Error("The task comparison is unavailable. Repair or refresh the review before pushing.");
      const tree = await taskWorkingCopy(repo, branch, options.worktrees);
      if (tree && await workingCopyDirty(tree)) throw new Error("This task has uncommitted changes. Review and commit them explicitly in Terminal before pushing.");
      const task = helpers.get(Number(branch.split("-").at(-1)));
      if (task && (task.state === "running" || task.state === "queued")) throw new Error("Wait for this task to stop before pushing its branch.");
      await pushBranch(repo, branch);
    },
    diff: async (repo, branch) => {
      if (!(await readableRepos()).includes(repo)) throw new Error("That repository is no longer an active project or granted folder.");
      const result = await branchDiff(repo, branch, 200_000, options.worktrees);
      if (!(await readableRepos()).includes(repo)) throw new Error("Project access changed while Git was being read.");
      return result;
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
