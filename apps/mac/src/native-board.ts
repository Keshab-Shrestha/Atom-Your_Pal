import { withRoleNotice, type HelperStore, type ReportInput } from "@atom/helpers";
import { redact, tokensOf, toolCallRecorder } from "@atom/llm-gateway";

/**
 * ADR-110 (Phase N2): the Board rows of one chat's sub-agents, from its Claude Code session. The safety gate makes the
 * job row when it allows an Agent call (it needs the id for the worktree); this links it to Claude Code's task, keeps
 * its step, its tool calls, its report and failure text (all redacted, ADR-099) and its token use, and writes the report when the agent stops.
 * Keshab, 2026-10-14 item 3: the report is plain text: the agent's last message; the title is the Agent call's
 * description; the sources are the web addresses in the text. Logs ids and states only, never text.
 */

export type BoardStore = Pick<HelperStore, "get" | "step" | "finish" | "fail" | "stop" | "recordToolCall" | "addUsage" | "linkNativeTask" | "list">;

export interface BoardRecorder {
  /** The gate made a job for this Agent call (its tool_use_id). */
  opened(toolUseId: string, job: number, description: string): void;
  /** Every SDK message of the session. */
  onEvent(message: Record<string, any>): void;
  /** SubagentStart and SubagentStop hooks for the session. */
  hooks: Record<string, unknown>;
  /** The job a sub-agent works on, from its agent_id (and type, until the two are linked). */
  jobOfAgent(agentId: string, agentType?: string): number | undefined;
  /** Claude Code's task id of a job of this chat, while it runs. */
  taskOf(job: number): string | undefined;
  /** Jobs of this chat that still run. */
  running(): number[];
}

