// ADR-098 items 1 and 2: ATOM on Telegram. Keshab talks to ATOM, reads and answers Needs you, lists tasks and reads
// reports. ATOM sends what needs him and the results of schedules marked "Send result to Telegram".
// Every button maps to a command the ATOM window already has. Logs command names, button kinds and counts only.

import type { HelperStore, Job } from "@atom/helpers";
import type { Logger } from "@atom/shared";
import type { ApprovalAsk } from "./computer-bridge.ts";
import { testsOf } from "./island-helpers.ts";
import type { TaskSteering } from "./native-entry.ts";
import { startTelegram, type Button, type TelegramClient, type TelegramInput } from "./telegram.ts";

/** The chat in the chats store that holds the Telegram conversation (the ATOM window lists it as "Telegram"). */
export const TELEGRAM_CHAT = "telegram";
/** How much of a report one message shows. */
const REPORT_CHARS = 3500;
const NEEDS_SHOWN = 10;
const TASKS_SHOWN = 20;
/** Store changes come in bursts: Needs you is looked at once they settle. */
const SETTLE_MS = 1_000;
const COMMAND = /^\/[A-Za-z_]+(?:@\w+)?(?=$|[\s.!?,:;])/;
/** One ATOM turn that has not answered after this long is given up on, so the next message is not stuck behind it (2026-10-16). */
export const TURN_TIMEOUT_MS = 10 * 60_000;
/** A Needs you push that failed (the network was down) is tried again after this long, up to PUSH_TRIES times. */
export const PUSH_RETRY_MS = 30_000;
const PUSH_TRIES = 6;

const HELP = [
  "I am ATOM, your assistant. Send a message to talk to me.",
  "/needs: what waits for your answer",
  "/tasks: tasks that run or wait to run",
  "/report <number>: a task's report",
  "/steer <number> <text>: send a message to a task",
  "/help: this list",
].join("\n");

