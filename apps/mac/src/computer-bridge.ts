// Connects the computer tool to ATOM Island (ADR-054, Task 0.6.3): what ATOM is doing, and asking the user
// before a risky action. Lives in the runtime so the rule "no answer means no" holds even if the island is gone.

import type { ComputerDecisionAnswer, ComputerDecisionState } from "@atom/decision-engine";
import { randomUUID } from "node:crypto";
import type { IslandEvent } from "./island-protocol.ts";

export type FileApproval = false | "once" | "chat";
export type FileEditReview = { path: string; before: string; after: string };
export const FILE_REVIEW_BYTES = 32 * 1024;
export const FILE_REVIEW_LINES = 1_000;
export function validFileReview(review: FileEditReview): boolean {
  return typeof review.path === "string" && review.path.startsWith("/") && review.path.length <= 300 && !/[\u0000-\u001f\u007f\p{Cf}\u2028\u2029]/u.test(review.path)
    && typeof review.before === "string" && typeof review.after === "string" && review.before !== review.after
    && Buffer.byteLength(review.before) + Buffer.byteLength(review.after) <= FILE_REVIEW_BYTES
    && review.before.split("\n").length + review.after.split("\n").length <= FILE_REVIEW_LINES;
}
type ApprovalInput = { summary: string; reason: string; timeoutMs?: number; reasonMax?: number; rememberFile?: boolean; fileReview?: FileEditReview; accessChange?: true };

export interface ComputerBridge {
  /** Where events go. Until the island is attached, every approval is a refusal and steps are dropped. */
  attach(send: (event: IslandEvent) => void): void;
  /** Passed to the computer tool as `approve`. Resolves true only if the user answers yes. */
  /** `timeoutMs` overrides the default wait for this one request. */
  approve(request: { summary: string; reason: string; timeoutMs?: number; reasonMax?: number; accessChange?: true }, signal?: AbortSignal): Promise<boolean>;
  approveFile(request: { summary: string; reason: string }, signal?: AbortSignal): Promise<FileApproval>;
  /** Full local review. Approval requires a token returned only by the detailed native review surface. */
  approveFileEdit(request: FileEditReview & { summary: string }, signal?: AbortSignal): Promise<boolean>;
  /** Passed to the computer tool as `onPoint`. False if there is no island to show it. */
  point(target: { x: number; y: number; w: number; h: number; label: string }): boolean;
  /** Task 2.x: the island opens its Settings page. False if there is no island. */
  openSettings(): boolean;
  /** Task 2.x: the island presses the Mac's play/pause key. False if there is no island. */
  playPause(): boolean;
  /** Passed to the computer tool as `onStep`. */
  step(step: { action: string; app?: string; current?: number; total?: number }): void;
  decisionOptions(): { provider: "off" | "jev" | "laya"; backup: boolean; revision: number };
  setDecisions(provider: "off" | "jev" | "laya", backup: boolean): void;
  decide(request: ComputerDecisionState, signal?: AbortSignal): Promise<ComputerDecisionAnswer | undefined>;
  decisionResult(id: string, answer?: ComputerDecisionAnswer): void;
  beginAction(): void;
  actionFinished(): void;
  cursorMove(point: { x: number; y: number }): void;
  /** The Settings default for computer input (the island's `computer.mode`). Background until the island says otherwise. */
  setForeground(on: boolean): void;
  /** Passed to the computer tool as `deliveryMode`. */
  deliveryMode(): "background" | "foreground";
  /** The island's `approval.answer`. An unknown or finished id does nothing. */
  answer(id: string, approved: boolean, rememberFile?: boolean, reviewToken?: string): void;
  /** Declines everything waiting (the turn ended or was cancelled). */
  cancelAll(): void;
  /** ADR-098: the requests waiting for an answer, oldest first (for Telegram's /needs). */
  pending(): ApprovalAsk[];
  /** ADR-098: called with each new request (Telegram sends it with Allow and Decline). Returns a function that stops listening. */
  onAsk(listener: (ask: ApprovalAsk) => void): () => void;
}

/** A request as the island shows it: one-line summary and reason. */
export interface ApprovalAsk {
  id: string;
  summary: string;
  reason: string;
  rememberFile?: true;
  accessChange?: true;
  fileReview?: FileEditReview & { token: string };
}

