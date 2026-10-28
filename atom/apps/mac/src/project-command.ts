import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { isInside, realish } from "@atom/helpers";
import { SECRET_SHAPES } from "./folder-run.ts";

const TOOLS: Record<string, { binary: string; flags: string; directory?: boolean }> = {
  pwd: { binary: "/bin/pwd", flags: "LP" },
  ls: { binary: "/bin/ls", flags: "lhdFp1Str", directory: true },
  cat: { binary: "/bin/cat", flags: "nbsvet" },
  wc: { binary: "/usr/bin/wc", flags: "lwcm" },
  head: { binary: "/usr/bin/head", flags: "" },
  tail: { binary: "/usr/bin/tail", flags: "" },
  grep: { binary: "/usr/bin/grep", flags: "nivFEclwx" },
};
export const PROJECT_INSPECTION_COMMANDS = Object.keys(TOOLS).join(", ");

/** Fixed executable/flags and canonical operands. Model arguments are never interpreted as shell syntax. */
export async function prepareProjectInspection(command: unknown, args: unknown, cwd: string): Promise<{
  argv: string[]; reads: { path: string; directory: boolean }[]; summary: string;
}> {
  if (typeof command !== "string" || !Object.hasOwn(TOOLS, command)) throw new Error(`Choose one inspection utility: ${PROJECT_INSPECTION_COMMANDS}.`);
  if (!Array.isArray(args) || args.length > 20 || args.some((a) => typeof a !== "string" || !a || /[\u0000-\u001f\u007f]/.test(a)) || args.join(" ").length > 8_000) throw new Error("Provide at most 20 nonempty plain arguments, with at most 8,000 characters in total.");
  if (SECRET_SHAPES.some((pattern) => pattern.test(args.join(" ")))) throw new Error("Command arguments containing secret-shaped data are not sent to a process.");
  const tool = TOOLS[command]!;
  const flags: string[] = [], operands: string[] = [];
  let ended = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (!ended && arg === "--") { ended = true; continue; }
    if (!ended && arg.startsWith("-")) {
      if ((command === "head" || command === "tail") && arg === "-n" && !flags.length) {
        const count = args[++i];
        if (typeof count !== "string" || !/^\d{1,3}$/.test(count) || Number(count) < 1 || Number(count) > 500) throw new Error("Use -n with a line count from 1 to 500.");
        flags.push(arg, count); continue;
      }
      if (arg.length < 2 || arg.length > 16 || [...arg.slice(1)].some((c) => !tool.flags.includes(c))) throw new Error("That option is not supported by project command inspection. Recursive/follow/watch/script options are unavailable.");
      flags.push(arg);
    } else { ended = true; operands.push(arg); }
  }
  const pattern = command === "grep" ? operands.shift() : undefined;
  if (command === "grep" && (!pattern || pattern.length > 300)) throw new Error("Grep needs one literal/regular-expression pattern of at most 300 characters, followed by file paths.");
  if (command === "pwd") {
    if (operands.length) throw new Error("Pwd takes no path arguments.");
    return { argv: [tool.binary, ...flags], reads: [{ path: realish(cwd), directory: true }], summary: "pwd" };
  }
  if (!operands.length && command === "ls") operands.push(".");
  if (!operands.length || operands.length > 8) throw new Error("Provide one to eight project paths. Reading stdin is unavailable.");
  const root = realish(cwd);
  const reads: { path: string; directory: boolean }[] = [];
  for (const operand of operands) {
    const path = realish(resolve(root, operand));
    if (!isInside(root, path)) throw new Error("Inspection paths must stay inside this task's project folder.");
    const metadata = await stat(path);
    const directory = metadata.isDirectory();
    if (!(metadata.isFile() || (tool.directory && directory))) throw new Error("Use regular project files, or a directory with ls.");
    if (metadata.isFile() && metadata.size > 1024 * 1024) throw new Error("Project inspection files must be at most 1 MiB.");
    reads.push({ path, directory });
  }
  const argv = [tool.binary, ...flags, "--", ...(pattern ? [pattern] : []), ...reads.map((r) => r.path)];
  return { argv, reads, summary: argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ") };
}
