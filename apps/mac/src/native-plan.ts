import type { ToolRunner } from "@atom/contracts";
import { HANDOFF_WORDS, PLAN_PARALLEL, parseWorkPlan, planTable, portionContext, readyPortions, type HelperStore, type HelperView, type PlanView, type PortionResult } from "@atom/helpers";
import type { Tool } from "@atom/tool-engine";
import { nativeMembers } from "./native-agents.ts";

/**
 * ADR-111 (slices C and D): work plans in a native chat. The main agent makes one plan with `plan_work` and starts each
 * portion with the Agent tool, description "P<n>". The safety gate calls `claim`: code checks the order and builds the
 * portion's prompt (its stored task, the goal, and the reports of the portions it waited for), so the main agent never
 * copies a report from one agent to the next. Logs ids only.
 */

export type PlanStore = Pick<HelperStore, "addPlan" | "latestPlan" | "list" | "report" | "get">;

/** The portion number in an Agent call's description: "P2", "P2: price the kits". */
const TAG = /^\s*P(\d{1,2})\b/;

export type Claim =
  | { kind: "none" }
  | { kind: "deny"; message: string }
  | { kind: "ok"; plan: number; n: number; task: string; prompt: string };

export interface PlanBook {
  /** `plan_work` and `plan_status` for this chat. */
  tools(): Tool[];
  /** The gate's check of an Agent call. `none`: not a plan call (the gate handles it as before). */
  claim(description: string, member: HelperView): Claim;
  /** The portion has its Board job now (or the call was refused after the claim). */
  release(plan: number, n: number): void;
}

const nameOf = (store: PlanStore) => (id: string) => store.list().find((h) => h.id === id)?.name ?? id;

/** One line a portion, for the main agent: the ids it needs for the Agent tool. */
function statusText(view: PlanView, ready: number[]): string {
  const lines = view.portions.map((p) => `P${p.n} ${p.name} (${p.agent})${p.after.length ? ` after ${p.after.map((a) => `P${a}`).join(", ")}` : ""}: ${p.state}`);
  const tail = view.complete
    ? "The plan is complete. Answer the user in one to three short sentences from the reports."
    : view.stuck
      ? "The plan is stuck: a portion failed or was stopped. Tell the user which one and what they can do."
      : ready.length
        ? `Ready now: ${ready.map((n) => `P${n}`).join(", ")}. Start each with the Agent tool: description "P<n>", the agent's id as subagent_type, prompt "go". At most ${PLAN_PARALLEL} portions run at once.`
        : "Nothing to start now: wait for the running portions to report.";
  return `${view.goal}\n${lines.join("\n")}\n${tail}`;
}

