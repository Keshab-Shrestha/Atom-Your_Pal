// ARK's task branches are `ark/task-<id>` (2026-11-01). Branches made under the old names, `atom/task-<id>` (ADR-105)
// and `zeno/task-<id>` before it, are still read and used, never renamed. One place holds all three names.

export const BRANCH_PREFIX = "ark/task-";
export const LEGACY_BRANCH_PREFIXES = ["atom/task-", "zeno/task-"] as const;

/** A task branch under any of the names; group 1 is the task id. */
export const BRANCH_PATTERN = /^(?:ark|atom|zeno)\/task-(\d+)$/;
/** The same for a command from the island: the id is at most 9 digits. */
export const BRANCH_COMMAND_PATTERN = /^(?:ark|atom|zeno)\/task-\d{1,9}$/;
/** The ref folders to list. */
export const BRANCH_REF_FOLDERS = ["refs/heads/ark/", "refs/heads/atom/", "refs/heads/zeno/"] as const;
/** What to tell a person a branch name looks like. */
export const BRANCH_SHAPE = "ark/task-<id>";

export const taskBranch = (taskId: number): string => `${BRANCH_PREFIX}${taskId}`;
/** The task's branch names under the old names, newest name first. */
export const legacyTaskBranches = (taskId: number): string[] => LEGACY_BRANCH_PREFIXES.map((prefix) => `${prefix}${taskId}`);
