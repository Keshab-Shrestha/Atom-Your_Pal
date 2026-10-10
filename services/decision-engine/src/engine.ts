// ADR-083: the Decision Engine boundary (CLAUDE.md §10). It decides only which model tier a worker job gets:
// never what a worker may do, which folders it may touch, or whether an action needs approval.

export const TIERS = ["small", "medium", "large"] as const;
export type Tier = (typeof TIERS)[number];

/** The difficulty rubric, lowest rung first (ADR-083). The score is a float index into it. */
export const DIFFICULTY_RUNGS = ["trivial", "easy", "moderate", "hard"] as const;
export type Rung = (typeof DIFFICULTY_RUNGS)[number];

/** Below SMALL_BELOW → small; below LARGE_FROM → medium; else large (ADR-083). The only place these live. */
export const SMALL_BELOW = 0.75;
export const LARGE_FROM = 2.25;

/** What a job gets when the engine cannot answer (missing, slow, failed): the role's default tier. */
export const DEFAULT_TIER: Tier = "medium";

export interface TierChoice {
  tier: Tier;
  /** The engine's raw score, when it answered. A ranking, not a probability. */
  score?: number;
  /** The rung nearest the score ("trivial" … "hard"), when it answered. */
  label?: Rung;
  source: "laya" | "fallback";
}

export interface DecisionEngine {
  /** Never throws and never waits long: any failure is `source: "fallback"` with the default tier. */
  chooseTier(task: string, role: string): Promise<TierChoice>;
  /** Gets ready ahead of the first call (starts a server); returns at once and never throws. */
  warm(): void;
  /** Stops whatever the engine runs (a server process). Later calls fall back. */
  close(): Promise<void>;
}

export function tierFromScore(score: number): { tier: Tier; label: Rung } {
  const tier: Tier = score < SMALL_BELOW ? "small" : score < LARGE_FROM ? "medium" : "large";
  const rung = Math.min(DIFFICULTY_RUNGS.length - 1, Math.max(0, Math.round(score)));
  return { tier, label: DIFFICULTY_RUNGS[rung]! };
}
