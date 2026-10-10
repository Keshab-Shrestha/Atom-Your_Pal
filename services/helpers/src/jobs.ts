// ADR-081: the helpers and the life of a job. Pure: no storage, no clock.

export const HELPERS = [
  { id: "sid", name: "Sid", available: true },
  { id: "kame", name: "Kame", available: false },
  { id: "puff", name: "Puff", available: false },
] as const;

export type HelperId = (typeof HELPERS)[number]["id"];
export type JobState = "queued" | "running" | "done" | "failed" | "stopped";

export class HelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelperError";
  }
}

const MOVES: Record<JobState, readonly JobState[]> = {
  queued: ["running", "stopped"],
  running: ["done", "failed", "stopped"],
  done: [],
  failed: [],
  stopped: [],
};

export const isFinal = (state: JobState) => MOVES[state].length === 0;

export function canMove(from: JobState, to: JobState): boolean {
  return MOVES[from].includes(to);
}

/** The state after a move. Throws HelperError for a move the job's life does not allow. */
export function move(from: JobState, to: JobState): JobState {
  if (!canMove(from, to)) throw new HelperError(`A ${from} job cannot become ${to}.`);
  return to;
}

export function findHelper(id: string) {
  return HELPERS.find((h) => h.id === id);
}