export interface ComputerBridgeOptions {
  /** The agent cursor shown during a computer task (optional: off when computer control is off). */
  cursor?: { start(): Promise<void>; finish(): Promise<void> };
  onCursorError?: () => void;
  onDecisionWarm?: () => void;
  /** How long a request waits for the user before it counts as "no". */
  timeoutMs?: number;
  /** How long after the last step (with no approval waiting) the island is told that the work is over. */
  endAfterMs?: number;
  newId?: () => string;
}

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** A step in plain words for the bubble. App name and kind of action only: never typed text or screen content. */
export function stepText(step: { action: string; app?: string; current?: number; total?: number }): string {
  const app = step.app ? oneLine(step.app, 40) : undefined;
  if (step.action === "click" && Number.isSafeInteger(step.current) && Number.isSafeInteger(step.total) && step.current! >= 1 && step.current! <= step.total! && step.total! <= 8)
    return `Clicking button ${step.current} of ${step.total}${app ? ` in ${app}` : ""}`;
  switch (step.action) {
    case "status": return "Checking computer readiness";
    case "list_apps": return "Checking which apps are open";
    case "look": return app ? `Looking at ${app}` : "Looking at the screen";
    case "open": return app ? `Opening ${app}` : "Opening an app";
    case "choose_sequence": return "Choosing a prepared computer plan";
    case "click": return app ? `Clicking in ${app}` : "Clicking";
    case "type": return app ? `Typing in ${app}` : "Typing";
    case "key": return app ? `Pressing a key in ${app}` : "Pressing a key";
    case "scroll": return app ? `Scrolling in ${app}` : "Scrolling";
    case "point": return app ? `Pointing in ${app}` : "Pointing at something";
    default: return "Using the computer";
  }
}

/** The longest reason a card may carry, whatever a caller asks for. */
export const MAX_REASON_CHARS = 600;

/** Quiet time after the last step before the island is told the work is over. */
export const COMPUTER_END_MS = 6000;

