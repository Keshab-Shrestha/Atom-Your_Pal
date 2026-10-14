// ADR-098 items 1 and 2: ATOM on Telegram. Keshab talks to ATOM, reads and answers Needs you, lists tasks and reads
// reports. ATOM sends what needs him, finished goals and the results of schedules marked "Send result to Telegram".
// Every button maps to a command the ATOM window already has. Logs command names, button kinds and counts only.

import type { HelperStore, Job } from "@atom/helpers";
import type { Logger } from "@atom/shared";
import type { ApprovalAsk } from "./computer-bridge.ts";
import { testsOf } from "./island-helpers.ts";
import type { TaskSteering } from "./task-steering.ts";
import { startTelegram, type Button, type TelegramClient, type TelegramInput } from "./telegram.ts";

/** The chat in the chats store that holds the Telegram conversation (the ATOM window lists it as "Telegram"). */
export const TELEGRAM_CHAT = "telegram";
/** How much of a report one message shows. */
const REPORT_CHARS = 3500;
const NEEDS_SHOWN = 10;
const TASKS_SHOWN = 20;
/** Store changes come in bursts: Needs you is looked at once they settle. */
const SETTLE_MS = 1_000;

const HELP = [
  "I am ATOM, your assistant. Send a message to talk to me.",
  "/needs: what waits for your answer",
  "/tasks: tasks that run or wait to run",
  "/report <number>: a task's report",
  "/steer <number> <text>: send a message to a task",
  "/interrupt <number>: stop a task's current step",
  "/help: this list",
].join("\n");

export interface TelegramBotOptions {
  token: string;
  chatId: string;
  log: Logger;
  /** One ATOM chat turn in the Telegram chat; resolves to ATOM's answer. */
  ask(text: string): Promise<string>;
  helpers?: HelperStore;
  /** Why a queued task waits (a budget or the plan's limit), or undefined. */
  held(job: Job): string | undefined;
  /** ATOM's questions (Pal's approval card). */
  approvals: { pending(): ApprovalAsk[]; answer(id: string, approved: boolean): void; onAsk(listener: (ask: ApprovalAsk) => void): () => void };
  describe(error: unknown): string;
  /** ADR-098 item 3: the window's steer and interrupt. Absent: the commands answer "Steering is off." */
  steering?: Pick<TaskSteering, "steer" | "interrupt">;
}

export interface TelegramBot {
  /** Settings' "Send to Telegram": what ATOM sends by itself. Replies to Keshab always go. */
  setPush(on: boolean): void;
  /**
   * ADR-110 (N3): a message ATOM writes by itself. `pushed` false: a later reply in the Telegram chat (an agent
   * reported), which always goes. `pushed` true: a routine's result, which follows "Send to Telegram".
   */
  send(text: string, pushed: boolean): void;
  stop(): void;
}

