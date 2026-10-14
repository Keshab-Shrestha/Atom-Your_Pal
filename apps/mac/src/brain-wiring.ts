import { DEFAULT_MAX_EPISODES, DEFAULT_MAX_MEMORIES, type BrainNote, type BrainSource, type MemoryStore } from "@atom/memory";
import type { LogFields } from "@atom/shared";
import type { Tool } from "@atom/tool-engine";
import type { IslandBrain } from "./island.ts";
import type { BrainNoteItem } from "./island-items.ts";

/**
 * The second brain in the runtime: ATOM's memory mirrored into notes (facts, conversation notes, kept chats, projects),
 * ATOM's own links, three tools for the main agent (`brain_note`, `brain_open`, `brain_search`) and the window's view.
 * Note text is the user's own: the log gets counts and ids only.
 */

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const cut = (text: string, max: number) => (flat(text).length > max ? `${flat(text).slice(0, max - 1).trimEnd()}…` : flat(text));
const day = (d: Date) => d.toISOString().slice(0, 10);

export interface BrainWiring {
  island: IslandBrain;
  tools: Tool[];
  /** Mirrors memory into notes and rebuilds ATOM's links. Cheap when nothing changed; never throws. */
  sync(): void;
}

export function createBrainWiring(options: {
  memory: MemoryStore;
  log: { info(event: string, fields?: LogFields): void; warn(event: string, fields?: LogFields): void };
}): BrainWiring {
  const { memory, log } = options;
  const brain = memory.brain;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());

  const noteItem = (note: BrainNote): BrainNoteItem => ({
    id: note.id,
    title: note.title,
    body: note.body,
    kind: note.kind,
    ghost: note.ghost,
    tags: note.tags,
    links: brain.links(note.id),
    backlinks: brain.backlinks(note.id),
    updatedAt: note.updatedAt.toISOString(),
  });

  function sync() {
    try {
      const items: BrainSource[] = [
        ...memory.recent(DEFAULT_MAX_MEMORIES).map((m) => ({ ref: `memory:${m.id}`, title: cut(m.text, 60), body: m.text, kind: "memory" as const })),
        ...memory.episodes(DEFAULT_MAX_EPISODES).map((e) => ({ ref: `episode:${e.id}`, title: `Chat note ${day(e.endedAt)}`, body: e.summary, kind: "episode" as const })),
        ...memory.chatIndex.kept().map((c) => ({ ref: `chat:${c.chatId}`, title: cut(c.title || "Kept chat", 60), body: c.summary, kind: "chat" as const })),
        ...memory.projects.list().filter((p) => !p.archived).map((p) => ({ ref: `project:${p.id}`, title: `Project ${cut(p.name, 50)}`, body: `The project ${p.name}: ${memory.projects.chatCount(p.id)} chats.`, kind: "project" as const })),
      ];
      const done = brain.sync(items, ["memory:", "episode:", "chat:", "project:"]);
      const links = brain.autolink();
      log.info("brain.sync", { ...done, links, notes: brain.count() });
      changed();
    } catch (error) {
      log.warn("brain.sync_failed", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  const island: IslandBrain = {
    graph() {
      const g = brain.graph();
      return {
        nodes: g.nodes.map((n) => ({ id: n.id, title: n.title, kind: n.kind, ghost: n.ghost, tags: n.tags, degree: n.degree, updatedAt: n.updatedAt.toISOString() })),
        edges: g.edges,
        omitted: g.omitted,
        tags: brain.tags(),
      };
    },
    note: (id) => {
      const note = brain.get(id);
      return note && noteItem(note);
    },
    save(input) {
      const note = brain.save(input);
      log.info("brain.save", { note: note.id, renamed: input.id !== undefined });
      brain.autolink();
      changed();
      return noteItem(brain.get(note.id) ?? note);
    },
    remove(id) {
      const done = brain.remove(id);
      if (done) {
        log.info("brain.delete", { note: id });
        brain.autolink();
        changed();
      }
      return done;
    },
    search: (query) => brain.search(query, 12),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const tools: Tool[] = [
    {
      spec: {
        name: "brain_note",
        description:
          "Write or update a note in the user's second brain. title: a short name. body: Markdown; link other notes with [[Title]] and tag with #tag. " +
          "Use it when the user says to note, file or remember something longer than a fact, or links ideas. Prefer linking to notes that exist (brain_search first).",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string", description: "The note's name" }, body: { type: "string", description: "Markdown with [[links]] and #tags" } },
          required: ["title", "body"],
        },
      },
      capability: { title: "Second brain", examples: ["Note this in my second brain: the mesh plan", "What links to my Oslo trip note?"] },
      run(input) {
        const note = island.save({ title: String(input.title ?? ""), body: String(input.body ?? "") });
        return `Saved "${note.title}"${note.links.length ? ` with ${note.links.length} link${note.links.length === 1 ? "" : "s"}` : ""}.`;
      },
    },
    {
      spec: {
        name: "brain_open",
        description: "Read one note of the second brain by its title: its text, the notes it links to and the notes that link to it.",
        inputSchema: { type: "object", properties: { title: { type: "string", description: "The note's title" } }, required: ["title"] },
      },
      run(input) {
        const note = brain.byTitle(String(input.title ?? ""));
        if (!note || note.ghost) return `There is no note called "${cut(String(input.title ?? ""), 60)}". Use brain_search to find one.`;
        const out = brain.links(note.id).map((l) => l.title);
        const back = brain.backlinks(note.id).map((l) => l.title);
        return [
          `# ${note.title} (${note.kind})`,
          cut(note.body, 3000) || "(empty)",
          out.length ? `Links to: ${out.slice(0, 20).join(", ")}` : "",
          back.length ? `Linked from: ${back.slice(0, 20).join(", ")}` : "",
        ].filter(Boolean).join("\n");
      },
    },
    {
      spec: {
        name: "brain_search",
        description: "Search the second brain by words. Returns up to 8 notes: title, kind and a snippet.",
        inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to look for" } }, required: ["query"] },
      },
      run(input) {
        const hits = brain.search(String(input.query ?? ""), 8);
        return hits.length ? hits.map((h) => `- ${h.title} (${h.kind}): ${cut(h.snippet, 140)}`).join("\n") : "No note matches.";
      },
    },
  ];

  return { island, tools, sync };
}
