import { randomUUID } from "node:crypto";
import type { ProjectFiles } from "@atom/contracts";
import { TOOL_SERVER, MAX_PROJECT_FILE_CALLS } from "@atom/llm-gateway";

/**
 * ADR-110: the permission gate of a native chat session's main thread. `allowedTools` is empty, so every tool call
 * comes here twice: the PreToolUse hook (decided before Claude Code's own rules, so no read-only tool skips it) and
 * canUseTool. Both use one decision, counted once per call id.
 *
 * - ATOM's tools (the `atom` server) and ToolSearch: allowed; ATOM's tool engine keeps its own approvals.
 * - Any tool outside the chat's set: denied. Bash, Write and Edit are never in a main thread's set.
 * - Read, Glob, Grep (project chat, ADR-107): the project's read check, at most MAX_PROJECT_FILE_CALLS per answer.
 */

const READ_TOOLS = ["Read", "Glob", "Grep"];

export interface NativeScope {
  /** Claude Code's own tools of this chat's main thread. */
  tools: readonly string[];
  /** A project chat's read access; undefined: no file reads. */
  files?: ProjectFiles;
}

type Verdict = { allow: true; input: Record<string, unknown> } | { allow: false; message: string };

export interface NativeGate {
  canUseTool: (name: string, input: Record<string, unknown>, extra?: { toolUseID?: string }) => Promise<Record<string, unknown>>;
  hooks: Record<string, unknown>;
  /** A new answer starts: the file-read count starts again, with the project's read access as it is now. */
  newAnswer(files?: ProjectFiles): void;
}

export function nativeGate(scope: NativeScope): NativeGate {
  let files = scope.files;
  let fileCalls = new Map<string, string | undefined>();

  const decide = async (name: string, input: Record<string, unknown>, id: string): Promise<Verdict> => {
    if (name.startsWith(`mcp__${TOOL_SERVER}__`) || name === "ToolSearch") return { allow: true, input };
    if (!scope.tools.includes(name)) {
      return { allow: false, message: `${name} is not available in this chat. Hand file changes and multi-step work to a worker with the delegate tool.` };
    }
    if (!READ_TOOLS.includes(name)) return { allow: true, input };
    if (!files) return { allow: false, message: "This chat has no file access now. Answer from the chat." };
    if (!fileCalls.has(id) && fileCalls.size >= MAX_PROJECT_FILE_CALLS) {
      return { allow: false, message: `That is the limit of ${MAX_PROJECT_FILE_CALLS} file reads for one answer. Answer now with what you have, and say what you did not read.` };
    }
    if (!fileCalls.has(id)) fileCalls.set(id, await files.check(name, input));
    const problem = fileCalls.get(id);
    return problem ? { allow: false, message: problem } : { allow: true, input: files.prepare?.(name, input) ?? input };
  };

  return {
    canUseTool: async (name, input, extra) => {
      const v = await decide(name, input, extra?.toolUseID ?? randomUUID());
      return v.allow ? { behavior: "allow", updatedInput: v.input } : { behavior: "deny", message: v.message };
    },
    hooks: {
      PreToolUse: [
        {
          // ponytail: every tool of every thread. P2 (sub-agents) must scope this to the main thread (no agent_id).
          hooks: [
            async (hook: Record<string, any>, toolUseID: string | undefined) => {
              const input = hook.tool_input && typeof hook.tool_input === "object" ? (hook.tool_input as Record<string, unknown>) : {};
              const v = await decide(String(hook.tool_name), input, toolUseID ?? hook.tool_use_id ?? randomUUID());
              return v.allow
                ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: v.input } }
                : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: v.message } };
            },
          ],
        },
      ],
    },
    newAnswer(next) {
      files = next;
      fileCalls = new Map();
    },
  };
}
