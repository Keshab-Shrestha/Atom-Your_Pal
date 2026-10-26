import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { relative, resolve } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { previewText, readFilePreview } from "@atom/helpers";
import type { RevisionObservation } from "@atom/helpers";
const run = promisify(execFile);
const LIMIT = 256 * 1024;
const flags = ["--literal-pathspecs", "-c", "safe.bareRepository=explicit", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

/** No shell, inherited Git routing, interactive prompt, optional index write, diff driver or working-tree filter. */
async function command(root: string, args: string[], overrides: string[] = [], signal?: AbortSignal): Promise<Buffer> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && !["SSH_ASKPASS", "SSH_ASKPASS_REQUIRE", "GCM_INTERACTIVE"].includes(key)));
  return (await run("git", ["-C", root, ...flags, ...overrides, ...args], { timeout: 8000, maxBuffer: LIMIT,
    encoding: "buffer", signal, env: { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", SSH_ASKPASS_REQUIRE: "never", GCM_INTERACTIVE: "never", GIT_PAGER: "cat", GIT_EXTERNAL_DIFF: "" } })).stdout;
}
const text = async (root: string, args: string[], overrides?: string[]) => (await command(root, args, overrides)).toString("utf8").trim();
const optional = (root: string, args: string[]) => text(root, args).catch(() => "");
export type GitSection = "staged" | "unstaged" | "untracked" | "conflict";
export interface GitReviewFile { path: string; section: GitSection; status: string; original?: string }
export interface GitWorkspace {
  branch: string; head: string; upstream?: string; ahead?: number; behind?: number;
  files: GitReviewFile[]; limited: boolean; filtersDisabled: boolean;
}
export interface GitReview { path: string; section: GitSection; before: string; after: string; beforeLabel: string; afterLabel: string; base?: string; note: string }

async function context(root: string, signal?: AbortSignal) {
  const repo = (await command(root, ["rev-parse", "--show-toplevel"], [], signal)).toString("utf8").trim();
  if (realpathSync(repo) !== repo || (root !== repo && !root.startsWith(repo + "/"))) throw new Error("This project is not inside an available Git working tree.");
  // Ask for names only: values can be executable commands or credentials and never leave Git.
  let keys: string[] = [];
  try { keys = (await command(root, ["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"], [], signal)).toString("utf8").split("\0").filter(Boolean); }
  catch (error) { if ((error as { code?: unknown }).code !== 1) throw error; }
  const overrides: string[] = [];
  for (const key of keys) {
    if (/[\x00-\x20\x7f]/.test(key) || !/^filter\..+\.(clean|smudge|process|required)$/i.test(key)) throw new Error("This repository has an unsupported filter configuration.");
    overrides.push("-c", `${key}=${key.endsWith(".required") ? "false" : ""}`);
  }
  return { repo, prefix: root === repo ? "" : relative(repo, root) + "/", overrides, filtersDisabled: keys.length > 0 };
}

/** Best-effort source identity for host receipts. Never certifies dirty/ignored files or a test environment. */
export async function taskRevisionObservation(root: string, signal: AbortSignal): Promise<RevisionObservation> {
  try {
    const ctx = await context(root, signal);
    const [headBytes, status] = await Promise.all([
      command(root, ["rev-parse", "--verify", "HEAD"], ctx.overrides, signal),
      command(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all", "--", "."], ctx.overrides, signal),
    ]);
    const head = headBytes.toString("utf8").trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head) || signal.aborted) return { state: "unavailable" };
    return { state: status.length ? "dirty" : "clean", head };
  } catch { return { state: "unavailable" }; }
}

/** Git porcelain v1 -z paths are repository-relative. Rename source and destination are separate NUL records. */
export function gitFiles(raw: string, prefix: string, allowed: (path: string) => boolean): { files: GitReviewFile[]; limited: boolean } {
  const records = raw.split("\0"); const files: GitReviewFile[] = [];
  let limited = false, bytes = 0;
  for (let i = 0; i < records.length; i++) {
    const row = records[i]!;
    if (!row) continue;
    if (row.length < 4 || row[2] !== " ") throw new Error("Git returned an unsupported status record.");
    const xy = row.slice(0, 2), name = row.slice(3);
    const source = /[RC]/.test(xy) ? records[++i] : undefined;
    if (!name.startsWith(prefix) || source !== undefined && !source.startsWith(prefix)) continue;
    const path = name.slice(prefix.length), original = source?.slice(prefix.length);
    if (!allowed(path) || original !== undefined && !allowed(original)) continue;
    const sections: GitSection[] = xy === "??" ? ["untracked"] : ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(xy) ? ["conflict"]
      : [...(xy[0] !== " " && xy[0] !== "?" ? ["staged" as const] : []), ...(xy[1] !== " " && xy[1] !== "?" ? ["unstaged" as const] : [])];
    for (const section of sections) {
      const file = { path, section, status: xy, ...(original ? { original } : {}) };
      bytes += Buffer.byteLength(JSON.stringify(file));
      if (files.length >= 200 || bytes > 128 * 1024) { limited = true; break; }
      files.push(file);
    }
    if (limited) break;
  }
  return { files, limited };
}

export async function gitWorkspace(root: string, allowed: (path: string) => boolean): Promise<GitWorkspace> {
  const ctx = await context(root);
  const [status, head, branch, upstream] = await Promise.all([
    command(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all", "--", "."], ctx.overrides),
    optional(root, ["rev-parse", "--verify", "HEAD"]), optional(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]), optional(root, ["rev-parse", "--symbolic-full-name", "@{upstream}"]),
  ]);
  let counts: { ahead: number; behind: number } | undefined;
  if (head && upstream) {
    const value = await text(root, ["rev-list", "--left-right", "--count", `${head}...${upstream}`]);
    const parts = value.split(/\s+/).map(Number);
    if (parts.length === 2 && parts.every(Number.isSafeInteger)) counts = { ahead: parts[0]!, behind: parts[1]! };
  }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(status);
  return { branch: branch || (head ? `Detached ${head.slice(0, 8)}` : "Unborn branch"), head, ...(upstream ? { upstream: upstream.replace(/^refs\/(heads|remotes)\//, "") } : {}), ...counts, ...gitFiles(raw, ctx.prefix, allowed), filtersDisabled: ctx.filtersDisabled };
}

/** Task working-copy reads use the same disabled filters/hooks and bounded environment as project Git review. */
export async function workingCopyDirty(root: string): Promise<boolean> {
  const ctx = await context(root);
  return (await command(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=all"], ctx.overrides)).length > 0;
}

export async function workingCopyDiff(root: string, base: string, stat = false): Promise<string> {
  if (!/^[a-f0-9]{40,64}$/.test(base)) throw new Error("The task starting commit is invalid.");
  const ctx = await context(root);
  const result = (await command(root, ["diff", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all", stat ? "--numstat" : "--no-color", base, "--"], ctx.overrides)).toString("utf8");
  return stat ? result.trim() : result;
}

/** Missing tracked files may be compared, but no existing ancestor may be a link. */
export function gitPathAvailable(root: string, path: string): boolean {
  let candidate = resolve(root, path);
  if (!candidate.startsWith(root + "/")) return false;
  while (candidate !== root) {
    try {
      const info = lstatSync(candidate);
      if (realpathSync(candidate) !== candidate) return false;
      return info.isDirectory() || info.isFile() && info.nlink === 1;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false; }
    candidate = resolve(candidate, "..");
  }
  return realpathSync(root) === root;
}

export async function gitFileReview(root: string, selected: GitReviewFile, allowed: (path: string) => boolean): Promise<GitReview> {
  const ctx = await context(root);
  if (!allowed(selected.path) || selected.original && !allowed(selected.original)) throw new Error("That Git path is unavailable or protected.");
  const repoPath = ctx.prefix + selected.path, oldPath = ctx.prefix + (selected.original ?? selected.path);
  const head = await optional(root, ["rev-parse", "--verify", "HEAD"]);
  const indexPath = selected.section === "unstaged" && /[RC]/.test(selected.status[1] ?? "") ? (selected.original ?? selected.path) : selected.path;
  const index = await command(root, ["ls-files", "--stage", "-z", "--", indexPath]);
  const entries = index.toString("utf8").split("\0").filter(Boolean).map((row) => {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) ([0-3])\t/.exec(row);
    if (!match || !["100644", "100755"].includes(match[1]!)) throw new Error("Submodules, links and unsupported Git entries cannot be previewed.");
    return { sha: match[2]!, stage: Number(match[3]) };
  });
  async function blob(sha: string | undefined) { return sha ? previewText(await command(root, ["cat-file", "blob", sha])) : ""; }
  async function committed() {
    if (!head) return "";
    const tree = await text(ctx.repo, ["ls-tree", "-z", "--full-tree", head, "--", oldPath]);
    if (!tree) return "";
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t/.exec(tree);
    if (!match) throw new Error("The committed entry is not a regular text file.");
    return blob(match[2]);
  }
  function disk() {
    const path = resolve(root, selected.path);
    try { lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
    return readFilePreview(path).text;
  }
  let before: string, after: string, base: string | undefined;
  let beforeLabel: string, afterLabel: string;
  if (selected.section === "conflict") {
    before = await blob(entries.find((e) => e.stage === 2)?.sha); after = await blob(entries.find((e) => e.stage === 3)?.sha);
    base = await blob(entries.find((e) => e.stage === 1)?.sha); beforeLabel = "Ours"; afterLabel = "Theirs";
  } else if (selected.section === "staged") {
    before = await committed(); after = await blob(entries.find((e) => e.stage === 0)?.sha); beforeLabel = "HEAD"; afterLabel = "Staged";
  } else {
    before = selected.section === "untracked" ? "" : await blob(entries.find((e) => e.stage === 0)?.sha);
    after = disk(); beforeLabel = selected.section === "untracked" ? "No tracked original" : "Index"; afterLabel = "Working file";
  }
  if (head !== await optional(root, ["rev-parse", "--verify", "HEAD"]) || !index.equals(await command(root, ["ls-files", "--stage", "-z", "--", indexPath])) || !allowed(selected.path)) throw new Error("The Git snapshot changed. Refresh before reviewing.");
  return { path: selected.path, section: selected.section, before, after, beforeLabel, afterLabel, ...(base === undefined ? {} : { base }), note: selected.section === "conflict" ? "Unmerged index stages, not a proposed resolution. Base is shown separately. No files or index entries are changed." : "Point-in-time raw text comparison. Refresh after editing. No Git state is changed." };
}
