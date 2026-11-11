import { randomUUID } from "node:crypto";
import type { ToolRunner, ToolSpec } from "@ark/contracts";

export interface ChatWork {
  type: "chat.work";
  chat: string;
  turn: string;
  startedAt: string;
  elapsedMs: number;
  state: "working" | "completed" | "failed" | "stopped";
  calls: { id: string; tool: string; state: "started" | "ok" | "error" | "unknown"; ms?: number }[];
  omitted: number;
  questions: { id: string; prompt: string; choices: string[]; state: "pending" | "answered" | "skipped" | "expired"; answer?: string; error?: string }[];
}
interface Run {
  event: ChatWork;
  at: number;
  calls: Map<string, { id: string; at: number }>;
  /** The waiting card: one answer (undefined = skipped) for one of its questions; no id settles the whole card. */
  finishQuestion?: (id?: string, answer?: string, expired?: boolean) => void;
}
const questionSpec: ToolSpec = {
  name: "ask_user",
  description: "Ask the person in the ARK window necessary clarifications in one card and wait for their answers. Not a permission approval: never use this to obtain file/system access. Do not ask for passwords or secrets. Use question (+ choices) for one question, or questions for 2–4 related ones. Each choice is one line: a short label, optionally ' | ' and a short reason, and ' (recommended)' at the end of the one you prefer. The user picks an option, writes a note, or leaves a question blank (unanswered). Available only during a foreground window turn; not to workers.",
  inputSchema: { type: "object", properties: {
    question: { type: "string", description: "One question, 1–600 characters. Omit when you use questions." },
    choices: { type: "string", description: "Optional newline-separated choices for question, at most four, each at most 160 characters" },
    questions: { type: "string", description: "Optional, instead of question: a JSON array of 2–4 objects {\"question\": string, \"choices\": newline-separated string}, with the same limits" },
  } },
};
/** Control characters (a prompt keeps its line breaks) and the invisible bidi/format characters that could hide or reorder text. */
const hidden = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const clean = (text: string) => text.replace(hidden, "").trim();
/** ADR-275: one question, or 2–4 from the `questions` JSON string. A string is the refusal to send back. */
export function parseQuestions(input: Record<string, unknown>): { prompt: string; choices: string[] }[] | string {
  const keys = Object.keys(input);
  if (keys.some((key) => !["question", "choices", "questions"].includes(key))) return "Use only question, choices or questions.";
  let raw: unknown[];
  if (input.questions !== undefined) {
    if (input.question !== undefined || input.choices !== undefined) return "Use either question (+ choices) or questions, not both.";
    if (typeof input.questions !== "string" || input.questions.length > 4_000) return "questions must be a JSON array string of at most 4000 characters.";
    try { raw = JSON.parse(input.questions); } catch { return "questions must be valid JSON: an array of {\"question\", \"choices\"} objects."; }
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) return "questions must be an array of one to four objects.";
  } else raw = [{ question: input.question, choices: input.choices }];
  const out: { prompt: string; choices: string[] }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => !["question", "choices"].includes(key))) return "Each question is an object with question and optional choices.";
    const { question: prompt, choices: suggestions } = item as Record<string, unknown>;
    if (typeof prompt !== "string" || !clean(prompt) || prompt.length > 600
        || (suggestions !== undefined && (typeof suggestions !== "string" || suggestions.length > 643))) return "Use questions of at most 600 characters and up to four short newline-separated choices.";
    const choices = typeof suggestions === "string" ? suggestions.split("\n").map(clean).filter(Boolean) : [];
    if (choices.length > 4 || choices.some((c) => c.length > 160) || new Set(choices).size !== choices.length) return "Use at most four distinct choices per question, each at most 160 characters.";
    out.push({ prompt: clean(prompt), choices });
  }
  return out;
}
export const toolName = (name: unknown) => typeof name === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(name) ? name.replace(/^mcp__ark__|^ark_/, "") : "Provider tool";

