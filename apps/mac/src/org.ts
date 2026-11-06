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
    "Give work for an agent with a lead to that lead (or plan it with plan_work); the lead hands parts to its people. Call such an agent directly only when the user named it.";
}

/** ADR-272: the most agents one task from the main thread may start below it, at every level together. */
export const MAX_TEAM_CHILDREN = 6;

/** Whom an agent may hand work to: its direct reports, and its peers (the same lead, or both report to ARK). Sorted. */
export function callable(agent: string, map: ReportsTo, agentIds: readonly string[]): { reports: string[]; peers: string[] } {
  const ids = [...agentIds].sort();
  return {
    reports: ids.filter((id) => id !== agent && map[id] === agent),
    peers: ids.filter((id) => id !== agent && map[id] === map[agent]),
  };
}

/**
 * ADR-272: may `caller` (an agent at work) hand a task to `target`? Only down to a direct report or across to a peer:
 * never itself, never up the chart. undefined: yes; else the refusal, which says what to do instead.
 */
export function delegationProblem(caller: string, target: string, map: ReportsTo, agentIds: readonly string[], name: (id: string) => string | undefined): string | undefined {
  const label = (id: string) => name(id) ?? id;
  if (target === caller) return "You cannot give a task to yourself. Do the work, or end your turn with your report.";
  if ((leadsOf(caller, map) ?? []).includes(target)) return `${label(target)} is above you in the team. Do not call up: end your turn, and your report goes back to the one who gave you the task.`;
  const { reports, peers } = callable(caller, map, agentIds);
  if (reports.includes(target) || peers.includes(target)) return undefined;
  const can = [...reports, ...peers].map((id) => `${label(id)} (${id})`);
  return `${label(target)} is not one of your reports or peers. ${can.length ? `You may call: ${can.join(", ")}.` : "You have no one to call."} Otherwise end your turn and say in your report who should do it.`;
}

/** A sub-agent's team line (ADR-272), so it calls only whom the code allows. "" when it has no one to call. */
export function teamLine(agent: string, map: ReportsTo, agentIds: readonly string[], name: (id: string) => string | undefined): string {
  const { reports, peers } = callable(agent, map, agentIds);
  if (!reports.length && !peers.length) return "";
  const list = (ids: string[]) => ids.map((id) => `${name(id) ?? id} (${id})`).join(", ");
  return [
    reports.length ? `Your reports: ${list(reports)}.` : "",
    peers.length ? `Your peers: ${list(peers)}.` : "",
    "You may give a part of your task to one of them with the Agent tool (subagent_type: its id). Its report comes back to you; use it in your own report.",
    "You report only by ending your turn: you have no tool to message ARK or the one who called you while you work.",
  ].filter(Boolean).join("\n");
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