export const TITLE_CHARS = 80;
export const SUMMARY_CHARS = 160;
const URL_PATTERN = /https?:\/\/[^\s<>()"'\]]+/g;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A sub-agent's last message as a Board report (Keshab, 2026-10-14 item 3). */
export function reportFrom(text: string, description: string, role: string): ReportInput {
  const body = text.trim();
  const first = body.split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? "";
  const urls = [...new Set((body.match(URL_PATTERN) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))];
  const sources = urls.map((url) => {
    try {
      return { title: new URL(url).hostname, url };
    } catch {
      return { title: url, url };
    }
  });
  return withRoleNotice(role, { title: cut(description.trim() || first || "Report", TITLE_CHARS), summary: cut(first, SUMMARY_CHARS), body: body || "(no report)", sources });
}

export function boardRecorder(
  helpers: BoardStore,
  chatId: string,
  options: {
    /** After a sub-agent stops (its report is kept): commit a worktree, free the browser. */
    onEnd?(job: number): void | Promise<void>;
    log?(event: string, fields: Record<string, unknown>): void;
  } = {},
): BoardRecorder {
  const byCall = new Map<string, { job: number; description: string }>(); // Agent tool_use_id
  const taskOfJob = new Map<number, string>();
  const jobOfTask = new Map<string, number>();
  const jobOfAgentId = new Map<string, number>();
  const metered = new Set<number>(); // jobs whose usage came per message: their AgentOutput is not counted again
  const ended = new Set<number>();
  const timelines = new Map<number, ReturnType<typeof toolCallRecorder>>();
  const log = (event: string, fields: Record<string, unknown>) => {
    try {
      options.log?.(event, { chatId, ...fields });
    } catch {
      // the log is a help
    }
  };
  const safe = (f: () => void) => {
    try {
      f();
    } catch {
      // a Board row is a help, never a reason to break the session (a job Keshab deleted, a finished one)
    }
  };
  const helperOf = (job: number) => helpers.get(job)?.helper;
  const roleOf = (job: number) => {
    const helper = helperOf(job);
    return helpers.list().find((h) => h.id === helper)?.role ?? "";
  };

  /** The job of a message from inside a sub-agent: its parent_tool_use_id is the Agent call's id. */
  const jobOfParent = (parent: unknown) => (typeof parent === "string" ? byCall.get(parent)?.job : undefined);

  const timeline = (job: number) => {
    let t = timelines.get(job);
    if (!t) {
      t = toolCallRecorder((event) => helpers.recordToolCall(job, event), () => helperOf(job));
      timelines.set(job, t);
    }
    return t;
  };

  const end = (job: number, outcome: { report?: string; failed?: string; stopped?: boolean }) => {
    if (ended.has(job)) return;
    const row = helpers.get(job);
    if (!row || row.state !== "running") return void ended.add(job);
    ended.add(job);
    const description = [...byCall.values()].find((c) => c.job === job)?.description ?? "";
    // Unlinked first: a stop written below must not try to stop the ended task again.
    const task = taskOfJob.get(job);
    if (task) jobOfTask.delete(task);
    taskOfJob.delete(job);
    safe(() => {
      if (outcome.stopped) helpers.stop(job);
      else if (outcome.failed !== undefined) helpers.fail(job, redact(outcome.failed) || "The agent stopped with an error.");
      else helpers.finish(job, reportFrom(redact(outcome.report ?? ""), description, roleOf(job)));
    });
    log("agent.end", { job, state: outcome.stopped ? "stopped" : outcome.failed !== undefined ? "failed" : "done" });
    timelines.delete(job);
    void Promise.resolve()
      .then(() => options.onEnd?.(job))
      .catch(() => log("agent.end_failed", { job }));
  };

  const usage = (job: number, model: unknown, u: unknown) => {
    const tokens = tokensOf({ usage: u });
    if (!tokens) return;
    const { costUsd: _, cacheTtl, ...counts } = tokens;
    safe(() => void helpers.addUsage({ source: "job", helper: helperOf(job), job, model: typeof model === "string" ? model : "unknown", chatId, ...counts, ...(cacheTtl ? { cacheTtl } : {}) }));
  };

  const onSystem = (m: Record<string, any>) => {
    if (m.subtype === "task_started" && typeof m.tool_use_id === "string" && typeof m.task_id === "string") {
      const call = byCall.get(m.tool_use_id);
      if (!call) return;
      taskOfJob.set(call.job, m.task_id);
      jobOfTask.set(m.task_id, call.job);
      safe(() => helpers.linkNativeTask(call.job, m.task_id));
    } else if (m.subtype === "task_progress" && typeof m.task_id === "string") {
      const job = jobOfTask.get(m.task_id);
      const step = typeof m.summary === "string" && m.summary ? m.summary : typeof m.last_tool_name === "string" ? `Using ${m.last_tool_name}` : undefined;
      if (job !== undefined && step) safe(() => void helpers.step(job, cut(redact(step), 120)));
    } else if (m.subtype === "task_notification" && typeof m.task_id === "string") {
      const job = jobOfTask.get(m.task_id);
      if (job === undefined) return;
      // The report comes from SubagentStop; this is the backstop when that hook did not run.
      if (m.status === "stopped") end(job, { stopped: true });
      else if (m.status === "failed") end(job, { failed: typeof m.summary === "string" ? m.summary : "" });
      else end(job, { report: typeof m.summary === "string" ? m.summary : "" });
    }
  };

  const onBlocks = (m: Record<string, any>) => {
    const job = jobOfParent(m.parent_tool_use_id);
    const content = m.message?.content;
    if (job === undefined) {
      // An Agent call that failed before its task started (no task_started): its job fails too.
      if (m.type === "user" && Array.isArray(content)) {
        for (const b of content) {
          const call = b?.type === "tool_result" && b.is_error === true ? byCall.get(String(b.tool_use_id)) : undefined;
          if (call && !taskOfJob.has(call.job)) end(call.job, { failed: typeof b.content === "string" ? b.content.slice(0, 300) : "The agent could not start." });
        }
      }
      // The Agent call's own result: a finished foreground agent carries its usage (AgentOutput).
      const r = m.tool_use_result;
      if (m.type === "user" && r && typeof r === "object" && r.status === "completed" && typeof r.agentId === "string") {
        const call = Array.isArray(content) ? content.find((b: Record<string, unknown>) => b?.type === "tool_result") : undefined;
        const own = call ? byCall.get(String(call.tool_use_id))?.job : undefined;
        if (own !== undefined && !metered.has(own)) usage(own, r.resolvedModel, r.usage);
      }
      return;
    }
    if (m.type === "assistant" && m.message?.usage) {
      metered.add(job);
      usage(job, m.message.model, m.message.usage);
    }
    if (!Array.isArray(content)) return;
    const t = timeline(job);
    for (const block of content) {
      if (block?.type === "tool_use") t.started(block, m.parent_tool_use_id);
      else if (block?.type === "tool_result") t.ended(block, m.parent_tool_use_id);
    }
  };

  const jobOfAgent = (agentId: string, agentType?: string): number | undefined => {
    const known = jobOfAgentId.get(agentId) ?? jobOfTask.get(agentId); // Claude Code's task id of an agent is its agent id
    if (known !== undefined) return jobOfAgentId.set(agentId, known), known;
    if (!agentType) return undefined;
    // ponytail: unlinked yet (the hook ran before task_started reached us): the oldest running job of that worker here.
    const linked = new Set(jobOfAgentId.values());
    const open = [...byCall.values()].map((c) => c.job).find((j) => !linked.has(j) && !ended.has(j) && helperOf(j) === agentType);
    if (open !== undefined) jobOfAgentId.set(agentId, open);
    return open;
  };

  const hook = (f: (input: Record<string, any>) => void) => [
    {
      hooks: [
        async (input: Record<string, any>) => {
          try {
            f(input);
          } catch {
            // never block a sub-agent over a Board row
          }
          return {};
        },
      ],
    },
  ];

  return {
    opened(toolUseId, job, description) {
      byCall.set(toolUseId, { job, description });
    },
    onEvent(message) {
      try {
        if (message.type === "system") onSystem(message);
        else if (message.type === "assistant" || message.type === "user") onBlocks(message);
      } catch {
        // never break the session over a Board row
      }
    },
    hooks: {
      SubagentStart: hook((input) => void jobOfAgent(String(input.agent_id), String(input.agent_type))),
      SubagentStop: hook((input) => {
        const job = jobOfAgent(String(input.agent_id), String(input.agent_type));
        if (job !== undefined) end(job, { report: typeof input.last_assistant_message === "string" ? input.last_assistant_message : "" });
      }),
    },
    jobOfAgent,
    taskOf: (job) => taskOfJob.get(job),
    running: () => [...byCall.values()].map((c) => c.job).filter((j) => !ended.has(j)),
  };
}
