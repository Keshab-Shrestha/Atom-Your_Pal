import type { HelperStore } from "@atom/helpers";
import type { Tool } from "@atom/tool-engine";

/**
 * ATOM tools for the main agent that reach into what ATOM already keeps (docs/v2-plan.md items 1 and 2):
 * `search_chats` finds past chats, `propose_skill` suggests a skill from a finished task. Logs counts and ids only.
 */

const cut = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

export interface ChatHit {
  id: string;
  title: string;
  snippet: string;
  updatedAt: Date;
}

/** At most this many hits come back, each cut short, so a search costs a few hundred tokens. */
export const SEARCH_HITS = 5;

export function createSearchChatsTool(options: { search(query: string): ChatHit[]; onSearch?(event: { hits: number }): void }): Tool {
  return {
    spec: {
      name: "search_chats",
      description: "Search the user's past chats by words. Returns up to 5 hits: the chat's title, its date and a short snippet. Use it when the user refers to something said before.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to look for" } }, required: ["query"] },
    },
    capability: { title: "Search past chats", examples: ["What did we say about the mortgage last week?", "Find the chat about my trip"] },
    run(input) {
      const query = String(input.query ?? "").trim();
      if (!query) throw new Error("The query is empty.");
      const hits = options.search(query).slice(0, SEARCH_HITS);
      options.onSearch?.({ hits: hits.length });
      if (!hits.length) return "No past chat matches.";
      return hits.map((h) => `- ${cut(h.title, 60)} (${h.updatedAt.toISOString().slice(0, 10)}): ${cut(h.snippet, 160)}`).join("\n");
    },
  };
}

export function createProposeSkillTool(options: {
  store: Pick<HelperStore, "proposeSkill">;
  /** The newest finished task (an agent's, not Tinker's): what `job` defaults to, because the main agent does not see task numbers. */
  latestDone?(): number | undefined;
  onProposed?(event: { job: number; skill: string }): void;
}): Tool {
  return {
    spec: {
      name: "propose_skill",
      description:
        "After a finished task that went well and teaches a way of working you would reuse, and only when the user agreed to save it as a skill, propose a skill. " +
        "job: the finished task's number (leave it out for the task that finished last). " +
        "name: 2 to 41 lower-case letters, digits and dashes. description: one sentence on when to use it. body: the steps in plain Markdown, general " +
        "enough to reuse, with no personal data. The user approves or rejects it; nothing uses it before.",
      inputSchema: {
        type: "object",
        properties: {
          job: { type: "number", description: "The finished task's number" },
          name: { type: "string", description: "Lower-case letters, digits and dashes" },
          description: { type: "string", description: "When to use the skill, one sentence" },
          body: { type: "string", description: "The steps, plain Markdown" },
        },
        required: ["name", "description", "body"],
      },
    },
    run(input) {
      const job = input.job === undefined ? (options.latestDone?.() ?? NaN) : Number(input.job);
      if (!Number.isInteger(job)) throw new Error("No finished task to make a skill from. Give job: the task's number.");
      const draft = options.store.proposeSkill(job, { name: String(input.name ?? ""), description: String(input.description ?? ""), body: String(input.body ?? "") });
      options.onProposed?.({ job, skill: draft.name });
      return `Skill "${draft.name}" is proposed. The user approves or rejects it in the ATOM window.`;
    },
  };
}

/**
 * 2026-10-16: the user said in a chat that one of ATOM's skills did not work well (a skill used with `/name` has no task, so Tinker's task-based edit cannot
 * run). The main agent writes the improved steps itself; the user still accepts or rejects them in the ATOM window, and Undo works.
 */
export function createImproveSkillTool(options: { store: Pick<HelperStore, "proposeSkillEdit">; onProposed?(event: { skill: string }): void }): Tool {
  return {
    spec: {
      name: "improve_skill",
      description:
        "Only when the user says that one of ATOM's own skills did not work well or should change: propose an improved version. skill: the skill's name. " +
        "reason: one or two sentences on what went wrong and what the change fixes. body: the complete new steps in plain Markdown (not a diff), general enough " +
        "to reuse, with no personal data. The user accepts or rejects it; nothing changes before that. Never use it on your own idea.",
      inputSchema: {
        type: "object",
        properties: {
          skill: { type: "string", description: "The skill's name" },
          reason: { type: "string", description: "What went wrong, and what the change fixes" },
          body: { type: "string", description: "The complete new steps, plain Markdown" },
        },
        required: ["skill", "reason", "body"],
      },
    },
    run(input) {
      const skill = String(input.skill ?? "").trim();
      const edit = options.store.proposeSkillEdit(skill, { body: String(input.body ?? ""), reason: String(input.reason ?? "") });
      options.onProposed?.({ skill });
      return `An edit to "${skill}" is proposed (#${edit.id}). The user accepts or rejects it in the ATOM window.`;
    },
  };
}

