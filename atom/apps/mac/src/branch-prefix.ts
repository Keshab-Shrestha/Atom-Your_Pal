// ADR-105: ATOM's task branches are `atom/task-<id>`. Branches made under the old name, `zeno/task-<id>`, are still
// read and used, never renamed. One place holds both names.

export const BRANCH_PREFIX = "atom/task-";
export const LEGACY_BRANCH_PREFIX = "zeno/task-";

/** A task branch under either name; group 1 is the task id. */
export const BRANCH_PATTERN = /^(?:atom|zeno)\/task-(\d+)$/;
/** The same for a command from the island: the id is at most 9 digits. */
export const BRANCH_COMMAND_PATTERN = /^(?:atom|zeno)\/task-\d{1,9}$/;
/** The ref folders to list. */
export const BRANCH_REF_FOLDERS = ["refs/heads/atom/", "refs/heads/zeno/"] as const;
/** What to tell a person a branch name looks like. */
export const BRANCH_SHAPE = "atom/task-<id>";

export const taskBranch = (taskId: number, legacy = false): string => `${legacy ? LEGACY_BRANCH_PREFIX : BRANCH_PREFIX}${taskId}`;