/** Ephemeral foreground observations. Tool rows omit arguments/results; explicit question-card data stays in memory. No policy changes. */
export function createChatWork(options: { persistAnswer?(turn: string, card: string, question: string, answer: string): void } = {}) {
  let send: ((event: ChatWork) => void) | undefined;
  let cardsEnabled = false;
  let active: Run | undefined;
  const emit = (run: Run) => {
    run.event.elapsedMs = Math.min(86_400_000, Math.max(0, performance.now() - run.at));
    try { send?.(structuredClone(run.event)); } catch { /* UI delivery cannot fail model work. */ }
  };
  const startCall = (run: Run, key: string, name: unknown) => {
    if (run !== active || run.calls.has(key)) return;
    if (run.event.calls.length >= 60) { run.event.omitted++; return; }
    const id = randomUUID();
    run.calls.set(key, { id, at: performance.now() });
    run.event.calls.push({ id, tool: toolName(name), state: "started" });
    emit(run);
  };
  const endCall = (run: Run, key: string, error: boolean) => {
    if (run !== active) return;
    const ref = run.calls.get(key);
    const row = run.event.calls.find((c) => c.id === ref?.id);
    if (!row || row.state !== "started") return;
    row.state = error ? "error" : "ok";
    row.ms = Math.min(86_400_000, Math.max(0, performance.now() - ref!.at));
    emit(run);
  };
  const end = (run: Run, state: ChatWork["state"]) => {
    if (run !== active || state === "working") return;
    run.finishQuestion?.();
    for (const row of run.event.calls) if (row.state === "started") row.state = "unknown";
    run.event.state = state;
    emit(run);
    active = undefined;
  };
  return {
    attach(listener: (event: ChatWork) => void) { send = listener; cardsEnabled = false; return () => { if (active) end(active, "stopped"); send = undefined; cardsEnabled = false; }; },
    enableCards() { cardsEnabled = true; },
    begin(chat: string, signal?: AbortSignal, turn: string = randomUUID()) {
      if (active) end(active, "stopped");
      const run: Run = { at: performance.now(), calls: new Map(), event: { type: "chat.work", chat, turn, startedAt: new Date().toISOString(), elapsedMs: 0, state: "working", calls: [], omitted: 0, questions: [] } };
      active = run; emit(run);
      const stop = () => end(run, "stopped");
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) stop();
      return (state: ChatWork["state"]) => { signal?.removeEventListener("abort", stop); end(run, state); };
    },
    sdk(chat: string, message: Record<string, any>) {
      const run = active;
      if (!run || run.event.chat !== chat || message.parent_tool_use_id != null) return;
      const content: unknown = message.message?.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (message.type === "assistant" && block?.type === "tool_use" && typeof block.id === "string") startCall(run, block.id, block.name);
        if (message.type === "user" && block?.type === "tool_result" && typeof block.tool_use_id === "string") endCall(run, block.tool_use_id, block.is_error === true);
      }
    },
    observe(chat: string, runner: ToolRunner): ToolRunner {
      const run = active?.event.chat === chat ? active : undefined;
      return { specs: () => runner.specs(), async run(call, signal) {
        const key = randomUUID();
        if (run) startCall(run, key, call.name);
        try {
          const result = await runner.run(call, signal);
          if (run) endCall(run, key, result.isError === true);
          return result;
        } catch (error) { if (run) endCall(run, key, true); throw error; }
      } };
    },
    tools(chat: string, base: ToolRunner): ToolRunner {
      return { specs: () => [...base.specs(), questionSpec], async run(call, signal) {
        if (call.name !== "ask_user") return base.run(call, signal);
        const fail = (content: string) => ({ callId: call.id, content, isError: true });
        const run = active;
        if (!send || !cardsEnabled || !run || run.event.chat !== chat || signal?.aborted) return fail("Question cards are unavailable outside a supported active ARK window turn. Ask in your reply instead.");
        if (run.finishQuestion) return fail("Only one question card may wait at a time. Continue with the available answers or ask in your reply.");
        const asked = parseQuestions(call.input);
        if (typeof asked === "string") return fail(asked);
        if (run.event.questions.length + asked.length > 4) return fail("At most four questions may be asked per turn. Continue with the available answers or ask in your reply.");
        const rows: ChatWork["questions"] = asked.map((q) => ({ id: randomUUID(), prompt: q.prompt, choices: q.choices, state: "pending" }));
        run.event.questions.push(...rows);
        return new Promise((resolve) => {
          const given = new Map<string, string | undefined>();
          const stop = () => take();
          // 90 s per question: four questions wait up to 360 s.
          const timer = setTimeout(() => take(undefined, undefined, true), 90_000 * rows.length); timer.unref?.();
          const settle = (expired: boolean) => {
            clearTimeout(timer); signal?.removeEventListener("abort", stop); run.finishQuestion = undefined;
            for (const row of rows) {
              const answer = given.get(row.id);
              row.error = undefined;
              row.state = answer !== undefined ? "answered" : given.has(row.id) || !expired ? "skipped" : "expired";
              if (answer !== undefined) row.answer = answer;
            }
            emit(run);
            const none = "The user did not answer this card. Do not assume consent or a choice. Ask in your reply if it is still necessary.";
            const note = "Clarification only. This is not a file/system permission grant; normal policy checks still apply.";
            const content = rows.every((row) => row.answer === undefined) ? none
              : rows.length === 1 ? JSON.stringify({ userAnswer: rows[0].answer, note })
              : JSON.stringify({ answers: rows.map((row) => row.answer === undefined ? { question: row.prompt, unanswered: true } : { question: row.prompt, userAnswer: row.answer }), note: `${note} Do not assume a choice for an unanswered question.` });
            resolve({ callId: call.id, content });
          };
          // One answer at a time; the card settles once every question has one, or at once on stop, expiry or the turn's end.
          const take = (id?: string, answer?: string, expired = false) => {
            if (id === undefined) return settle(expired);
            const row = rows.find((r) => r.id === id);
            if (!row || given.has(id)) return;
            if (answer !== undefined) {
              try { options.persistAnswer?.(run.event.turn, row.id, row.prompt, answer); }
              catch {
                row.error = "Your answer could not be saved, so it was not sent to the model. Free storage and try again, or leave it blank.";
                emit(run); return;
              }
            }
            row.error = undefined;
            given.set(id, answer);
            if (given.size === rows.length) settle(false); else emit(run);
          };
          run.finishQuestion = take;
          signal?.addEventListener("abort", stop, { once: true });
          emit(run);
          if (signal?.aborted) stop();
        });
      } };
    },
    answer(chat: string, turn: string, id: string, text?: string) {
      const run = active;
      if (!run || run.event.chat !== chat || run.event.turn !== turn || !run.event.questions.some((q) => q.id === id && q.state === "pending")) return;
      if (text !== undefined && !text.trim()) return;
      run.finishQuestion?.(id, text?.trim());
    },
    clarifications(chat: string) {
      return active?.event.chat === chat ? active.event.questions.filter((q) => q.state === "answered")
        .map((q) => ({ question: q.prompt, answer: q.answer! })) : [];
    },
  };
}
export type ChatWorkBridge = ReturnType<typeof createChatWork>;