/** One thing that waits for Keshab, with its buttons. `push`: sent by itself when new (failed tasks show in /needs only). */
export interface Need {
  key: string;
  push: boolean;
  text: string;
  buttons?: Button[][];
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const titleOf = (job: Job) => cut(flat(job.title ?? job.task), 80);
/** The window's line for a test run (same words as the island's `TestRunSummary.line`), or "" when there are no results. */
function testLine(store: HelperStore, kind: "soul" | "skill", id: number): string {
  const t = testsOf(store, kind, id);
  if (!t) return "";
  if (t.running > 0) return "\nTest cases: running…";
  const parts = [`${t.better} better`, `${t.same} same`, `${t.worse} worse`, `${t.failed} failed`].filter((p) => !p.startsWith("0 "));
  if (t.notRun > 0) parts.push(`${t.notRun} not run`);
  return parts.length ? `\nTest cases: ${parts.join(", ")}` : "";
}
const yesNo = (yes: string, no: string, data: string): Button[][] => [[{ text: yes, data: `${data}:1` }, { text: no, data: `${data}:0` }]];

/** Everything waiting, in the window's order: questions, plans, proposals, skill drafts and edits, held tasks, failures. */
export function needsYou(store: HelperStore | undefined, held: (job: Job) => string | undefined, asks: readonly ApprovalAsk[]): Need[] {
  const questions: Need[] = asks.map((a) => ({ key: `ask-${a.id}`, push: true, text: `ATOM asks: ${a.summary}\n${a.reason}`, buttons: yesNo("Allow", "Decline", `a:${a.id}`) }));
  if (!store) return questions;
  const team = store.list();
  const owners = [...team.map((h) => ({ name: h.name, jobs: h.jobs })), ...store.managers().map((m) => ({ name: m.name, jobs: m.jobs }))];
  const plans: Need[] = [];
  const holds: Need[] = [];
  const failures: Need[] = [];
  for (const owner of owners) {
    for (const job of owner.jobs) {
      if (job.state === "queued" && job.planStatus === "awaiting") {
        plans.push({ key: `plan-${job.id}`, push: true, text: `${owner.name}'s plan for #${job.id} ${titleOf(job)}:\n${job.planSummary ?? "A plan waits for your OK."}`, buttons: yesNo("Approve", "Reject", `p:${job.id}`) });
        continue;
      }
      const reason = job.state === "queued" ? held(job) : undefined;
      if (reason) holds.push({ key: `held-${job.id}`, push: true, text: `${owner.name}'s task #${job.id} ${titleOf(job)} waits: ${reason}` });
      else if (job.state === "failed") {
        failures.push({ key: `failed-${job.id}`, push: false, text: `${owner.name}'s task #${job.id} ${titleOf(job)} failed: ${job.error ?? "It ended with a problem."}`, buttons: [[{ text: "Retry", data: `r:${job.id}` }]] });
      }
    }
  }
  const proposals: Need[] = team.flatMap((h) =>
    h.proposals
      .filter((p) => p.state === "pending")
      .map((p) => ({ key: `proposal-${p.id}`, push: true, text: `Tinker suggests a new ${p.field} for ${h.name}:\n${cut(p.text, 600)}\nWhy: ${cut(p.reason, 300)}${testLine(store, "soul", p.id)}`, buttons: yesNo("Accept", "Reject", `s:${p.id}`) })),
  );
  const drafts: Need[] = store
    .skillDrafts()
    .filter((d) => d.state === "pending")
    .map((d) => ({ key: `skill-draft-${d.id}`, push: true, text: `Tinker drafted a skill: ${d.name}\n${cut(d.description, 300)}`, buttons: yesNo("Approve", "Reject", `d:${d.id}`) }));
  const edits: Need[] = store
    .skillEdits()
    .filter((e) => e.state === "pending")
    .map((e) => ({ key: `skill-edit-${e.id}`, push: true, text: `Tinker suggests an edit to the ${e.skill} skill.\nWhy: ${cut(e.reason, 300)}${testLine(store, "skill", e.id)}`, buttons: yesNo("Accept", "Reject", `e:${e.id}`) }));
  // B3.5: a skill from the hub waits. Telegram shows its name, source, short sha and the flag kinds, never its text.
  const hub: Need[] = store.skillHubPending().map((p) => {
    const kinds = [...new Set(p.flags.map((f) => f.kind))];
    const head = p.kind === "update" ? `A newer version of the ${p.name} skill is ready` : `Skill from the hub: ${p.name}`;
    return { key: `skill-hub-${p.id}`, push: true, text: `${head}\n${p.repo} @ ${p.sha.slice(0, 7)}\nFlags: ${kinds.length ? kinds.join(", ") : "none"}\nRead it in the ATOM window before you approve.`, buttons: yesNo("Approve", "Reject", `h:${p.id}`) };
  });
  return [...questions, ...plans, ...proposals, ...drafts, ...edits, ...hub, ...holds, ...failures.sort((a, b) => b.key.localeCompare(a.key, undefined, { numeric: true }))];
}

/**
 * ADR-098: does what one Needs you button says (`kind:id[:1|0]`, as in `needsYou`) and returns the short answer. The bot
 * and the local API (item 5) both use it. Throws what the store throws.
 */
export function answerNeed(data: string, store: HelperStore | undefined, approvals: Pick<TelegramBotOptions["approvals"], "pending" | "answer">): string {
  const [kind = "", id = "", yes] = data.split(":");
  const ok = yes === "1";
  const n = Number(id);
  if (kind === "a") {
    if (!approvals.pending().some((a) => a.id === id)) return "That question has already ended.";
    approvals.answer(id, ok);
    return ok ? "Allowed." : "Declined.";
  }
  if (!store) return "The team is not available.";
  if (kind === "p") {
    if (ok) store.approvePlan(n);
    else store.rejectPlan(n);
    return ok ? "Plan approved." : "Plan rejected.";
  }
  if (kind === "s") {
    if (ok) store.acceptProposal(n);
    else store.rejectProposal(n);
    return ok ? "Change accepted." : "Change rejected.";
  }
  if (kind === "d") {
    if (ok) store.approveSkillDraft(n);
    else store.rejectSkillDraft(n);
    return ok ? "Skill approved." : "Skill rejected.";
  }
  if (kind === "e") {
    if (ok) store.acceptSkillEdit(n);
    else store.rejectSkillEdit(n);
    return ok ? "Edit accepted." : "Edit rejected.";
  }
  if (kind === "h") {
    if (ok) store.approveSkillHub(n);
    else store.rejectSkillHub(n);
    return ok ? "Skill installed." : "Skill rejected.";
  }
  if (kind === "r") {
    store.retry(n);
    return "Started again.";
  }
  return "That button is out of date.";
}

/** Starts the bot. Off unless the runtime calls this (both .env values set). */
export function startTelegramBot(options: TelegramBotOptions): TelegramBot {
  const { log, helpers: store, held, approvals, describe } = options;
  let push = true;
  // One ATOM turn at a time: the Core answers one request at a time.
  let turns: Promise<void> = Promise.resolve();
  const client: TelegramClient = startTelegram({ token: options.token, chatId: options.chatId, log, onInput: (input) => take(input) });

  function take(input: TelegramInput) {
    if (input.kind === "button") return press(input.data, input.queryId);
    const text = input.text.trim();
    if (!text) return void client.send("I read text only.");
    if (text.startsWith("/")) return command(text);
    turns = turns.then(() => talk(text));
  }

  async function talk(text: string) {
    const started = Date.now();
    try {
      const answer = await options.ask(text);
      log.info("telegram.turn", { ok: true, ms: Date.now() - started });
      await client.send(answer);
    } catch (error) {
      log.warn("telegram.turn", { ok: false, ms: Date.now() - started });
      await client.send(`ATOM could not answer: ${describe(error)}`);
    }
  }

  function command(text: string) {
    const [head = "", ...rest] = text.split(/\s+/);
    const name = head.slice(1).split("@")[0]!.toLowerCase();
    log.info("telegram.command", { name: ["needs", "tasks", "report", "steer", "interrupt", "help", "start"].includes(name) ? name : "unknown" });
    if (name === "needs") return void sendNeeds();
    if (name === "tasks") return void client.send(tasksText());
    if (name === "report") return void client.send(reportText(Number(rest[0]?.replace(/^#/, ""))));
    if (name === "steer") return void steer(rest);
    if (name === "interrupt") return void interrupt(rest);
    if (name === "help" || name === "start") return void client.send(HELP);
    void client.send(`I do not know that command.\n\n${HELP}`);
  }

  const taskNumber = (word: string | undefined) => {
    const id = Number(word?.replace(/^#/, ""));
    return Number.isInteger(id) && id >= 1 ? id : undefined;
  };

  function steer(args: string[]) {
    if (!options.steering) return void client.send("Steering is off.");
    const id = taskNumber(args[0]);
    if (!id) return void client.send("Send /steer, a task number and your message, for example /steer 12 use the shorter plan.");
    try {
      const how = options.steering.steer(id, args.slice(1).join(" "));
      void client.send(how === "live" ? `Sent to task #${id} now.` : `Kept for task #${id}. It runs after this step.`);
    } catch (error) {
      void client.send(describe(error));
    }
  }

  async function interrupt(args: string[]) {
    if (!options.steering) return void client.send("Steering is off.");
    const id = taskNumber(args[0]);
    if (!id) return void client.send("Send /interrupt and a task number, for example /interrupt 12.");
    try {
      await options.steering.interrupt(id);
      await client.send(`Task #${id} stopped. It waits for your message.`);
    } catch (error) {
      await client.send(describe(error));
    }
  }

  async function sendNeeds() {
    const items = needsYou(store, held, approvals.pending());
    if (!items.length) return client.send("Nothing waits for you.");
    for (const item of items.slice(0, NEEDS_SHOWN)) await client.send(item.text, item.buttons);
    if (items.length > NEEDS_SHOWN) await client.send(`${items.length - NEEDS_SHOWN} more wait in the ATOM window.`);
  }

  function tasksText(): string {
    if (!store) return "The team is not available.";
    const owners = [...store.list(), ...store.managers()];
    const lines = (state: Job["state"]) =>
      owners.flatMap((o) => o.jobs.filter((j) => j.state === state).map((j) => `#${j.id} ${o.name}: ${titleOf(j)}${state === "running" && j.step ? ` (${cut(flat(j.step), 60)})` : ""}`));
    const running = lines("running");
    const queued = lines("queued");
    if (!running.length && !queued.length) return "No task runs or waits to run.";
    const all = [...(running.length ? ["Running:", ...running] : []), ...(queued.length ? [running.length ? "\nWaiting:" : "Waiting:", ...queued] : [])];
    return all.length > TASKS_SHOWN ? [...all.slice(0, TASKS_SHOWN), `… and ${all.length - TASKS_SHOWN} more in the ATOM window.`].join("\n") : all.join("\n");
  }

  function reportText(id: number): string {
    if (!store) return "The team is not available.";
    if (!Number.isInteger(id) || id < 1) return "Send /report and a task number, for example /report 12.";
    const report = store.report(id);
    if (!report) return `Task #${id} has no report.`;
    const whole = `${report.title}\n\n${report.summary}\n\n${report.body}`;
    return whole.length > REPORT_CHARS ? `${whole.slice(0, REPORT_CHARS - 1)}…\n\nThe rest is in the ATOM window.` : whole;
  }

  function press(data: string, queryId: string) {
    const kind = data.split(":")[0] ?? "";
    let said: string;
    try {
      said = answerNeed(data, store, approvals);
      log.info("telegram.button", { kind });
    } catch (error) {
      log.info("telegram.button", { kind, ok: false });
      said = describe(error);
    }
    void client.answer(queryId, said);
  }

  // Push: a new Needs you item, a finished goal, a schedule's result. Keys seen last time are not sent again.
  let known = new Set(needsYou(store, held, approvals.pending()).map((n) => n.key));
  let timer: NodeJS.Timeout | undefined;
  const check = () => {
    timer = undefined;
    const now = needsYou(store, held, approvals.pending());
    const fresh = now.filter((n) => n.push && !known.has(n.key));
    known = new Set(now.map((n) => n.key));
    if (!push || !fresh.length) return;
    log.info("telegram.push", { kind: "needs", count: fresh.length });
    void (async () => {
      for (const item of fresh) await client.send(item.text, item.buttons);
    })();
  };
  const soon = () => {
    timer ??= setTimeout(check, SETTLE_MS);
  };
  const stopAsks = approvals.onAsk(soon);
  const stopStore = store?.onChange((change) => {
    if (change.action === "step" || change.action === "usage" || change.action === "spend") return;
    soon();
    if (!push) return;
    if (change.action === "goal" && change.ended) sendGoal(change.goal);
    if (change.action === "job" && (change.state === "done" || change.state === "failed" || change.state === "stopped")) sendRoutineResult(change.job);
  });

  function sendGoal(id: number) {
    const goal = store?.goal(id);
    if (!goal) return;
    log.info("telegram.push", { kind: "goal" });
    const report = goal.report;
    void client.send(report ? `Goal done: ${report.title}\n\n${report.summary}` : `A goal ended with no report: ${cut(flat(goal.text), 200)}`);
  }

  function sendRoutineResult(jobId: number) {
    const routine = store?.list().flatMap((h) => h.routines).find((r) => r.lastTaskId === jobId);
    if (!store || !routine?.notifyTelegram) return;
    const job = store.get(jobId);
    if (!job) return;
    log.info("telegram.push", { kind: "routine" });
    if (job.state !== "done") return void client.send(`Scheduled task #${jobId} ${titleOf(job)} ${job.state === "failed" ? `failed: ${job.error ?? "It ended with a problem."}` : "was stopped."}`);
    void client.send(`Scheduled result #${jobId}\n${reportText(jobId)}`);
  }

  return {
    send(text, pushed) {
      if ((pushed && !push) || !text.trim()) return;
      log.info("telegram.push", { kind: pushed ? "routine" : "reply" });
      void client.send(text);
    },
    setPush(on) {
      if (on !== push) log.info("telegram.push_setting", { on });
      push = on;
    },
    stop() {
      if (timer) clearTimeout(timer);
      stopAsks();
      stopStore?.();
      client.stop();
    },
  };
}
