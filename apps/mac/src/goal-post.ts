import type { Goal, HelperStore } from "@atom/helpers";
import type { Message } from "@atom/contracts";
import type { ChatStore } from "@atom/memory";
import type { Logger } from "@atom/shared";
import { chatWriter } from "./chat-owner.ts";
import { MAX_PROJECT_MESSAGES } from "./projects-wiring.ts";

// ADR-109: when a goal ends, its result comes back into the chat that asked, as one assistant turn. The text is data
// from the store: no model is called, nothing is spoken. Logs carry ids and states only.

/** Most characters of the report in the chat; the rest stays on the Board. */
export const POST_CHARS = 1500;
const TITLE_CHARS = 120;
const REASON_CHARS = 200;
const RETRY_MS = 5_000;
const MAX_TRIES = 60;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

function names(list: readonly string[]): string {
  const unique = [...new Set(list)];
  return unique.length < 2 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

/** The chat turn for an ended goal, or undefined when Keshab stopped every task (nothing to say). */
export function goalPostText(goal: Goal, helpers: Pick<HelperStore, "soul" | "report">): string | undefined {
  const nameOf = (t: Goal["tasks"][number]) => helpers.soul(t.helper).name;
  const done = goal.tasks.filter((t) => t.state === "done");
  const failed = goal.tasks.filter((t) => t.state === "failed");
  if (!done.length && !failed.length) return undefined;
  const who = names(goal.tasks.map(nameOf));
  const title = cut((goal.report?.title ?? goal.text).replace(/\s+/g, " ").trim(), TITLE_CHARS);
  if (!done.length) {
    const reasons = failed.slice(0, 3).map((t) => `${nameOf(t)}: ${cut((t.error ?? "It stopped.").replace(/\s+/g, " ").trim(), REASON_CHARS)}`);
    const first = failed[0]!;
    return `${who} could not finish: ${title}\n\n${reasons.join("\n")}\n\nTo try again, press Retry in Needs you, or open Board > ${nameOf(first)} > #${first.id}.`;
  }
  const lead = done[0]!;
  const report = goal.report ?? { summary: helpers.report(lead.id)?.summary ?? "", body: helpers.report(lead.id)?.body ?? "" };
  const text = [report.summary, report.body].filter(Boolean).join("\n\n");
  const parts = [`${who} finished: ${title}`];
  if (text) parts.push(text.length > POST_CHARS ? `${text.slice(0, POST_CHARS).trimEnd()}…\n\nFull report: Board > ${nameOf(lead)} > #${lead.id}` : text);
  if (failed.length) parts.push(`${failed.length} of ${goal.tasks.length} tasks failed. To try again, press Retry in Needs you.`);
  return parts.join("\n\n");
}

export interface GoalPostsOptions {
  helpers: Pick<HelperStore, "goal" | "goalsToPost" | "markGoalPosted" | "onChange" | "soul" | "report">;
  chats: Pick<ChatStore, "messages" | "save" | "project">;
  /** The window Core's current chat id. */
  currentChat(): string | undefined;
  /** Gives the window Core the chat's turns; throws while the Core answers. */
  resume(id: string, turns: readonly Message[]): void;
  /** After the turn is saved: lists change, and an open chat is refreshed. */
  posted(chatId: string): void;
  log: Pick<Logger, "info" | "warn">;
  retryMs?: number;
}

type Outcome = "posted" | "retry" | "gone";

/** Posts each ended goal's result once into its chat (now, and for goals that ended while ATOM was closed). Returns stop. */
export function startGoalPosts(options: GoalPostsOptions): () => void {
  const { helpers, chats, log } = options;
  const waiting = new Set<number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function post(chatId: string, text: string): Outcome {
    const stored = chats.messages(chatId);
    const current = options.currentChat() === chatId;
    if (!stored.length) return current ? "retry" : "gone"; // the chat's first exchange may not be saved yet
    const all: Message[] = [...stored, { role: "assistant", content: text }];
    const capped = chats.project(chatId) ? all.slice(-MAX_PROJECT_MESSAGES) : all;
    const next = capped[0]?.role === "assistant" ? capped.slice(1) : capped; // a chat never starts with an answer
    if (current) {
      try {
        options.resume(chatId, next); // before the save: a busy Core would write its own window over the turn
      } catch {
        return "retry";
      }
    }
    chats.save(chatId, next);
    options.posted(chatId);
    return "posted";
  }

  function attempt(goalId: number, tries = 0): void {
    const goal = helpers.goal(goalId);
    if (!goal?.endedAt || !goal.source || goal.chatPostedAt) return; // posted once only
    const source = goal.source;
    let outcome: Outcome = "gone";
    try {
      const text = chatWriter(source) ? undefined : goalPostText(goal, helpers);
      if (text !== undefined) outcome = post(source, text);
    } catch {
      log.warn("goal.post_failed", { goal: goalId });
      return; // not marked: the next start tries again
    }
    if (outcome === "retry" && tries < MAX_TRIES) {
      waiting.add(goalId);
      const timer = setTimeout(() => {
        timers.delete(timer);
        waiting.delete(goalId);
        attempt(goalId, tries + 1);
      }, options.retryMs ?? RETRY_MS);
      timer.unref();
      timers.add(timer);
      return;
    }
    if (outcome === "retry") return; // gave up: stays unmarked, so the next start posts it
    if (helpers.markGoalPosted(goalId)) log.info("goal.posted", { goal: goalId, posted: outcome === "posted" });
  }

  for (const goal of helpers.goalsToPost()) attempt(goal.id);
  const stop = helpers.onChange((change) => {
    if (change.action === "goal" && change.ended && !waiting.has(change.goal)) attempt(change.goal);
  });
  return () => {
    stop();
    for (const timer of timers) clearTimeout(timer);
  };
}