export function planBook(store: PlanStore, chatId: string, log?: (event: string, fields: Record<string, unknown>) => void): PlanBook {
  const reserved = new Set<string>(); // "<plan>.<n>" claimed by an Agent call that has no job yet
  const key = (plan: number, n: number) => `${plan}.${n}`;
  const note = (event: string, fields: Record<string, unknown>) => {
    try {
      log?.(event, { chatId, ...fields });
    } catch {
      // the log is a help
    }
  };

  /** Portions that can start now: waiting, every portion they wait for done, none claimed. */
  const ready = (view: PlanView): number[] => {
    const done = new Set(view.portions.filter((p) => p.state === "done").map((p) => p.n));
    const started = new Set(view.portions.filter((p) => p.state !== "waiting").map((p) => p.n));
    for (const k of reserved) {
      const [plan, n] = k.split(".").map(Number);
      if (plan === view.id) started.add(n!);
    }
    return readyPortions({ goal: view.goal, portions: view.portions }, done, started);
  };

  const planWork: Tool = {
    spec: {
      name: "plan_work",
      description:
        "Plan a big job that has several parts. goal: one short sentence for the whole job. portions: 1 to 6 objects " +
        "{agent, task, after}: agent is an agent's name from your agent list, task says exactly what that agent finds or " +
        "makes, after lists the numbers of earlier portions it needs (omit when none). ATOM checks the plan, keeps the " +
        "order and passes each agent the reports it needs. Then start the ready portions with the Agent tool.",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string", description: "The whole job in one short sentence" },
          portions: { type: "array", description: "1 to 6 objects {agent, task, after}" },
        },
        required: ["goal", "portions"],
      },
    },
    run(input) {
      const members = nativeMembers(store.list()).map((h) => ({ id: h.id, name: h.name, available: h.available, role: h.role }));
      const plan = parseWorkPlan(input, members);
      const view = store.addPlan(chatId, plan);
      note("plan.made", { plan: view.id, portions: view.portions.length });
      return `${planTable(plan, nameOf(store))}\n\n${statusText(view, ready(view))}`;
    },
  };

  const planStatus: Tool = {
    spec: {
      name: "plan_status",
      description: "Where the plan of this chat stands: each portion's state, and which portions can start now.",
      inputSchema: { type: "object", properties: {} },
    },
    run() {
      const view = store.latestPlan(chatId);
      return view ? statusText(view, ready(view)) : "There is no plan in this chat. Make one with plan_work.";
    },
  };

  return {
    tools: () => [planWork, planStatus],

    claim(description, member) {
      const tag = TAG.exec(description);
      if (!tag) return { kind: "none" };
      const n = Number(tag[1]);
      const view = store.latestPlan(chatId);
      if (!view) return { kind: "deny", message: "There is no plan in this chat. Make one with plan_work, or start the agent without a P number." };
      const portion = view.portions.find((p) => p.n === n);
      if (!portion) return { kind: "deny", message: `The plan has no portion P${n}. It has P1 to P${view.portions.length}.` };
      if (portion.agent !== member.id) return { kind: "deny", message: `Portion P${n} belongs to ${portion.name}: use subagent_type "${portion.agent}".` };
      const stopped = view.portions.filter((p) => portion.after.includes(p.n) && (p.state === "failed" || p.state === "stopped" || p.state === "blocked"));
      if (stopped.length) return { kind: "deny", message: `Portion P${n} cannot start: ${stopped.map((p) => `P${p.n}`).join(", ")} did not finish. Tell the user.` };
      if (portion.state !== "waiting" || reserved.has(key(view.id, n))) return { kind: "deny", message: `Portion P${n} has started already (${portion.state === "waiting" ? "starting" : portion.state}).` };
      const waiting = view.portions.filter((p) => portion.after.includes(p.n) && p.state !== "done");
      if (waiting.length) return { kind: "deny", message: `Portion P${n} waits for ${waiting.map((p) => `P${p.n}`).join(", ")}. Wait for their reports, then start it.` };
      const running = view.portions.filter((p) => p.state === "running").length + [...reserved].filter((k) => k.startsWith(`${view.id}.`)).length;
      if (running >= PLAN_PARALLEL) return { kind: "deny", message: `${running} portions run now (the limit is ${PLAN_PARALLEL}). Wait for one to report, then start P${n}.` };
      const results: PortionResult[] = portion.after.flatMap((a) => {
        const job = view.portions.find((p) => p.n === a)?.job;
        const report = job === undefined ? undefined : store.report(job);
        return report ? [{ n: a, agent: view.portions.find((p) => p.n === a)!.agent, title: report.title, summary: report.summary, body: report.body }] : [];
      });
      const prompt = `${portion.task}\n\n${portionContext({ goal: view.goal, portions: view.portions }, portion, results, nameOf(store))}`;
      reserved.add(key(view.id, n));
      note("plan.claim", { plan: view.id, portion: n, words: HANDOFF_WORDS });
      return { kind: "ok", plan: view.id, n, task: portion.task, prompt };
    },

    release(plan, n) {
      reserved.delete(key(plan, n));
    },
  };
}

/** The chat's tools plus the plan tools of its plan book: one runner for the session. */
export function withPlanTools(base: ToolRunner, book: PlanBook): ToolRunner {
  const extra = new Map(book.tools().map((t) => [t.spec.name, t]));
  return {
    specs: () => [...base.specs(), ...[...extra.values()].map((t) => t.spec)],
    async run(call, signal) {
      const tool = extra.get(call.name);
      if (!tool) return base.run(call, signal);
      try {
        const out = await tool.run(call.input, signal);
        return { callId: call.id, content: out };
      } catch (error) {
        return { callId: call.id, content: `"${call.name}" failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    },
  };
}
