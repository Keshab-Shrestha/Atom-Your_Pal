// 2026-10-15: the API-equivalent dollars of a run, from its tokens. The plan does not charge them; they say how much a run used.
//
// Why here and not from Claude Code's own cost: its `total_cost_usd` is a running total for the whole session, so a chat row
// held the cost of every background agent too, while the agents' own rows held none. Pricing each row from its own tokens
// makes each row, each worker and each model right, and the total the same as before.
//
// The rates were measured, not assumed: one tiny call per model, and the SDK's per-model `costUSD` (`costBasis: "list"`)
// compared with the tokens (pricing.test.ts keeps those numbers). Dollars per million tokens.

import type { TokenCounts } from "./usage.ts";

export interface Rates {
  input: number;
  output: number;
}

/** List prices by model family (no date suffix). */
export const RATES: Readonly<Record<string, Rates>> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache: a read is a tenth of the input price; a write is 1.25 times (kept 5 minutes) or 2 times (kept 1 hour). */
export const CACHE_READ = 0.1;
export const CACHE_WRITE_5M = 1.25;
export const CACHE_WRITE_1H = 2;

/** A model id's rates, with or without a date suffix ("claude-haiku-4-5-20251001"); undefined for a model not listed. */
export function ratesFor(model: string): Rates | undefined {
  const id = model.toLowerCase().replace(/-\d{8}$/, "");
  return RATES[id];
}

/**
 * The dollars of one run; undefined when the model has no listed price. `ttl` is how long the written cache is kept: "5m",
 * or "1h" (the default: ATOM asks Claude Code for the one-hour cache). Rounded to a millionth of a dollar.
 */
export function dollarsFor(model: string, tokens: TokenCounts, ttl?: string): number | undefined {
  const rates = ratesFor(model);
  if (!rates) return undefined;
  const write = ttl === "5m" ? CACHE_WRITE_5M : CACHE_WRITE_1H;
  const total =
    (tokens.input * rates.input + tokens.output * rates.output + tokens.cacheRead * rates.input * CACHE_READ + tokens.cacheWrite * rates.input * write) /
    1_000_000;
  return Math.round(total * 1e6) / 1e6;
}

/**
 * Claude's web search is billed per search, not per token: $10 per 1,000 searches (list price). Claude Code's own cost for a run
 * includes it; before 2026-10-16 it was in no row, which was most of the gap between a research run's reported and priced dollars.
 */
export const WEB_SEARCH_DOLLARS = 0.01;

/** The dollars of `count` web searches; 0 for a count that is not a positive number. */
export function webSearchDollars(count: number | undefined): number {
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.round(count * WEB_SEARCH_DOLLARS * 1e6) / 1e6 : 0;
}