export interface TelegramBotOptions {
  token: string;
  chatId: string;
  /** ATOM_TELEGRAM_USER_ID: the one person obeyed in the chat. Default: the chat id (a private chat). */
  userId?: string;
  log: Logger;
  /** One ATOM chat turn in the Telegram chat; resolves to ATOM's answer. */
  ask(text: string): Promise<string>;
  helpers?: HelperStore;
  /** ATOM's questions (Pal's approval card). */
  approvals: { pending(): ApprovalAsk[]; answer(id: string, approved: boolean): void; onAsk(listener: (ask: ApprovalAsk) => void): () => void };
  describe(error: unknown): string;
  /** ADR-098 item 3: the window's steer and interrupt. Absent: the commands answer "Steering is off." */
  steering?: Pick<TaskSteering, "steer" | "interrupt">;
  /** Skip what was sent while ATOM was closed and tell the user once (default true). Tests that replay updates as live turn it off. */
  skipBacklog?: boolean;
  /** How long one ATOM turn may take before the next message is served (ms). Default TURN_TIMEOUT_MS. */
  turnTimeoutMs?: number;
  /** How long to wait before a Needs you push that failed is tried again (ms). Default PUSH_RETRY_MS. */
  pushRetryMs?: number;
  /** The waits between the tries of one failed send (ms); see telegram.ts. */
  retryDelaysMs?: readonly number[];
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
export function needsYou(store: HelperStore | undefined, asks: readonly ApprovalAsk[]): Need[] {
  const questions: Need[] = asks.map((a) => ({ key: `ask-${a.id}`, push: true, text: `ATOM asks: ${a.summary}\n${a.reason}`, buttons: yesNo("Allow", "Decline", `a:${a.id}`) }));
  if (!store) return questions;
  const team = store.list();
  const owners = team.map((h) => ({ name: h.name, jobs: h.jobs }));
  const plans: Need[] = [];
  const failures: Need[] = [];
  for (const owner of owners) {
    for (const job of owner.jobs) {
      if (job.state === "queued" && job.planStatus === "awaiting") {
        plans.push({ key: `plan-${job.id}`, push: true, text: `${owner.name}'s plan for #${job.id} ${titleOf(job)}:\n${job.planSummary ?? "A plan waits for your OK."}`, buttons: yesNo("Approve", "Reject", `p:${job.id}`) });
        continue;
      }
      if (job.state === "failed") {
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
  return [...questions, ...plans, ...proposals, ...drafts, ...edits, ...hub, ...failures.sort((a, b) => b.key.localeCompare(a.key, undefined, { numeric: true }))];
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
  const { log, helpers: store, approvals, describe } = options;
  let push = true;
  // One ATOM turn at a time: the Core answers one request at a time.
  let turns: Promise<void> = Promise.resolve();
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const pushRetryMs = options.pushRetryMs ?? PUSH_RETRY_MS;
  const client: TelegramClient = startTelegram({
    token: options.token,
    chatId: options.chatId,
    ...(options.userId ? { userId: options.userId } : {}),
    log,
    onInput: (input) => take(input),
    ...(options.skipBacklog !== undefined ? { skipBacklog: options.skipBacklog } : {}),
    onBacklog: (count) => {
      log.info("telegram.backlog_skipped", { count });
      later("backlog", say(`ATOM was closed. ${count} ${count === 1 ? "message" : "messages"} arrived meanwhile and ${count === 1 ? "was" : "were"} not run. Send ${count === 1 ? "it" : "them"} again if ${count === 1 ? "it" : "they"} still matter${count === 1 ? "s" : ""}.`));
    },
    ...(options.retryDelaysMs ? { retryDelaysMs: options.retryDelaysMs } : {}),
  });
  // Replies, command answers and routine results: sent through `say`. One that Telegram did not get (after the client's own quick retries) waits in a small
  // outbox and is tried again every `pushRetryMs`, in order, up to PUSH_TRIES times in all (2026-10-16: they used to be lost, and a plan or approval push was
  // the only message that was tried again).
  const outbox: { text: string; buttons?: Button[][]; tries: number }[] = [];
  const OUTBOX_MAX = 20;
  let outboxTimer: NodeJS.Timeout | undefined;
  let closed = false;
  const armOutbox = () => {
    if (outboxTimer || closed || !outbox.length) return;
    outboxTimer = setTimeout(flushOutbox, pushRetryMs);
    outboxTimer.unref();
  };
  async function flushOutbox() {
    outboxTimer = undefined;
    const item = outbox[0];
    if (!item || closed) return;
    const ok = await client.send(item.text, item.buttons);
    if (closed) return;
    if (ok || ++item.tries > PUSH_TRIES) {
      outbox.shift();
      if (!ok) log.warn("telegram.reply_dropped", {});
    }
    armOutbox();
  }
  async function say(text: string, buttons?: Button[][]): Promise<boolean> {
    const ok = await client.send(text, buttons);
    if (!ok && !closed) {
      if (outbox.length >= OUTBOX_MAX) outbox.shift();
      outbox.push({ text, ...(buttons ? { buttons } : {}), tries: 1 });
      armOutbox();
    }
    return ok;
  }
  /** A fire-and-forget step: a failure inside it is logged by name, never an unhandled rejection (that ends the whole app). */
  const later = (what: string, work: Promise<unknown> | void) => {
    void Promise.resolve(work).catch(() => log.warn("telegram.step_failed", { step: what }));
  };

  function take(input: TelegramInput) {
    if (input.kind === "button") return press(input.data, input.queryId);
    const text = input.text.trim();
    if (!text) return void say("I read text only.");
    // A command is "/word" (and "@botname"), then a space or the end. "/tmp/build.log is huge" is a message for ATOM, not an unknown command.
    if (COMMAND.test(text)) return command(text);
    turns = turns.then(() => talk(text));
  }

  async function talk(text: string) {
    const started = Date.now();
    try {
      const answer = await withTimeout(options.ask(text), turnTimeoutMs);
      log.info("telegram.turn", { ok: true, ms: Date.now() - started });
      await say(answer);
    } catch (error) {
      log.warn("telegram.turn", { ok: false, ms: Date.now() - started });
      await say(`ATOM could not answer: ${describe(error)}`);
    }
  }

  function command(text: string) {
    const [head = "", ...rest] = text.split(/\s+/);
    const name = head.slice(1).split("@")[0]!.toLowerCase();
    log.info("telegram.command", { name: ["needs", "tasks", "report", "steer", "interrupt", "help", "start"].includes(name) ? name : "unknown" });
    // Each answer is built inside `reply`, so a failure while building it (a locked database) is told to Keshab, not thrown. A text answer is
    // sent at once (no await first), so answers leave in the order the commands came.
    const failed = (error: unknown) => say(`That did not work: ${describe(error)}`);
    const reply = (build: () => string | Promise<unknown> | void) => {
      try {
        const out = build();
        if (typeof out === "string") return later(name, say(out));
        later(name, Promise.resolve(out).catch(failed));
      } catch (error) {
        later(name, failed(error));
      }
    };
    if (name === "needs") return reply(() => sendNeeds());
    if (name === "tasks") return reply(() => tasksText());
    if (name === "report") return reply(() => reportText(Number(rest[0]?.replace(/^#/, ""))));
    if (name === "steer") return reply(() => steer(rest));
    if (name === "interrupt") return reply(() => interrupt(rest));
    if (name === "help" || name === "start") return reply(() => HELP);
    reply(() => `I do not know that command.\n\n${HELP}`);
  }

  const taskNumber = (word: string | undefined) => {
    const id = Number(word?.replace(/^#/, ""));
    return Number.isInteger(id) && id >= 1 ? id : undefined;
  };

  function steer(args: string[]) {
    if (!options.steering) return void say("Steering is off.");
    const id = taskNumber(args[0]);
    if (!id) return void say("Send /steer, a task number and your message, for example /steer 12 use the shorter plan.");
    try {
      const how = options.steering.steer(id, args.slice(1).join(" "));
      void say(how === "live" ? `Sent to task #${id} now.` : `Kept for task #${id}. It runs after this step.`);
    } catch (error) {
      void say(describe(error));
    }
  }

  async function interrupt(args: string[]) {
    if (!options.steering) return void say("Steering is off.");
    const id = taskNumber(args[0]);
    if (!id) return void say("Send /interrupt and a task number, for example /interrupt 12.");
    try {
      await options.steering.interrupt(id);
      await say(`Task #${id} stopped. It waits for your message.`);
    } catch (error) {
      await say(describe(error));
    }
  }

  async function sendNeeds() {
    const items = needsYou(store, approvals.pending());
    if (!items.length) return say("Nothing waits for you.");
    for (const item of items.slice(0, NEEDS_SHOWN)) await say(item.text, item.buttons);
    if (items.length > NEEDS_SHOWN) await say(`${items.length - NEEDS_SHOWN} more wait in the ATOM window.`);
  }

  function tasksText(): string {
    if (!store) return "The team is not available.";
    const owners = store.list();
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

  // Push: a new Needs you item. Keys seen last time are not sent again. (A routine's result and an agent's report come
  // from the native engine: `send`.)
  let known = new Set(needsYou(store, approvals.pending()).map((n) => n.key));
  let timer: NodeJS.Timeout | undefined;
  /** The retry of a failed push has its own timer: a store change used to merge it into the 1 s settle timer, so it ran at once and the tries ran out in minutes. */
  let retryTimer: NodeJS.Timeout | undefined;
  let stopped = false;
  // 2026-10-16 (code review): an item was marked as sent BEFORE it was sent, so a failed send (the network was down) was never tried again and
  // Keshab never learned that a plan or an approval waited. Now an item counts as sent only once Telegram has it. One that failed is tried
  // again after PUSH_RETRY_MS, up to PUSH_TRIES times; `sending` keeps two runs from sending the same item twice.
  const sending = new Set<string>();
  const failedTries = new Map<string, number>();
  /** An item whose push failed is not tried again before this time, whatever else makes `check` run (a store change must not use up its tries). */
  const notBefore = new Map<string, number>();
  const check = () => {
    timer = undefined;
    if (stopped) return;
    const now = needsYou(store, approvals.pending());
    const fresh = now.filter((n) => n.push && !known.has(n.key) && !sending.has(n.key) && (notBefore.get(n.key) ?? 0) <= Date.now());
    const live = new Set(now.map((n) => n.key));
    // What was sent or is not pushed stays known; what is gone from the list is forgotten; what is new waits for its send.
    // An item held back only by its retry time is neither sent nor known: it is not added here (it used to be, so a failed push was never retried).
    known = new Set(now.filter((n) => known.has(n.key) || sending.has(n.key) || !n.push).map((n) => n.key));
    for (const key of failedTries.keys()) if (!live.has(key)) (failedTries.delete(key), notBefore.delete(key));
    if (!push) {
      for (const item of fresh) known.add(item.key); // push is off: do not pile them up for when it is turned on
      return;
    }
    if (!fresh.length) return;
    log.info("telegram.push", { kind: "needs", count: fresh.length });
    for (const item of fresh) sending.add(item.key);
    later("push", (async () => {
      let retry = false;
      for (const item of fresh) {
        const delivered = await client.send(item.text, item.buttons);
        sending.delete(item.key);
        if (delivered) {
          known.add(item.key);
          failedTries.delete(item.key);
          notBefore.delete(item.key);
          continue;
        }
        const tries = (failedTries.get(item.key) ?? 0) + 1;
        failedTries.set(item.key, tries);
        notBefore.set(item.key, Date.now() + pushRetryMs);
        if (tries >= PUSH_TRIES) {
          known.add(item.key); // given up: it still waits in the ATOM window and in /needs
          log.warn("telegram.push_given_up", { kind: "needs" });
        } else retry = true;
      }
      if (retry && !stopped) {
        retryTimer ??= setTimeout(() => {
          retryTimer = undefined;
          check();
        }, pushRetryMs);
        retryTimer.unref();
      }
    })());
  };
  const soon = () => {
    if (stopped) return;
    timer ??= setTimeout(check, SETTLE_MS);
    timer.unref();
  };
  const stopAsks = approvals.onAsk(soon);
  const stopStore = store?.onChange((change) => {
    if (change.action === "step" || change.action === "usage") return;
    soon();
  });

  return {
    send(text, pushed) {
      if ((pushed && !push) || !text.trim()) return;
      log.info("telegram.push", { kind: pushed ? "routine" : "reply" });
      void say(text);
    },
    setPush(on) {
      if (on !== push) log.info("telegram.push_setting", { on });
      push = on;
    },
    stop() {
      stopped = true;
      closed = true;
      if (outboxTimer) clearTimeout(outboxTimer);
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      stopAsks();
      stopStore?.();
      client.stop();
    },
  };
}

/** `work`, or a rejection after `ms`: a hung answer must not hold up the next message. The work itself is not cancelled. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ATOM did not answer in ${ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.max(1, Math.round(ms / 1000))} seconds`}, so that message was dropped. Send it again.`)), ms);
    timer.unref();
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

