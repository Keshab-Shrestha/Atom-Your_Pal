import { createHash } from "node:crypto";
import { readSkillPage, userSkillsDir } from "./skills.ts";
import type { IslandBrain, IslandMemory } from "./island-types.ts";

export type ArkKnowledgeQuery =
  | { kind: "agent"; agent: string }
  | { kind: "memory"; id: number }
  | { kind: "search"; query: string }
  | { kind: "note"; id: number }
  | { kind: "skill"; name: string; source: "ark" | "personal"; file: string; offset: number };
export type ArkKnowledgeCommand = { type: "ark.knowledge"; request: string; input: ArkKnowledgeQuery };
export type ArkKnowledgeResponse = { type: "ark.knowledge.result"; request: string; value?: unknown; error?: string };

export function parseArkKnowledge(value: Record<string, unknown>): ArkKnowledgeCommand | undefined {
  if (typeof value.request !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.request)) return;
  const input = value.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return;
  const base = { type: "ark.knowledge" as const, request: value.request };
  if (input.kind === "agent" && typeof input.agent === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(input.agent)) return { ...base, input: { kind: "agent", agent: input.agent } };
  if (input.kind === "search" && typeof input.query === "string" && input.query.trim()) return { ...base, input: { kind: "search", query: input.query } };
  if ((input.kind === "note" || input.kind === "memory") && typeof input.id === "number" && Number.isSafeInteger(input.id) && input.id > 0) return { ...base, input: { kind: input.kind, id: input.id } };
  if (input.kind === "skill" && typeof input.name === "string" && (input.source === "ark" || input.source === "personal") && typeof input.file === "string" && typeof input.offset === "number" && Number.isSafeInteger(input.offset) && input.offset >= 0) return { ...base, input: { kind: "skill", name: input.name, source: input.source, file: input.file, offset: input.offset } };
  return;
}

export function noteRevision(note: { id: number; title: string; body: string; updatedAt: string }): string {
  return createHash("sha256").update(JSON.stringify([note.id, note.title, note.body, note.updatedAt])).digest("hex");
}

export function readArkKnowledge(query: ArkKnowledgeQuery, ports: { memory?: IslandMemory; brain?: IslandBrain; skillsDir?: string; agentPolicy?: (agent: string) => unknown }) {
  if (query.kind === "agent") {
    if (!ports.agentPolicy) throw new Error("Agent access policies are unavailable.");
    return ports.agentPolicy(query.agent);
  }
  if (query.kind === "memory") {
    const fact = ports.memory?.list().find((item) => item.id === query.id);
    if (!fact) throw new Error("That saved fact is unavailable.");
    return { kind: "memory", id: fact.id, text: fact.text };
  }
  if (query.kind === "search") {
    if (!ports.memory) throw new Error("Workspace memory is unavailable.");
    const terms = query.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const matches = ports.memory.search?.(query.query, 21) ?? ports.memory.list().filter((fact) => terms.some((term) => fact.text.toLocaleLowerCase().includes(term)));
    return { kind: "search", query: query.query, facts: matches.slice(0, 20).map(({ id, text }) => ({ id, text })), moreFacts: matches.length > 20, notes: ports.brain?.search(query.query) ?? [] };
  }
  if (query.kind === "note") {
    const note = ports.brain?.note(query.id);
    if (!note || note.ghost) throw new Error("That note is unavailable.");
    return { kind: "note", id: note.id, title: note.title, body: note.body, updatedAt: note.updatedAt, revision: noteRevision(note), source: note.source ?? null };
  }
  const dir = query.source === "ark" ? ports.skillsDir : userSkillsDir();
  if (!dir) throw new Error("The skill library is unavailable.");
  const page = readSkillPage(query.name, query.file, query.offset, dir);
  if (!page) throw new Error("That skill page is unavailable or outside its library.");
  return { kind: "skill", ...page, source: query.source, nextOffset: page.nextOffset ?? null };
}
