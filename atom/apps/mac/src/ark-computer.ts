import { createComputerTool, createCuaTransport } from "@atom/tool-engine";
import { acceptedComputerPlan, type DecisionEngine, type ComputerDecisionAnswer } from "@atom/decision-engine";
import type { ToolImage } from "@atom/contracts";
import { randomUUID } from "node:crypto";

export type ArkComputerCommand =
  | { type: "ark.computer.run"; request: string; session: string; input: Record<string, unknown>; mode: "background" | "foreground"; provider: "off" | "laya" | "jev"; backup: boolean }
  | { type: "ark.computer.cancel"; request: string }
  | { type: "ark.computer.answer"; request: string; id: string; approved: boolean }
  | { type: "ark.computer.decision.answer"; request: string; id: string; answer?: ComputerDecisionAnswer };
export type ArkComputerEvent =
  | { type: "ark.computer.result"; request: string; value?: { text: string; images: ToolImage[] }; error?: string }
  | { type: "ark.computer.approval"; request: string; id: string; summary: string; reason: string }
  | { type: "ark.computer.decision"; request: string; id: string; state: string; criteria: Record<string, string> }
  | { type: "ark.computer.progress"; request: string; action: string; app?: string; current?: number; total?: number };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
export function parseArkComputer(value: Record<string, unknown>): ArkComputerCommand | undefined {
  if (!uuid(value.request)) return;
  if (value.type === "ark.computer.run" && uuid(value.session) && (value.mode === "background" || value.mode === "foreground") && ["off", "laya", "jev"].includes(String(value.provider)) && typeof value.backup === "boolean" && typeof record(value.input).action === "string") return { type: value.type, request: value.request, session: value.session, input: record(value.input), mode: value.mode, provider: value.provider as "off" | "laya" | "jev", backup: value.backup };
  if (value.type === "ark.computer.cancel") return { type: value.type, request: value.request };
  if (value.type === "ark.computer.answer" && uuid(value.id) && typeof value.approved === "boolean") return { type: value.type, request: value.request, id: value.id, approved: value.approved };
  if (value.type === "ark.computer.decision.answer" && uuid(value.id)) {
    const answer = record(value.answer);
    if (value.answer === undefined) return { type: value.type, request: value.request, id: value.id };
    if (typeof answer.choice === "string" && /^plan_[0-3]$|^review$/.test(answer.choice) && typeof answer.confidence === "number" && typeof answer.probability === "number" && [answer.confidence, answer.probability].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return { type: value.type, request: value.request, id: value.id, answer: { choice: answer.choice, confidence: answer.confidence, probability: answer.probability } };
  }
  return;
}

export function createArkComputer(decisions: DecisionEngine) {
  const cua = createCuaTransport();
  let emit: (event: ArkComputerEvent) => void = () => {};
  let active: { command: Extract<ArkComputerCommand, { type: "ark.computer.run" }>; controller: AbortController } | undefined;
  const sessions = new Map<string, ReturnType<typeof createComputerTool>>();
  const approvals = new Map<string, (approved: boolean) => void>();
  const choices = new Map<string, (answer?: ComputerDecisionAnswer) => void>();
  function wait<T>(map: Map<string, (value: T) => void>, signal: AbortSignal, ms: number, send: (id: string) => void, refused: T): Promise<T> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(refused);
      const id = randomUUID();
      const settle = (value: T) => { clearTimeout(timer); signal.removeEventListener("abort", abort); map.delete(id); resolve(value); };
      const abort = () => settle(refused);
      const timer = setTimeout(abort, ms); timer.unref();
      map.set(id, settle); signal.addEventListener("abort", abort, { once: true }); send(id);
    });
  }
  const getTool = (session: string) => {
    let tool = sessions.get(session);
    if (!tool) {
      if (sessions.size >= 128) sessions.delete(sessions.keys().next().value!);
      tool = createComputerTool({
        cua,
        approve: (request, signal) => active && signal ? wait(approvals, signal, 60_000, (id) => emit({ type: "ark.computer.approval", request: active!.command.request, id, ...request }), false) : Promise.resolve(false),
        onStep: (step) => { if (active) emit({ type: "ark.computer.progress", request: active.command.request, ...step }); },
        onProgress: (step) => { if (active) emit({ type: "ark.computer.progress", request: active.command.request, ...step }); },
        deliveryMode: () => active?.command.mode ?? "background",
        decisionProvider: () => active?.command.provider ?? "off",
        choosePlan: async (state, signal) => {
          const current = active;
          if (!current || !signal || signal.aborted || current.command.provider === "off") return undefined;
          let source: "laya" | "jev" = current.command.provider;
          let answer = source === "laya" ? await decisions.chooseComputerPlan?.(state, signal) : await wait(choices, signal, 2_000, (id) => emit({ type: "ark.computer.decision", request: current.command.request, id, ...state }), undefined);
          if (!answer && source === "jev" && current.command.backup && !signal.aborted) { source = "laya"; answer = await decisions.chooseComputerPlan?.(state, signal); }
          if (signal.aborted) return undefined;
          const index = acceptedComputerPlan(answer, Object.keys(state.criteria).length - 1);
          return index === undefined ? { source, reason: answer ? "uncertain" as const : "unavailable" as const } : { source, index };
        },
      });
      sessions.set(session, tool);
    }
    return tool;
  };
  return {
    attach(send: typeof emit) { emit = send; },
    handle(command: ArkComputerCommand) {
      if (command.type === "ark.computer.cancel") {
        if (active?.command.request === command.request) { active.controller.abort(); sessions.delete(active.command.session); void cua.close(); }
        return;
      }
      if (command.type === "ark.computer.answer") { if (active?.command.request === command.request) approvals.get(command.id)?.(command.approved); return; }
      if (command.type === "ark.computer.decision.answer") { if (active?.command.request === command.request) choices.get(command.id)?.(command.answer); return; }
      if (active) { emit({ type: "ark.computer.result", request: command.request, error: "Another computer action is still finishing." }); return; }
      const controller = new AbortController(); active = { command, controller };
      void Promise.resolve().then(() => getTool(command.session).run(command.input, controller.signal)).then((result) => {
        if (controller.signal.aborted) throw new Error("Computer action stopped. Its last input may already have happened; look again before continuing.");
        emit({ type: "ark.computer.result", request: command.request, value: typeof result === "string" ? { text: result, images: [] } : { text: result.text, images: result.images ?? [] } });
      }).catch(async (error) => {
        if (controller.signal.aborted) await cua.close();
        sessions.delete(command.session);
        emit({ type: "ark.computer.result", request: command.request, error: error instanceof Error ? error.message : "Computer action could not finish. Do not replay it automatically." });
      }).finally(() => { if (active?.command.request === command.request) active = undefined; });
    },
    async close() { active?.controller.abort(); sessions.clear(); await cua.close(); },
  };
}
