import { noteRevision } from "./ark-knowledge.ts";
import type { IslandBrain, IslandHelpers } from "./island-types.ts";
import type { SoulItem } from "./island-items.ts";

export type ArkMutation =
  | { kind: "agent.create"; name: string; role: string; kit: "research" | "folders" | "think"; personality: string; howItWorks: string; rules: string }
  | { kind: "agent.soul"; agent: string; expectedVersion: number; soul: SoulItem }
  | { kind: "agent.skills"; agent: string; expected: string[]; skills: string[] }
  | { kind: "note.save"; id?: number; expectedRevision?: string; title: string; body: string };
export type ArkMutationCommand = { type: "ark.mutate"; request: string; input: ArkMutation };
export type ArkMutationResponse = { type: "ark.mutation.result"; request: string; value?: unknown; error?: string };

export function parseArkMutation(value: Record<string, unknown>): ArkMutationCommand | undefined {
  if (typeof value.request !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.request)) return;
  const input = value.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const command = (input: ArkMutation): ArkMutationCommand => ({ type: "ark.mutate", request: value.request as string, input });
  if (input.kind === "agent.create" && typeof input.name === "string" && typeof input.role === "string" && (input.kit === "research" || input.kit === "folders" || input.kit === "think") && typeof input.personality === "string" && typeof input.howItWorks === "string" && typeof input.rules === "string") return command({ kind: input.kind, name: input.name, role: input.role, kit: input.kit, personality: input.personality, howItWorks: input.howItWorks, rules: input.rules });
  if (input.kind === "agent.soul" && typeof input.agent === "string" && typeof input.expectedVersion === "number" && Number.isSafeInteger(input.expectedVersion)) {
    const soul = input.soul as Record<string, unknown> | undefined;
    if (soul && typeof soul.name === "string" && typeof soul.personality === "string" && typeof soul.howItWorks === "string" && typeof soul.rules === "string" && typeof soul.lessons === "string") return command({ kind: input.kind, agent: input.agent, expectedVersion: input.expectedVersion, soul: { name: soul.name, personality: soul.personality, howItWorks: soul.howItWorks, rules: soul.rules, lessons: soul.lessons } });
  }
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((item) => typeof item === "string");
  if (input.kind === "agent.skills" && typeof input.agent === "string" && strings(input.expected) && strings(input.skills)) return command({ kind: input.kind, agent: input.agent, expected: input.expected, skills: input.skills });
  if (input.kind === "note.save" && typeof input.title === "string" && typeof input.body === "string" && (input.id === undefined || (typeof input.id === "number" && Number.isSafeInteger(input.id) && input.id > 0 && typeof input.expectedRevision === "string"))) return command({ kind: input.kind, title: input.title, body: input.body, ...(typeof input.id === "number" ? { id: input.id, expectedRevision: input.expectedRevision as string } : {}) });
  return;
}

export function mutateArk(input: ArkMutation, ports: { helpers?: IslandHelpers; brain?: IslandBrain; interruptAnalysis?(): void }) {
  if (input.kind === "note.save") {
    const brain = ports.brain;
    if (!brain) throw new Error("Workspace notes are unavailable.");
    if (input.id !== undefined) {
      const current = brain.note(input.id);
      if (!current || current.ghost) throw new Error("That note is unavailable.");
      if (!input.expectedRevision || noteRevision(current) !== input.expectedRevision) throw new Error("This note changed while you were editing. Reopen it before saving.");
    }
    ports.interruptAnalysis?.();
    const note = brain.save(input);
    return { entityId: String(note.id), notes: brain.graph().nodes };
  }
  const helpers = ports.helpers;
  if (!helpers) throw new Error("Workspace agents are unavailable.");
  let entityId: string;
  if (input.kind === "agent.create") {
    const before = new Set(helpers.list().map((agent) => agent.id));
    helpers.createAgent(input);
    const created = helpers.list().find((agent) => !before.has(agent.id));
    if (!created) throw new Error("The new agent's saved state could not be confirmed.");
    entityId = created.id;
  } else {
    const current = helpers.list().find((agent) => agent.id === input.agent);
    if (!current) throw new Error("That agent is unavailable.");
    if (input.kind === "agent.soul") {
      if (current.soulVersion !== input.expectedVersion) throw new Error("This agent changed while you were editing. Reopen it before saving.");
      helpers.saveSoul(input.agent, input.soul);
    } else {
      if (JSON.stringify([...current.skills].sort()) !== JSON.stringify([...input.expected].sort())) throw new Error("This agent's skills changed. Reopen the editor before saving.");
      helpers.setSkills(input.agent, input.skills);
    }
    entityId = current.id;
  }
  return { entityId, agents: helpers.list() };
}
