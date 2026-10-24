// When to start the runtime again after it exits. A port of RestartPolicy.swift (the Swift app is being replaced, ADR-201);
// the values are the Swift code's, not the older text in docs/island-protocol.md.

/** Exit code the runtime uses for a configuration error: show it, do not restart. */
export const CONFIG_ERROR_EXIT_CODE = 78;

export type RestartDecision =
  /** The caller asked it to stop: nothing to do. */
  | { kind: "stay" }
  | { kind: "restart"; afterSeconds: number }
  | { kind: "configError" }
  /** Too many quick failures in a row: something needs fixing first. */
  | { kind: "giveUp" };

export interface RestartPolicyOptions {
  /** Waits before successive restarts, in seconds. The last value repeats. */
  delays?: number[];
  /** A runtime that ran at least this long counts as healthy: the next failure starts the delays over. */
  stableAfterSeconds?: number;
  maxConsecutiveFailures?: number;
}

export class RestartPolicy {
  private readonly delays: number[];
  private readonly stableAfter: number;
  private readonly maxFailures: number;
  private failures = 0;

  constructor(options: RestartPolicyOptions = {}) {
    this.delays = options.delays ?? [1, 2, 4, 8, 15, 30];
    this.stableAfter = options.stableAfterSeconds ?? 30;
    this.maxFailures = options.maxConsecutiveFailures ?? 6;
    if (this.delays.length === 0) throw new Error("RestartPolicy needs at least one delay.");
  }

  /** Records an exit and decides the next step. `exitCode` is the process status, or 128 + signal when it was killed. */
  decide(exitCode: number, uptimeSeconds: number, requested: boolean): RestartDecision {
    if (requested) return { kind: "stay" };
    if (exitCode === CONFIG_ERROR_EXIT_CODE) return { kind: "configError" };
    if (uptimeSeconds >= this.stableAfter) this.failures = 0;
    this.failures += 1;
    if (this.failures > this.maxFailures) return { kind: "giveUp" };
    return { kind: "restart", afterSeconds: this.delays[Math.min(this.failures - 1, this.delays.length - 1)]! };
  }

  /** Forget past failures, e.g. when the user restarts ATOM by hand. */
  reset(): void {
    this.failures = 0;
  }
}
