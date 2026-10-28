import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const checkedPrograms = new Set<string>();
export const PROJECT_COMMAND_TIMEOUT_MS = 30_000;
export const PROJECT_COMMAND_OUTPUT_BYTES = 32 * 1024;
type CommandOptions = { program: string; cwd: string; argv: string[]; signal: AbortSignal; allowed(): boolean };

/** Only the host passes argv here, after its utility/path/plan checks. No model or login request is made. */
export function runCodexProjectInspection(options: CommandOptions) {
  return runCodexCommand(options);
}

/** Only a disposable checked copy is writable. Never pass the real task folder as cwd/baseline. */
export function runCodexShellPreview(options: Omit<CommandOptions, "argv" | "cwd"> & { work: string; before: string; sourceRoot: string; command: string; checkScratch(path: string): Promise<boolean> }) {
  const script = 'ulimit -f 16384 || exit 125; /bin/bash --noprofile --norc -c "$1"; status=$?; printf "\\n[Preview command exit: %s]\\n" "$status"; /usr/bin/diff -ruN -- "$2" "$PWD"; delta=$?; if [ "$delta" -gt 1 ]; then exit 125; fi; exit "$status"';
  return runCodexCommand({ ...options, cwd: options.work, argv: ["/bin/bash", "--noprofile", "--norc", "-c", script, "atom-shell-preview", options.command, options.before] }, { before: options.before, sourceRoot: options.sourceRoot, checkScratch: options.checkScratch });
}

