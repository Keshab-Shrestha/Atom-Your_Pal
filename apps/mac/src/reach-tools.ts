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

export function createProposeSkillTool(options: { store: Pick<HelperStore, "proposeSkill">; onProposed?(event: { job: number; skill: string }): void }): Tool {
  return {
    spec: {
      name: "propose_skill",
      description:
        "After a finished task that went well and teaches a way of working you would reuse, propose a skill. job: the finished task's number. " +
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
        required: ["job", "name", "description", "body"],
      },
    },
    run(input) {
      const job = Number(input.job);
      if (!Number.isInteger(job)) throw new Error("job must be a task number.");
      const draft = options.store.proposeSkill(job, { name: String(input.name ?? ""), description: String(input.description ?? ""), body: String(input.body ?? "") });
      options.onProposed?.({ job, skill: draft.name });
      return `Skill "${draft.name}" is proposed. The user approves or rejects it in the ATOM window.`;
    },
  };
}
