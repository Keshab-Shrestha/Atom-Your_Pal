import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileCheckManifest, readFilePreview, taskFileChecks, type FileCheckResult, type TaskFileCheck } from "@atom/helpers";

export interface VerificationWorkspace { root: string; dev: number; ino: number }
/** Pin the host-selected workspace before worker dispatch, not after a worker has returned. */
export function captureVerificationWorkspace(root: string): VerificationWorkspace | undefined {
  try {
    const canonical = realpathSync.native(root), info = lstatSync(canonical);
    if (info.isDirectory()) return { root: canonical, dev: info.dev, ino: info.ino };
  } catch { /* Unavailable identity must never fall back to another folder. */ }
}

/** Host readback only: fixed workspace, existing Read policy, complete bounded UTF-8 snapshots; no project code runs. */
export async function verifyTaskFiles(options: {
  workspace: VerificationWorkspace;
  checks: readonly TaskFileCheck[];
  signal: AbortSignal;
  allowed(): boolean;
  readAllowed(path: string, signal: AbortSignal): Promise<boolean>;
}): Promise<{ manifestDigest: string; workspaceDigest: string; checks: FileCheckResult[] }> {
  const checks = taskFileChecks(options.checks)!;
  const root = options.workspace.root;
  const manifestDigest = fileCheckManifest(checks);
  const workspaceDigest = createHash("sha256").update(root).digest("hex");
  const results: FileCheckResult[] = [];
  const intact = () => {
    try {
      const current = lstatSync(root);
      return current.isDirectory() && realpathSync.native(root) === root
        && current.dev === options.workspace.dev && current.ino === options.workspace.ino;
    } catch { return false; }
  };
  const permit = (path: string) => new Promise<boolean>((done) => {
    let settled = false;
    const finish = (ok: boolean) => { if (settled) return; settled = true; options.signal.removeEventListener("abort", abort); done(ok); };
    const abort = () => finish(false);
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) return abort();
    Promise.resolve().then(() => options.allowed() && intact() ? options.readAllowed(path, options.signal) : false).then(finish, () => finish(false));
  });
  for (const [index, check] of checks.entries()) {
    const n = index + 1;
    const unavailable = (reason: FileCheckResult["reason"]) => results.push({ n, state: "unavailable", reason });
    if (options.signal.aborted) { unavailable("cancelled"); continue; }
    if (!options.allowed() || !intact()) { unavailable("scope_changed"); continue; }
    const path = resolve(root, check.path);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { unavailable("scope_changed"); continue; }
    if (!await permit(path)) { unavailable(options.signal.aborted ? "cancelled" : "policy_refused"); continue; }
    if (options.signal.aborted || !options.allowed() || !intact()) { unavailable(options.signal.aborted ? "cancelled" : "scope_changed"); continue; }
    try {
      // Every ancestor must be an ordinary directory. A missing/linked ancestor is not proof of file absence.
      const parts = check.path.split("/");
      let ancestor = root;
      for (const part of parts.slice(0, -1)) { ancestor = resolve(ancestor, part); if (!lstatSync(ancestor).isDirectory() || realpathSync.native(ancestor) !== ancestor) throw new Error(); }
      try { lstatSync(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        results.push({ n, state: "not-matched", reason: "file_missing" }); continue;
      }
      const snapshot = readFilePreview(path); // Rejects links, hard links, oversized/binary/control text and changes during read.
      const matched = check.kind === "exists" || (check.kind === "contains" ? snapshot.text.includes(check.expected!) : snapshot.hash === check.expected);
      results.push({ n, state: matched ? "matched" : "not-matched", reason: check.kind === "exists" ? "file_present"
        : check.kind === "contains" ? matched ? "literal_present" : "literal_missing" : matched ? "digest_matches" : "digest_mismatch", snapshot: snapshot.hash });
    } catch { unavailable("file_unreadable"); }
  }
  if (options.signal.aborted || !options.allowed() || !intact()) {
    // No positive results survive Stop, revoked project authority or workspace replacement during collection.
    return { manifestDigest, workspaceDigest, checks: checks.map((_, index): FileCheckResult => ({ n: index + 1, state: "unavailable", reason: options.signal.aborted ? "cancelled" : "scope_changed" })) };
  }
  return { manifestDigest, workspaceDigest, checks: results };
}
