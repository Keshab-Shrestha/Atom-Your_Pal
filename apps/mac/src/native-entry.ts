import type { Core } from "@atom/core";
import type { Message } from "@atom/contracts";
import { HelperError, MAX_COMMENT_CHARS, type Routine, type HelperStore } from "@atom/helpers";
import type { LogFields } from "@atom/shared";
import { chatWriter, isSharedChat } from "./chat-owner.ts";
import { TELEGRAM_CHAT } from "./telegram-bot.ts";

/**
 * ADR-110 (Phase N3): the native engine's entry points that are not a window turn. Where a reply that the session gave
 * by itself goes (voice, Telegram), and a routine as a main-agent turn in its own chat. Logs ids only, never text.
 */

/** A routine's chat: it alone writes it (ADR-098). */
export const routineChat = (id: number) => `routine-${id}`;
const ROUTINE_CHAT = /^routine-(\d+)$/;

export interface WakeTargets {
  /** The chat of the window and voice. */
  voiceChat(): string | undefined;
  /** The spoken line path (the island's goal lines): it follows the chat's "Speak the team's reports" (ADR-106). */
  speak(text: string): void;
  /** The Telegram bot's own message (`pushed`: follows "Send to Telegram"); absent when the bot is off. */
  telegram?(text: string, pushed: boolean): void;
  /** A routine by id. */
  routine(id: number): Pick<Routine, "notifyTelegram"> | undefined;
}

/** A reply the session gave by itself (an agent reported), after it is saved in its chat. */
export function routeWake(chatId: string, text: string, to: WakeTargets): void {
  if (chatId === TELEGRAM_CHAT) return to.telegram?.(text, false);
  const routine = ROUTINE_CHAT.exec(chatId);
  if (routine) {
    if (to.routine(Number(routine[1]))?.notifyTelegram) to.telegram?.(text, true);
    return;
  }
  if (chatId === to.voiceChat() && !chatWriter(chatId) && !isSharedChat(chatId)) to.speak(text); // a phone chat is never read aloud on the Mac
}

export interface RoutineTurnDeps {
  /** A native Core of its own, client_composed (makeCore(true)). */
  core: Pick<Core, "handle" | "resume">;
  messages(chatId: string): Message[];
  /** True while a job of that chat still runs. */
  busy(chatId: string): boolean;
  /** The worker's name, so "Sid, <task>" hands the routine to its own worker. */
  name(helper: string): string | undefined;
  telegram?(text: string, pushed: boolean): void;
  /** A line for Keshab when a routine's turn could not run (2026-10-16: it used to fail with only a log line and no reason). */
  failed?(line: string): void;
  log: { info(event: string, fields: LogFields): void; warn(event: string, fields: LogFields): void };
}

/** Why a turn failed, in a few words and never the request's text: an Error's own message, cut. */
const reasonOf = (error: unknown): string => (error instanceof Error && error.message ? error.message.replace(/\s+/g, " ").slice(0, 160) : "unknown reason");

/**
 * The native start of a due routine (store.runRoutines): one main-agent turn in the routine's chat. False (skipped this
 * time, as a legacy routine whose last task still runs) while its last turn or one of its agents still runs. Turns go one
 * at a time, as the Core answers one request at a time.
 */
export function routineStarter(deps: RoutineTurnDeps): (routine: Routine) => boolean {
  const running = new Set<number>();
  let queue: Promise<void> = Promise.resolve();
  return (routine) => {
    const chat = routineChat(routine.id);
    if (running.has(routine.id) || deps.busy(chat)) return false;
    running.add(routine.id);
    queue = queue.then(async () => {
      try {
        deps.core.resume(chat, deps.messages(chat));
        const name = deps.name(routine.helper);
        const reply = await deps.core.handle({ text: name ? `${name}, ${routine.task}` : routine.task, source: "text" });
        deps.log.info("routine.turn", { routine: routine.id, ok: true });
        // An agent still works: its result comes later (routeWake). Else this reply is the result.
        if (routine.notifyTelegram && !deps.busy(chat)) deps.telegram?.(reply.text, true);
      } catch (error) {
        const reason = reasonOf(error);
        deps.log.warn("routine.turn", { routine: routine.id, ok: false, message: reason });
        deps.failed?.(`A routine did not run: ${reason}`);
      } finally {
        running.delete(routine.id);
      }
    });
    return true;
  };
}

/** ADR-098 item 3, ADR-110 N5: Keshab's message to a running task (the ATOM window, Telegram). */
export interface TaskSteering {
  /** "live": the main agent of the task's chat took the note. Throws HelperError when no open chat runs the task. */
  steer(id: number, text: string): "live";
  /** Interrupting a step is not a native operation: stopping the task is. Always throws HelperError that says so. */
  interrupt(id: number): Promise<void>;
}

