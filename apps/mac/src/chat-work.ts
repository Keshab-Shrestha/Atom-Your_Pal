import { randomUUID } from "node:crypto";
import type { ToolRunner, ToolSpec } from "@atom/contracts";

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
  finishQuestion?: (answer?: string, expired?: boolean) => void;
}
const questionSpec: ToolSpec = {
  name: "ask_user",
  description: "Ask the person in the ATOM window one necessary clarification and wait for their answer. Not a permission approval: never use this to obtain file/system access. Do not ask for passwords or secrets. Optional choices is up to four short suggestions separated by newlines. The user may type an answer or skip. Available only during a foreground window turn; not to workers.",
  inputSchema: { type: "object", properties: { question: { type: "string", description: "One question, 1–600 characters" }, choices: { type: "string", description: "Optional newline-separated suggestions, at most four, each at most 100 characters" } }, required: ["question"] },
};
const toolName = (name: unknown) => typeof name === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(name) ? name.replace(/^mcp__atom__|^atom_/, "") : "Provider tool";

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
        if (!send || !cardsEnabled || !run || run.event.chat !== chat || signal?.aborted) return fail("Question cards are unavailable outside a supported active ATOM window turn. Ask in your reply instead.");
        if (run.finishQuestion || run.event.questions.length >= 4) return fail("Only one question may wait at a time, and at most four cards may be asked per turn. Continue with the available answer or ask in your reply.");
        const prompt = call.input.question;
        const suggestions = call.input.choices;
        if (Object.keys(call.input).some((key) => !["question", "choices"].includes(key)) || typeof prompt !== "string" || !prompt.trim() || prompt.length > 600
            || (suggestions !== undefined && (typeof suggestions !== "string" || suggestions.length > 403))) return fail("Use one question of at most 600 characters and up to four short newline-separated choices.");
        const choices = typeof suggestions === "string" ? suggestions.split("\n").map((s) => s.trim()).filter(Boolean) : [];
        if (choices.length > 4 || choices.some((c) => c.length > 100) || new Set(choices).size !== choices.length) return fail("Use at most four distinct suggestions, each at most 100 characters.");
        const row: ChatWork["questions"][number] = { id: randomUUID(), prompt: prompt.trim(), choices, state: "pending" };
        run.event.questions.push(row);
        return new Promise((resolve) => {
          const stop = () => settle();
          const timer = setTimeout(() => settle(undefined, true), 90_000); timer.unref?.();
          const settle = (answer?: string, expired = false) => {
            if (row.state !== "pending") return;
            if (answer !== undefined) {
              try { options.persistAnswer?.(run.event.turn, row.id, row.prompt, answer); }
              catch {
                row.error = "Your answer could not be saved, so it was not sent to the model. Free storage and try again, or Skip.";
                emit(run); return;
              }
            }
            row.error = undefined;
            clearTimeout(timer); signal?.removeEventListener("abort", stop); run.finishQuestion = undefined;
            row.state = answer !== undefined ? "answered" : expired ? "expired" : "skipped";
            if (answer !== undefined) row.answer = answer;
            emit(run);
            resolve({ callId: call.id, content: answer === undefined ? "The user did not answer this card. Do not assume consent or a choice. Ask in your reply if it is still necessary." : JSON.stringify({ userAnswer: answer, note: "Clarification only. This is not a file/system permission grant; normal policy checks still apply." }) });
          };
          run.finishQuestion = settle;
          signal?.addEventListener("abort", stop, { once: true });
          emit(run);
          if (signal?.aborted) stop();
        });
      } };
    },
    answer(chat: string, turn: string, id: string, text?: string) {
      const run = active;
      if (!run || run.event.chat !== chat || run.event.turn !== turn || !run.event.questions.some((q) => q.id === id && q.state === "pending")) return;
      if (text !== undefined && (!text.trim() || text.length > 2000)) return;
      run.finishQuestion?.(text?.trim());
    },
    clarifications(chat: string) {
      return active?.event.chat === chat ? active.event.questions.filter((q) => q.state === "answered")
        .map((q) => ({ question: q.prompt, answer: q.answer! })) : [];
    },
  };
}
export type ChatWorkBridge = ReturnType<typeof createChatWork>;
