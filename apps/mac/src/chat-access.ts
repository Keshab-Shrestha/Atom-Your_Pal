import { createHash } from "node:crypto";
import { isChatAccessMode, type ChatAccessMode } from "@atom/contracts";
import { redact } from "@atom/llm-gateway";

export type AccessApproval = (request: { summary: string; reason: string }, signal?: AbortSignal) => Promise<boolean>;
export interface ChatAccessPolicy {
  check(name: string, input: Record<string, unknown>, id: string, agent?: string, signal?: AbortSignal): Promise<string | undefined>;
  newAnswer(): void;
  fullAccess(signal?: AbortSignal): boolean;
}
// Closed list owned by ATOM. Unknown tools (including external MCP/browser tools) always ask.
const READ_ONLY = new Set(["Read", "Glob", "Grep", "WebFetch", "WebSearch", "ToolSearch", "Skill", "ExitPlanMode",
  "mcp__atom__current_time", "mcp__atom__weather", "mcp__atom__front_window", "mcp__atom__look_at_screen",
  "mcp__atom__calendar_events", "mcp__atom__reminders_list", "mcp__atom__timer_list", "mcp__atom__recall",
  "mcp__atom__search_chat_history", "mcp__atom__read_chat_history", "mcp__atom__ask_user"]);
export const CHAT_ONLY_NOTICE = "Chat only is enabled for this chat. Answer using the conversation and saved brief only. Do not use tools, read new files or screens, browse, run actions or delegate. Saved edit permissions are suspended, not removed.";
export const FULL_ACCESS_NOTICE = "Full access is enabled for this chat. Routine file overwrite, classified-command, worker-browser site-opening and already-granted plugin approvals are skipped by the host. Protected paths, kits, sandbox, cancellation, macOS permissions and external-content safeguards still apply. Plans, browser submissions/uploads/interactions, computer actions, shell previews and complete file reviews retain their approvals. This mode does not grant new tools, plugins, unrestricted shell or administrator access.";
export const FULL_ACCESS_CONFIRMATION = "Only this chat. Skip routine file overwrite, classified-command, worker-browser site-opening and already-granted plugin prompts. Plugins can act outside ATOM's file sandbox. Protected files, tool/worker limits, sandboxing, cancellation and macOS permissions still apply. Plans, browser submissions/uploads/interactions, computer actions, shell previews and complete file reviews still ask. External-content safeguards remain. Stays on after restart; new and forked chats use Saved permissions. You can switch back when this chat is idle.";
export const ASK_CHANGES_NOTICE = "Ask before changes is enabled. ATOM requires a fresh approval for each change-capable tool call, even when a saved file grant exists. Existing safety checks still apply.";

/** Additional per-call restriction; it never replaces a native/file/tool policy decision. */
export function chatAccessPolicy(mode: ChatAccessMode, current: () => ChatAccessMode, approve?: AccessApproval): ChatAccessPolicy {
  if (!isChatAccessMode(mode)) throw new Error("Invalid chat access mode.");
  const calls = new Map<string, { fingerprint: string; decision: Promise<string | undefined> }>();
  const stale = (signal?: AbortSignal) => signal?.aborted || current() !== mode;
  return {
    fullAccess(signal) { return mode === "full" && !stale(signal); },
    newAnswer() { for (const key of calls.keys()) if (key.startsWith("main:")) calls.delete(key); },
    async check(name, input, id, agent, signal) {
      if (stale(signal)) return "Stopped or chat access changed. No action is allowed from this request.";
      if (mode === "chat-only") return CHAT_ONLY_NOTICE;
      if (mode === "checked" || mode === "full" || READ_ONLY.has(name)) return undefined;
      const key = `${agent ?? "main"}:${id}`;
      const fingerprint = createHash("sha256").update(JSON.stringify([name, input])).digest("hex");
      const previous = calls.get(key);
      if (previous && previous.fingerprint !== fingerprint) return "The tool call changed after approval. Request a new call.";
      if (!previous) {
        if (calls.size >= 500) return "This session's approval budget is full. Finish its tasks and reopen the chat.";
        // Write/Edit and Agent can carry large bodies. Show the exact target plus an explicitly labelled preview.
        let details: unknown = input;
        if (name === "Write" || name === "Edit") {
          const path = input.file_path;
          if (typeof path !== "string" || path.length > 260) return "The file target cannot fit in the approval card. Use a shorter, explicit path.";
          details = { file_path: path, preview: String(name === "Write" ? input.content ?? "" : input.new_string ?? "").slice(0, 100), review: "Content preview only; approves this one captured file operation." };
        } else if (name === "Agent" || name === "ConsultWorker") {
          details = { worker: input.subagent_type, task: input.description, preview: String(input.prompt ?? "").slice(0, 100), review: "Task preview only; subsequent changes need their own approval." };
        }
        const reason = redact(JSON.stringify(details));
        if (reason.length > 480 || name.length > 80) return "This action is too large to display in an approval card. Split it into smaller explicit actions.";
        const decision = (async () => {
          if (!approve || stale(signal)) return "A fresh approval is required before this action.";
          try {
            const allowed = await approve({ summary: `Allow ${name.replace(/^mcp__atom__/, "")} once?`, reason: `Ask before changes: ${reason}` }, signal);
            return allowed && !stale(signal) ? undefined : "The action was declined, stopped or its access mode changed.";
          } catch { return "The approval could not be completed. No action was allowed."; }
        })();
        calls.set(key, { fingerprint, decision });
      }
      const refusal = await calls.get(key)!.decision;
      return stale(signal) ? "Stopped or chat access changed. No action was allowed." : refusal;
    },
  };
}
