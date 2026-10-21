import { spawn } from "node:child_process";
import { lstat, mkdir, opendir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { checkGrant } from "@atom/helpers";
import { cleanProjectName } from "@atom/memory";

export type ProjectSource = "folder" | "new" | "git" | "github";
export interface ProjectSourceRequest { type: "project.create"; request: string; source: ProjectSource; name: string; path: string; remote?: string }
export interface ProjectSourceResponse { type: "project.created"; request: string; ok: boolean; project?: string; error?: string; partial?: boolean }
export class ProjectSourceError extends Error {}
const GIT_CONFIG = ["-c", "core.hooksPath=/dev/null", "-c", "init.templateDir=", "-c", "credential.helper=", "-c", "core.askPass=/usr/bin/false", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "submodule.recurse=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "http.followRedirects=false"];

export function repositoryURL(source: "git" | "github", raw: string): string {
  let input = raw.trim();
  if (source === "github" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)) input = "https://github.com/" + input;
  let url: URL;
  try { url = new URL(input); } catch { throw new ProjectSourceError("Enter an HTTPS repository URL, or owner/repository for GitHub."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash
      || /[\x00-\x20\x7f]/.test(input) || /%0[ad]/i.test(input) || url.pathname === "/"
      || (source === "github" && (url.hostname !== "github.com" || url.port || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)))) {
    throw new ProjectSourceError("Use an HTTPS repository URL without credentials, query parameters or fragments. GitHub accepts owner/repository.");
  }
  return url.href.replace(/\/$/, "");
}

/** No shell, inherited Git config, credential helpers, prompts, hooks, templates or submodules. */
export async function runProjectGit(args: string[], cwd: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((accept, reject) => {
    const child = spawn("git", [...GIT_CONFIG, ...args], { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false",
      SSH_ASKPASS: "/usr/bin/false", GIT_LFS_SKIP_SMUDGE: "1",
    } });
    let bytes = 0, problem: Error | undefined, settled = false;
    const stop = (error: Error) => {
      problem ??= error;
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* already closed */ }
    };
    const aborted = () => stop(new ProjectSourceError("Project creation cancelled."));
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    const output = (data: Buffer) => { bytes += data.length; if (bytes > 128 * 1024) stop(new ProjectSourceError("Git exceeded its output budget.")); };
    child.stdout.on("data", output); child.stderr.on("data", output);
    const finish = (error?: Error) => {
      if (settled) return; settled = true; signal.removeEventListener("abort", aborted);
      if (error) reject(error); else accept();
    };
    child.once("error", () => finish(new ProjectSourceError("Git could not start. Install Git and try again.")));
    child.once("close", (code) => finish(problem ?? (code === 0 ? undefined : new ProjectSourceError("Git did not finish. Check the HTTPS repository and access. Credential prompts and private sign-in are not supported here."))));
  });
}

export interface ProjectSourceOptions {
  home: string;
  signal: AbortSignal;
  /** Checks limits/names before network/disk work, then registers through the existing project grant flow. */
  validate(name: string): void;
  register(name: string, path: string): { project: string } | { error: string };
  runGit?: typeof runProjectGit;
  limits?: { bytes: number; entries: number; ms: number };
}
async function sizeCheck(root: string, bytes: number, entries: number): Promise<void> {
  let total = 0, count = 0;
  const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
  const walk = async (path: string): Promise<void> => {
    let directory;
    try { directory = await opendir(path); } catch (error) { if (missing(error)) return; throw error; }
    try {
      for await (const entry of directory) {
        if (++count > entries) throw new ProjectSourceError("The repository exceeds the file-count budget.");
        const file = join(path, entry.name);
        let stat;
        try { stat = await lstat(file); } catch (error) { if (missing(error)) continue; throw error; }
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) await walk(file);
        else { total += stat.size; if (total > bytes) throw new ProjectSourceError("The repository exceeds the disk budget."); }
      }
    } catch (error) { if (!missing(error)) throw error; }
  };
  await walk(root);
}

