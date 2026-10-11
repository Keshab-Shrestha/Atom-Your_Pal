// ADR-082, Task 3.11: what a worker in granted folders may touch. Every file tool's path is checked against the run's
// folders; every command is classified in code; risky ones ask Keshab on Pal's approval card (no answer is a no).

import { homedir } from "node:os";
import { join } from "node:path";
import { WRITE_TOOLS, classifyCommand, pathProblem, realish, toolPaths } from "@zeno/helpers";

/** Never readable by sandboxed commands: keys, tokens and other apps' secrets. */
export function denyRead(home = homedir()): string[] {
  return [".ssh", ".aws", ".gnupg", ".config", ".netrc", ".npmrc", ".docker", ".kube", ".azure", ".claude", ".codex", ".hermes", "Library/Keychains", "Library/Cookies"].map(
    (p) => join(home, p),
  );
}

export interface FolderCheckOptions {
  /** The run's folders: the work folder and the worker's other grants. */
  roots: string[];
  cwd: string;
  /** The worker's name, for the approval card. */
  name: string;
  approve(request: { summary: string; reason: string }): Promise<boolean>;
  /** For the log: the tool and the verdict, never paths or command text. */
  onCheck?(event: { tool: string; verdict: "allowed" | "refused" | "asked" | "declined" }): void;
}

const oneLine = (s: string, max: number) => (s.replace(/\s+/g, " ").trim().length > max ? `${s.replace(/\s+/g, " ").trim().slice(0, max - 1)}…` : s.replace(/\s+/g, " ").trim());

/** The `check` a file run's tool calls go through: why a call is refused, or undefined to allow it. */
export function folderCheck(options: FolderCheckOptions) {
  const roots = options.roots.map((r) => realish(r));
  const say = (tool: string, verdict: "allowed" | "refused" | "asked" | "declined") => options.onCheck?.({ tool, verdict });
  return async (name: string, input: Record<string, unknown>): Promise<string | undefined> => {
    if (name === "Bash") {
      const command = typeof input.command === "string" ? input.command : "";
      const verdict = classifyCommand(command);
      if (verdict.verdict === "refuse") return say(name, "refused"), verdict.reason;
      if (verdict.verdict === "ask") {
        say(name, "asked");
        const ok = await options.approve({ summary: `${options.name} wants to run: ${oneLine(command, 120)}`, reason: `This command ${verdict.reason}.` });
        if (!ok) return say(name, "declined"), "Keshab did not allow this command. Do the job without it, or say in the report what is needed.";
      }
      return say(name, "allowed"), undefined;
    }
    for (const p of toolPaths(name, input)) {
      const problem = pathProblem(roots, options.cwd, p, WRITE_TOOLS.includes(name));
      if (problem) return say(name, "refused"), problem;
    }
    return say(name, "allowed"), undefined;
  };
}
