// ADR-173: host-owned creation facts beside the worktrees, outside every worker's writable tree.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCH_PATTERN } from "./branch-prefix.ts";

export interface TaskBranchBase { repo: string; branch: string; sha: string; ref?: string }
const pathOf = (worktrees: string, repo: string, branch: string) => join(worktrees, ".branch-bases", createHash("sha256").update(JSON.stringify([repo, branch])).digest("hex") + ".json");
const valid = (v: TaskBranchBase) => BRANCH_PATTERN.test(v.branch) && /^[a-f0-9]{40,64}$/.test(v.sha)
  && (v.ref === undefined || /^refs\/heads\/[^\s\x00-\x1f]+$/.test(v.ref));

/** Called only after creating a NEW branch at this exact commit. Never backfill an existing branch. */
export function saveTaskBranchBase(worktrees: string, base: TaskBranchBase): void {
  if (!valid(base)) throw new Error("The task branch starting point could not be recorded.");
  mkdirSync(join(worktrees, ".branch-bases"), { recursive: true, mode: 0o700 });
  // Exclusive write: a reused task must never silently change its historical starting point.
  writeFileSync(pathOf(worktrees, base.repo, base.branch), JSON.stringify(base), { flag: "wx", mode: 0o600 });
}

export function readTaskBranchBase(worktrees: string | undefined, repo: string, branch: string): TaskBranchBase | undefined {
  if (!worktrees) return undefined;
  const path = pathOf(worktrees, repo, branch);
  let stat;
  try { stat = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192) throw new Error("The saved task branch starting point is unavailable.");
  const base = JSON.parse(readFileSync(path, "utf8")) as TaskBranchBase;
  if (!base || base.repo !== repo || base.branch !== branch || !valid(base)) throw new Error("The saved task branch starting point is invalid.");
  return base;
}