export function createComputerBridge(options: ComputerBridgeOptions = {}): ComputerBridge {
  const { timeoutMs = 60_000, endAfterMs = COMPUTER_END_MS, newId = randomUUID } = options;
  // The agent cursor (2026-10-23): on with a task's first step, back to ATOM and hidden when the task ends. It never blocks an action.
  let working = false;
  let foreground = false;
  let activeActions = 0;
  let decisionConfig = { provider: "off" as "off" | "jev" | "laya", backup: false, revision: 0 };
  const decisions = new Map<string, (answer?: ComputerDecisionAnswer) => void>();
  function cancelDecisions() { for (const settle of [...decisions.values()]) settle(); }

  const cursorFailed = () => options.onCursorError?.();
  function begin() {
    if (working || !options.cursor) return;
    working = true;
    options.cursor.start().catch(cursorFailed);
  }
  let sendEvent: ((event: IslandEvent) => void) | undefined;
  const waiting = new Map<string, (approved: FileApproval) => void>();
  const asks = new Map<string, ApprovalAsk>();
  const askListeners = new Set<(ask: ApprovalAsk) => void>();

  // 2026-10-15: the island's work strip ended only when its own voice loop went idle, so a turn started by the local API, Telegram or
  // a goal left it on screen until the user closed it. Now the bridge says when the work is over: a quiet moment after the last step.
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleEnd() {
    clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      if (waiting.size !== 0 || activeActions > 0) return;
      sendEvent?.({ type: "computer.end" });
      if (working) { working = false; options.cursor?.finish().catch(cursorFailed); }
    }, endAfterMs);
    endTimer.unref?.();
  }

  function settle(id: string, approved: boolean, rememberFile = false, reviewToken?: string) {
    const done = waiting.get(id);
    if (!done) return;
    waiting.delete(id);
    const request = asks.get(id);
    const canRemember = request?.rememberFile === true;
    if (request?.fileReview && reviewToken !== request.fileReview.token) approved = false;
    asks.delete(id);
    done(approved ? (rememberFile && canRemember ? "chat" : "once") : false);
    sendEvent?.({ type: "approval.closed", id });
    scheduleEnd();
  }

  function ask(request: ApprovalInput, signal?: AbortSignal): Promise<FileApproval> {
      if (!sendEvent || signal?.aborted) return Promise.resolve(false);
      const id = newId();
      return new Promise<FileApproval>((resolve) => {
        const timer = setTimeout(() => settle(id, false), request.timeoutMs ?? timeoutMs);
        const onAbort = () => settle(id, false);
        waiting.set(id, (approved) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve(approved);
        });
        signal?.addEventListener("abort", onAbort, { once: true });
        const ask: ApprovalAsk = { id, summary: oneLine(request.summary, 140), reason: oneLine(request.reason, Math.min(Math.max(request.reasonMax ?? 140, 140), MAX_REASON_CHARS)), ...(request.accessChange ? { accessChange: true } : {}), ...(request.rememberFile ? { rememberFile: true } : {}), ...(request.fileReview ? { fileReview: { ...request.fileReview, token: randomUUID() } } : {}) };
        asks.set(id, ask);
        sendEvent!({ type: "approval.request", ...ask });
        for (const listener of askListeners) listener(ask);
      });
  }

  return {
    attach(send) { sendEvent = send; },
    approve: async (request, signal) => Boolean(await ask(request, signal)),
    approveFile: (request, signal) => ask({ ...request, reasonMax: MAX_REASON_CHARS, rememberFile: true }, signal),
    approveFileEdit: async (request, signal) => validFileReview(request) && Boolean(await ask({ summary: request.summary, reason: "Review the full file change in ATOM on your Mac. An undo copy is required before applying.", timeoutMs: 120_000, fileReview: { path: request.path, before: request.before, after: request.after } }, signal)),
    point(target) {
      if (!sendEvent) return false;
      const whole = (n: number) => Math.round(n);
      sendEvent({ type: "computer.point", x: whole(target.x), y: whole(target.y), w: whole(target.w), h: whole(target.h), label: oneLine(target.label, 48) });
      begin();
      scheduleEnd();
      return true;
    },
    openSettings() {
      sendEvent?.({ type: "settings.open" });
      return Boolean(sendEvent);
    },
    playPause() {
      sendEvent?.({ type: "media.key", key: "playpause" });
      return Boolean(sendEvent);
    },
    setForeground(on) {
      foreground = on;
    },
    deliveryMode() {
      return foreground ? "foreground" : "background";
    },
    step(step) {
      sendEvent?.({ type: "computer.step", text: stepText(step) });
      // The status probe measures cold initialization itself; cursor setup must not prewarm the helper first.
      if (step.action !== "status") begin();
      scheduleEnd();
    },
    decisionOptions: () => ({ ...decisionConfig }),
    setDecisions(provider, backup) {
      decisionConfig = { provider, backup, revision: decisionConfig.revision + 1 };
      cancelDecisions();
      if (provider === "laya" || (provider === "jev" && backup)) options.onDecisionWarm?.();
    },
    decisionResult(id, answer) { decisions.get(id)?.(answer); },
    decide(request, signal) {
      if (decisionConfig.provider !== "jev" || !sendEvent || signal?.aborted) return Promise.resolve(undefined);
      cancelDecisions();
      return new Promise((resolve) => {
        const id = randomUUID();
        let timer: ReturnType<typeof setTimeout>;
        const settle = (answer?: ComputerDecisionAnswer) => {
          if (!decisions.delete(id)) return;
          clearTimeout(timer); signal?.removeEventListener("abort", abort);
          sendEvent?.({ type: "computer.decision.cancel", id });
          resolve(answer);
        };
        const abort = () => settle();
        decisions.set(id, settle);
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(settle, 1800);
        sendEvent!({ type: "computer.decision", id, ...request });
      });
    },
    beginAction() { activeActions += 1; clearTimeout(endTimer); },
    actionFinished() { activeActions = Math.max(0, activeActions - 1); if (!activeActions) scheduleEnd(); },
    cursorMove(point) {
      if (Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 100_000 && Math.abs(point.y) <= 100_000)
        sendEvent?.({ type: "computer.cursor", x: point.x, y: point.y });
    },
    answer: (id, approved, rememberFile, reviewToken) => settle(id, approved, rememberFile, reviewToken),
    cancelAll() {
      cancelDecisions();
      for (const id of [...waiting.keys()]) settle(id, false);
      clearTimeout(endTimer);
      sendEvent?.({ type: "computer.end" });
      if (working) { working = false; options.cursor?.finish().catch(cursorFailed); }
    },
    pending: () => [...asks.values()],
    onAsk(listener) {
      askListeners.add(listener);
      return () => askListeners.delete(listener);
    },
  };
}
