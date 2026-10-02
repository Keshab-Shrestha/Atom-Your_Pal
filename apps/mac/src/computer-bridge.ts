// Connects the computer tool to ZENO Island (ADR-054, Task 0.6.3): what ZENO is doing, and asking the user
// before a risky action. Lives in the runtime so the rule "no answer means no" holds even if the island is gone.

import { randomUUID } from "node:crypto";
import type { IslandEvent } from "./island-protocol.ts";

export interface ComputerBridge {
  /** Where events go. Until the island is attached, every approval is a refusal and steps are dropped. */
  attach(send: (event: IslandEvent) => void): void;
  /** Passed to the computer tool as `approve`. Resolves true only if the user answers yes. */
  approve(request: { summary: string; reason: string }, signal?: AbortSignal): Promise<boolean>;
  /** Passed to the computer tool as `onPoint`. False if there is no island to show it. */
  point(target: { x: number; y: number; w: number; h: number; label: string }): boolean;
  /** Passed to the computer tool as `onStep`. */
  step(step: { action: string; app?: string }): void;
  /** The island's `approval.answer`. An unknown or finished id does nothing. */
  answer(id: string, approved: boolean): void;
  /** Declines everything waiting (the turn ended or was cancelled). */
  cancelAll(): void;
}

export interface ComputerBridgeOptions {
  /** How long a request waits for the user before it counts as "no". */
  timeoutMs?: number;
  newId?: () => string;
}

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** A step in plain words for the bubble. App name and kind of action only: never typed text or screen content. */
export function stepText(step: { action: string; app?: string }): string {
  const app = step.app ? oneLine(step.app, 40) : undefined;
  switch (step.action) {
    case "list_apps": return "Checking which apps are open";
    case "look": return app ? `Looking at ${app}` : "Looking at the screen";
    case "open": return app ? `Opening ${app}` : "Opening an app";
    case "click": return app ? `Clicking in ${app}` : "Clicking";
    case "type": return app ? `Typing in ${app}` : "Typing";
    case "key": return app ? `Pressing a key in ${app}` : "Pressing a key";
    case "scroll": return app ? `Scrolling in ${app}` : "Scrolling";
    case "point": return app ? `Pointing in ${app}` : "Pointing at something";
    default: return "Using the computer";
  }
}

export function createComputerBridge(options: ComputerBridgeOptions = {}): ComputerBridge {
  const { timeoutMs = 60_000, newId = randomUUID } = options;
  let sendEvent: ((event: IslandEvent) => void) | undefined;
  const waiting = new Map<string, (approved: boolean) => void>();

  function settle(id: string, approved: boolean) {
    const done = waiting.get(id);
    if (!done) return;
    waiting.delete(id);
    done(approved);
    sendEvent?.({ type: "approval.closed", id });
  }

  return {
    attach(send) {
      sendEvent = send;
    },
    approve(request, signal) {
      if (!sendEvent || signal?.aborted) return Promise.resolve(false);
      const id = newId();
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => settle(id, false), timeoutMs);
        const onAbort = () => settle(id, false);
        waiting.set(id, (approved) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve(approved);
        });
        signal?.addEventListener("abort", onAbort, { once: true });
        sendEvent!({ type: "approval.request", id, summary: oneLine(request.summary, 140), reason: oneLine(request.reason, 140) });
      });
    },
    point(target) {
      if (!sendEvent) return false;
      const whole = (n: number) => Math.round(n);
      sendEvent({ type: "computer.point", x: whole(target.x), y: whole(target.y), w: whole(target.w), h: whole(target.h), label: oneLine(target.label, 48) });
      return true;
    },
    step(step) {
      sendEvent?.({ type: "computer.step", text: stepText(step) });
    },
    answer: (id, approved) => settle(id, approved),
    cancelAll() {
      for (const id of [...waiting.keys()]) settle(id, false);
    },
  };
}
