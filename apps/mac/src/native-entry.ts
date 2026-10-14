import type { Core } from "@atom/core";
import type { Message } from "@atom/contracts";
import { HelperError, MAX_COMMENT_CHARS, type Routine } from "@atom/helpers";
import type { LogFields } from "@atom/shared";
import { chatWriter } from "./chat-owner.ts";
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
  if (chatId === to.voiceChat() && !chatWriter(chatId)) to.speak(text);
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
  log: { info(event: string, fields: LogFields): void; warn(event: string, fields: LogFields): void };
}

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
      } catch {
        deps.log.warn("routine.turn", { routine: routine.id, ok: false });
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