/** Existing destinations are never overwritten; failure leaves an explicit partial folder for inspection. */
export async function createProjectSource(input: ProjectSourceRequest, options: ProjectSourceOptions): Promise<ProjectSourceResponse> {
  const response = (fields: Omit<ProjectSourceResponse, "type" | "request">): ProjectSourceResponse => ({ type: "project.created", request: input.request, ...fields });
  let created = false;
  const limits = options.limits ?? { bytes: 256 * 1024 * 1024, entries: 20_000, ms: 120_000 };
  const controller = new AbortController();
  let failure: ProjectSourceError | undefined;
  const abort = () => { failure ??= new ProjectSourceError("Project creation cancelled."); controller.abort(); };
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const timeout = setTimeout(() => { failure = new ProjectSourceError("Project creation timed out."); controller.abort(); }, limits.ms);
  let timer: ReturnType<typeof setInterval> | undefined, scanning: Promise<void> | undefined;
  try {
    controller.signal.throwIfAborted();
    const name = cleanProjectName(input.name);
    options.validate(name);
    if (!isAbsolute(input.path) || input.path !== resolve(input.path) || /[\x00-\x1f\x7f]/.test(input.path)) throw new ProjectSourceError("Choose an absolute destination without traversal or control characters.");
    if (input.source === "folder") {
      const path = checkGrant(input.path, options.home);
      controller.signal.throwIfAborted();
      const result = options.register(name, path);
      return response("error" in result ? { ok: false, error: result.error } : { ok: true, project: result.project });
    }
    const remote = input.source === "git" || input.source === "github" ? repositoryURL(input.source, input.remote ?? "") : undefined;
    const folder = basename(input.path), parent = await realpath(dirname(input.path)), home = await realpath(options.home);
    if (!folder || folder.startsWith(".") || /[\\/:\x00-\x1f\x7f]/.test(folder) || (parent === home && folder.toLowerCase() === "library")) throw new ProjectSourceError("Choose a normal, non-hidden project folder name.");
    if (parent !== home) checkGrant(parent, options.home);
    const parentStat = await lstat(parent), path = join(parent, folder);
    controller.signal.throwIfAborted();
    try { await mkdir(path); created = true; } catch { throw new ProjectSourceError("The destination already exists or cannot be created. Choose a new folder."); }
    const root = await lstat(path);
    const unchanged = async () => {
      const currentParent = await lstat(parent), current = await lstat(path);
      if (currentParent.dev !== parentStat.dev || currentParent.ino !== parentStat.ino || current.dev !== root.dev || current.ino !== root.ino
          || current.isSymbolicLink() || await realpath(path) !== path || checkGrant(path, options.home) !== path) {
        throw new ProjectSourceError("The destination changed during creation. Inspect it before trying again.");
      }
    };
    const scan = async () => { await unchanged(); await sizeCheck(path, limits.bytes, limits.entries); };
    await scan();
    timer = setInterval(() => {
      if (scanning) return;
      scanning = scan().catch((error: unknown) => {
        failure = error instanceof ProjectSourceError ? error : new ProjectSourceError("The destination could not be checked."); controller.abort();
      }).finally(() => { scanning = undefined; });
    }, 100);
    await (options.runGit ?? runProjectGit)(remote ? ["clone", "--quiet", "--depth=1", "--single-branch", "--no-tags", "--no-recurse-submodules", "--", remote, "."] : ["init", "--quiet", "--", "."], path, controller.signal);
    clearInterval(timer); timer = undefined;
    if (scanning) await scanning;
    controller.signal.throwIfAborted();
    await scan();
    controller.signal.throwIfAborted();
    const result = options.register(name, path);
    if ("error" in result) throw new ProjectSourceError(result.error);
    return response({ ok: true, project: result.project });
  } catch (error) {
    const message = failure?.message ?? (error instanceof ProjectSourceError ? error.message : error instanceof Error && ["ProjectError", "HelperError"].includes(error.name) ? error.message : "Project creation failed. Check the destination and try again.");
    return response({ ok: false, error: message + (created ? " A partial folder remains at the selected destination; inspect it before retrying." : ""), ...(created ? { partial: true } : {}) });
  } finally {
    if (timer) clearInterval(timer);
    clearTimeout(timeout); options.signal.removeEventListener("abort", abort);
    if (scanning) await scanning;
  }
}
