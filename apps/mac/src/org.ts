import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 2026-11-05 (Keshab: levels like an office): who reports to whom. ARK is the CEO; any agent may report to another agent
 * (its lead); an agent with no lead reports to ARK. An agent with reports is a lead, one without is a worker. This is not
 * ADR-095's Manager files (ADR-110 N5 removed them). Kept in data/org.json, owner-only. Pure, apart from the store.
 */
export type ReportsTo = Readonly<Record<string, string>>;

/** The most levels below ARK: ARK → lead → lead → lead → worker. */
export const MAX_ORG_DEPTH = 4;

/** The agents that can sit in the chart: every agent but Tinker (it only reviews). */
export function orgAgentIds(list: readonly { id: string; role: string }[]): string[] {
  return list.filter((h) => h.role !== "improver").map((h) => h.id);
}

/** The leads above an agent, nearest first; undefined when the chain loops. */
function leadsOf(agent: string, map: ReportsTo): string[] | undefined {
  const chain: string[] = [];
  for (let lead = map[agent]; lead !== undefined; lead = map[lead]) {
    if (lead === agent || chain.includes(lead)) return undefined;
    chain.push(lead);
  }
  return chain;
}

/** Each agent's level below ARK is its leads plus one; undefined for an agent in a loop. */
const fits = (agent: string, map: ReportsTo): boolean => {
  const chain = leadsOf(agent, map);
  return chain !== undefined && chain.length + 1 <= MAX_ORG_DEPTH;
};

/**
 * A change from the window, checked: both agents exist, an agent does not lead itself, no loop, at most four levels
 * below ARK. `lead` null: the agent reports to ARK. Returns the new map; throws plain words on refusal.
 */
export function checkReportsTo(agent: string, lead: string | null, current: ReportsTo, agentIds: readonly string[]): Record<string, string> {
  if (!agentIds.includes(agent)) throw new Error("That agent is not on your team.");
  const next: Record<string, string> = Object.fromEntries(Object.entries(current).filter(([id]) => id !== agent));
  if (lead === null) return next;
  if (!agentIds.includes(lead)) throw new Error("The lead is not on your team.");
  if (lead === agent) throw new Error("An agent cannot lead itself.");
  next[agent] = lead;
  if (leadsOf(agent, next) === undefined) throw new Error(`${lead} already works under ${agent}, so ${agent} cannot report to ${lead}.`);
  if (!Object.keys(next).every((id) => fits(id, next))) throw new Error(`The team can be at most ${MAX_ORG_DEPTH} levels below ARK.`);
  return next;
}

/**
 * The chart as it stands: an entry of an agent that is gone is dropped; a report whose lead is gone moves up to that
 * lead's own lead (or ARK). Entries in a loop or too deep (a hand-edited file) are dropped. Sorted by agent id.
 */
export function resolveOrg(raw: ReportsTo, agentIds: readonly string[]): Record<string, string> {
  const ids = new Set(agentIds);
  const moved: Record<string, string> = {};
  for (const agent of Object.keys(raw).sort()) {
    if (!ids.has(agent)) continue;
    const seen = new Set([agent]);
    let lead: string | undefined = raw[agent];
    while (lead !== undefined && !ids.has(lead) && !seen.has(lead)) { seen.add(lead); lead = raw[lead]; }
    if (lead !== undefined && ids.has(lead) && lead !== agent) moved[agent] = lead;
  }
  return Object.fromEntries(Object.entries(moved).filter(([agent]) => fits(agent, moved)));
}

/**
 * The main agent's team line and routing rule; "" when no agent has a lead (no cost). Deterministic (sorted by id),
 * so it changes only when the chart or a name changes. `name` maps an agent id to its name.
 */
export function orgPrompt(map: ReportsTo, name: (id: string) => string | undefined): string {
  const teams = new Map<string, string[]>();
  for (const agent of Object.keys(map).sort()) teams.set(map[agent]!, [...(teams.get(map[agent]!) ?? []), agent]);
  if (!teams.size) return "";
  const label = (id: string) => name(id) ?? id;
  const lines = [...teams.keys()].sort().map((lead) => `${label(lead)} leads ${teams.get(lead)!.map(label).join(", ")}`);
  return `Team: ${lines.join("; ")}.\n` +
    "Work in a lead's area goes through the lead: call plan_work with a first portion for the lead (split the work and name which of its people does what), " +
    "then portions for its people after it, then a last portion for the lead to review their reports. Small single-step work may go straight to the worker.";
}

export interface OrgStore {
  /** The chart as it stands now (resolveOrg). */
  map(): Record<string, string>;
  /** Saves one change (checkReportsTo); throws plain words on refusal. */
  set(agent: string, lead: string | null): Record<string, string>;
  /** Writes the chart as it stands (after an agent is removed); true when that changed the file. */
  prune(): boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** data/org.json: `{ version: 1, reportsTo: { agent: lead } }`, written whole (a temp file, then rename), owner-only. */
export function createOrgStore(path: string, agentIds: () => readonly string[], log?: (message: string) => void): OrgStore {
  let raw: Record<string, string> | undefined;
  let unreadable = false;
  const read = (): Record<string, string> => {
    if (raw) return raw;
    if (!existsSync(path)) return (raw = {});
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      const map = isObject(parsed) && isObject(parsed.reportsTo) ? parsed.reportsTo : {};
      raw = Object.fromEntries(Object.entries(map).filter((e): e is [string, string] => typeof e[1] === "string"));
    } catch (error) {
      // A broken file reads as no chart and is never overwritten: Keshab may have edited it by hand.
      unreadable = true;
      log?.(`org.json could not be read: ${error instanceof Error ? error.message : String(error)}`);
      raw = {};
    }
    return raw;
  };
  const write = (map: Record<string, string>) => {
    if (unreadable) throw new Error("data/org.json is not valid JSON. Fix or delete it first.");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, reportsTo: map }, null, 2), { mode: 0o600 });
    renameSync(temp, path);
    raw = map;
    return { ...map };
  };
  const map = () => resolveOrg(read(), agentIds());
  return {
    map,
    set: (agent, lead) => write(checkReportsTo(agent, lead, map(), agentIds())),
    prune() {
      const now = map();
      if (unreadable || JSON.stringify(now) === JSON.stringify(read())) return false;
      write(now);
      return true;
    },
  };
}