async function runCodexCommand(options: CommandOptions, preview?: { before: string; sourceRoot: string; checkScratch(path: string): Promise<boolean> }): Promise<{ text: string; isError: boolean; exitCode?: number | null }> {
  if (process.platform !== "darwin") return { text: "Project command inspection currently requires macOS.", isError: true };
  const allowed = () => { try { return !options.signal.aborted && options.allowed(); } catch { return false; } };
  const [base, root] = await Promise.all([realpath(tmpdir()), realpath(options.cwd)]);
  const before = preview ? await realpath(preview.before) : undefined;
  const source = preview ? await realpath(preview.sourceRoot) : undefined;
  if (root === "/" || /[*?\[\]{}]/.test(root)) return { text: "This project path cannot be represented by the inspection sandbox's exact-root policy.", isError: true };
  if (base === root || base.startsWith(root + sep)) return { text: "The command scratch folder must be outside the project.", isError: true };
  if (preview && (!before || !source || [before, source].some((p) => p === "/" || /[*?\[\]{}]/.test(p)) || before === root || source === root || source === before || root.startsWith(before + sep) || before.startsWith(root + sep) || base === source || base.startsWith(source + sep) || root.startsWith(source + sep) || before.startsWith(source + sep) || source.startsWith(root + sep) || source.startsWith(before + sep))) return { text: "Preview inputs must be separate from the real project and working copy.", isError: true };
  const scratch = await mkdtemp(join(base, "atom-command-"));
  let active: ReturnType<typeof spawn> | undefined;
  try {
    const home = join(scratch, "home"), cache = join(scratch, "codex"), temp = join(scratch, "tmp");
    await Promise.all([home, cache, temp].map((path) => mkdir(path, { mode: 0o700 })));
    // No user shell startup files, Codex config/login, proxy variables, credentials or environment secrets.
    const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, CODEX_HOME: cache, TMPDIR: temp, LANG: "en_US.UTF-8" };
    options.signal.throwIfAborted();
    if (!allowed()) return { text: "Project command inspection is no longer allowed for this task.", isError: true };
    if (!checkedPrograms.has(options.program)) {
      const help = await run(options.program, ["sandbox", "--help"], { cwd: scratch, env, timeout: 3_000, maxBuffer: 32 * 1024, signal: options.signal });
      if (!["--permission-profile", "--include-managed-config", "--cd"].every((flag) => help.stdout.includes(flag))) return { text: "This Codex version does not advertise the required sandbox profile controls. No command ran.", isError: true };
      checkedPrograms.add(options.program);
    }
    options.signal.throwIfAborted();
    if (!allowed()) return { text: "Project command inspection is no longer allowed for this task.", isError: true };
    const profile = preview ? "atom_project_preview" : "atom_project_inspection";
    const rules: Record<string, string> = { "/": "deny", ":minimal": "read", [root]: preview ? "write" : "read", [scratch]: "write", [join(root, "**", ".*")]: "deny" };
    if (before && source) { rules[before] = "read"; rules[source] = "deny"; }
    const filesystem = Object.entries(rules)
      .map(([path, access]) => `${JSON.stringify(path)}=${JSON.stringify(access)}`).join(",");
    const args = ["sandbox", "--include-managed-config", "--permission-profile", profile, "--cd", scratch,
      "-c", `permissions.${profile}.filesystem={${filesystem}}`,
      "-c", `permissions.${profile}.network.enabled=false`,
      "-c", `permissions.${profile}.network.dangerously_allow_all_unix_sockets=false`,
      "-c", `permissions.${profile}.network.unix_sockets={}`,
      "-c", `projects.${JSON.stringify(scratch)}.trust_level="untrusted"`,
      "--", "/bin/bash", "--noprofile", "--norc", "-c", 'ulimit -t 20 || exit 125; cd -- "$1" || exit 125; shift; exec "$@"', "atom-project-inspection", root, ...options.argv];
    return await new Promise((resolve) => {
      let bytes = 0, stopped = false, timedOut = false, truncated = false, spawnFailed = false, revoked = false, settled = false, resourceExceeded = false, scanning = false;
      let drain: ReturnType<typeof setTimeout> | undefined;
      const chunks: Buffer[] = [];
      const child = spawn(options.program, args, { cwd: scratch, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
      active = child;
      const kill = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } } };
      const finish = (code: number | null, unconfirmed = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); clearTimeout(drain); clearInterval(access); clearInterval(resources);
        options.signal.removeEventListener("abort", stop);
        kill(); child.stdout?.destroy(); child.stderr?.destroy(); active = undefined;
        if (stopped) return resolve({ text: "The task was stopped; no command output was returned.", isError: true });
        if (spawnFailed) return resolve({ text: "The Codex sandbox could not start. No unsandboxed fallback ran.", isError: true });
        if (revoked || !allowed()) return resolve({ text: "Project access changed; command output was withheld.", isError: true });
        if (resourceExceeded) return resolve({ text: "Preview runtime scratch exceeded its budget or contained unsupported entries; output was withheld.", isError: true });
        if (unconfirmed) return resolve({ text: "Command process/output cleanup could not be confirmed; output was withheld and no success is claimed.", isError: true });
        const text = Buffer.concat(chunks).toString("utf8");
        const note = timedOut ? "Command stopped at its 30-second limit." : truncated ? "Command stopped at its 32 KiB output limit." : `Command exited with code ${code ?? "unknown"}.`;
        resolve({ text: `${note}\n${text || "(no output)"}`, isError: code !== 0 || timedOut || truncated, exitCode: timedOut || truncated ? null : code });
      };
      const end = () => { if (settled) return; kill(); if (!drain) drain = setTimeout(() => finish(null, true), 1_000); };
      const stop = () => { stopped = true; end(); };
      const timer = setTimeout(() => { timedOut = true; end(); }, PROJECT_COMMAND_TIMEOUT_MS);
      const access = setInterval(() => { if (!allowed()) { revoked = true; end(); } }, 200);
      const resources = preview ? setInterval(() => {
        if (scanning || settled) return;
        scanning = true;
        void preview.checkScratch(scratch).catch(() => false).then((ok) => { if (!settled && !ok) { resourceExceeded = true; end(); } }).finally(() => { scanning = false; });
      }, 200) : undefined;
      options.signal.addEventListener("abort", stop, { once: true });
      if (options.signal.aborted) stop();
      const output = (chunk: Buffer) => {
        const remaining = Math.max(0, PROJECT_COMMAND_OUTPUT_BYTES - bytes);
        if (remaining) chunks.push(chunk.subarray(0, remaining));
        bytes += chunk.length;
        if (bytes > PROJECT_COMMAND_OUTPUT_BYTES) { truncated = true; end(); }
      };
      child.stdout!.on("data", output); child.stderr!.on("data", output);
      child.once("error", () => { spawnFailed = true; end(); });
      child.once("exit", () => end()); // Close inherited pipes even when the leader exits before its descendants.
      child.once("close", (code) => finish(code));
    });
  } catch {
    return { text: options.signal.aborted ? "The task was stopped; no command output was returned." : "The required Codex sandbox could not be prepared. No unsandboxed fallback ran.", isError: true };
  } finally {
    if (active?.pid) { try { process.kill(-active.pid, "SIGKILL"); } catch { active.kill("SIGKILL"); } }
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleaned = await Promise.race([
      rm(scratch, { recursive: true, force: true }).then(() => true, () => false),
      new Promise<boolean>((resolve) => { cleanupTimer = setTimeout(() => resolve(false), 3_000); }),
    ]);
    clearTimeout(cleanupTimer);
    if (!cleaned) return { text: "Command scratch cleanup could not be confirmed; output was withheld and temporary files may remain.", isError: true };
  }
}