/** Steering for the native engine: a note to a task is a message to the main agent of the chat that runs it. */
export function nativeSteering(cores: () => Iterable<{ steer(job: number, text: string): boolean }>): TaskSteering {
  return {
    steer(id, raw) {
      const text = raw.trim();
      if (!text) throw new HelperError("The message is empty.");
      if (text.length > MAX_COMMENT_CHARS) throw new HelperError(`The message is too long (${text.length} characters, limit ${MAX_COMMENT_CHARS}).`);
      for (const core of cores()) if (core.steer(id, text)) return "live";
      throw new HelperError("That task does not run in an open chat now, so it cannot take a message.");
    },
    async interrupt() {
      throw new HelperError("A running task cannot be interrupted: stop it instead.");
    },
  };
}

/** A task given from the ATOM window's worker page or its Retry button: a chat of its own, "task-<n>". */
export const taskChat = (n: number) => `task-${n}`;

/** Only persisted host-created retry chats inherit the original task's provider/project/read context. */
export function retrySourceChat(store: Pick<HelperStore, "get">, chat: string): string | undefined {
  const match = /^task-retry-(\d+)$/.exec(chat);
  if (!match) return undefined;
  let job = store.get(Number(match[1]));
  if (job?.chatId !== chat || job.retryOf === undefined) return undefined;
  const seen = new Set<number>();
  while (job?.retryOf !== undefined) {
    if (seen.has(job.id) || seen.size >= 1000) return undefined;
    seen.add(job.id); job = store.get(job.retryOf);
  }
  return job?.chatId;
}

/** All entry points share the same persisted retry claim; transport re-delivery cannot dispatch it twice. */
export function nativeRetryStarter(deps: {
  store: Pick<HelperStore, "queueNativeRetry" | "failQueuedRetry">;
  start(helper: string, task: string, attempt: { id: number; retryOf: number }): void;
}): (id: number) => void {
  return (id) => {
    const { job, created } = deps.store.queueNativeRetry(id);
    if (!created) return;
    try { deps.start(job.helper, job.task, { id: job.id, retryOf: job.retryOf! }); }
    catch (error) {
      deps.store.failQueuedRetry(job.id, reasonOf(error));
      throw error;
    }
  };
}

export interface TaskTurnDeps {
  /** A native Core of its own, client_composed (makeCore(true)). */
  core: Pick<Core, "handle" | "resume">;
  /** The worker's name, so "Sid, <task>" hands the task to its own worker. */
  name(helper: string): string | undefined;
  log: { info(event: string, fields: LogFields): void; warn(event: string, fields: LogFields): void };
  /** A line for Keshab when a task's turn could not run (it used to fail with only a log line and no reason). */
  failed?(line: string): void;
  retrySettled?(job: number, reason?: string): void;
  /** A removed/cancelled intent must not start when its queued turn reaches the front. */
  retryPending?(job: number): boolean;
  /** True while any window task turn is queued/running; false once the queue drains. */
  activity?(active: boolean): void;
  /** The chat ids need a number that never repeats: the clock by default. */
  now?(): number;
}

/**
 * ADR-110 N5: a task from the window is a main-agent turn that hands it to the worker (the legacy runner is gone). Turns go
 * one at a time. Throws HelperError for an unknown worker or an empty task, so the window shows words.
 */
export function taskStarter(deps: TaskTurnDeps): (helper: string, task: string, attempt?: { id: number; retryOf: number }) => void {
  let queue: Promise<void> = Promise.resolve();
  let last = 0;
  let pending = 0;
  const notify = () => {
    try { deps.activity?.(pending > 0); }
    catch { deps.log.warn("task.activity_failed", {}); }
  };
  return (helper, raw, attempt) => {
    const task = raw.trim();
    if (!task) throw new HelperError("The task is empty.");
    const name = deps.name(helper);
    if (!name) throw new HelperError(`There is no worker called "${helper.slice(0, 40)}".`);
    const chat = attempt ? `task-retry-${attempt.id}` : taskChat((last = Math.max((deps.now ?? Date.now)(), last + 1)));
    if (++pending === 1) notify();
    queue = queue.then(async () => {
      let reason: string | undefined;
      try {
        if (attempt && deps.retryPending && !deps.retryPending(attempt.id)) return;
        deps.core.resume(chat, []);
        await deps.core.handle({ text: `${name}, ${task}`, source: "text" });
        deps.log.info("task.turn", { helper, ok: true });
      } catch (error) {
        reason = reasonOf(error);
        deps.log.warn("task.turn", { helper, ok: false, message: reason });
        try {
          deps.failed?.(`${name}'s task did not run: ${reason}`);
        } catch {
          // A throwing notice must not leave the queue rejected: every later task would be skipped.
        }
      } finally {
        if (attempt) {
          try { deps.retrySettled?.(attempt.id, reason); }
          catch { deps.log.warn("task.retry_settle_failed", { job: attempt.id }); }
        }
        if (--pending === 0) notify();
      }
    });
  };
}
