import type { DatabaseSync } from "node:sqlite";
import type { Message } from "@zeno/contracts";
import { ftsQuery, STOP_WORDS } from "./store.ts";

// ADR-097 item 3: chats Keshab keeps in memory, at three depths: a summary of the chat (level 1), its topic sections with
// a short heading each (level 2) and its exact lines (level 3). A copy, so it outlives the chat itself. A search ranks each
// level by keywords (SQLite FTS5) and by meaning (local embeddings, when given), merges the two with reciprocal rank
// fusion and goes top-down: the best chats, then the best sections inside them, then the best lines inside those.

/** Messages per topic section. */
export const SECTION_SIZE = 8;
/** Longest line kept as one piece; a longer message is split. */
export const MAX_LINE_CHARS = 800;
export const MAX_DIGEST_SUMMARY = 600;
export const MAX_HEADING = 80;
/** How many chats, then sections, then lines a search keeps at each level. */
export const TOP_CHATS = 3;
export const TOP_SECTIONS = 3;
export const TOP_LINES = 6;
/** Below this cosine similarity a meaning match is ignored (all-MiniLM-L6-v2 scale). */
export const MIN_SIMILARITY = 0.3;
/** Reciprocal rank fusion's constant. */
const RRF_K = 60;
const EMBED_BATCH = 32;

/** Texts to unit vectors (normalised, so cosine similarity is a dot product). */
export type Embed = (texts: string[]) => Promise<Float32Array[]>;

/** What the model (or the fallback) says about a chat: a summary and one heading per section, in order. */
export interface ChatDigest {
  summary: string;
  headings: string[];
}

export interface KeptChat {
  chatId: string;
  title: string;
  summary: string;
  messages: number;
  keptAt: Date;
}

/** One search result: the best lines of one section, with where they come from. */
export interface ChatHit {
  chatId: string;
  chatTitle: string;
  heading: string;
  lines: { role: "user" | "assistant"; text: string }[];
}

export interface ChatIndex {
  /** The newest first. */
  kept(): KeptChat[];
  isKept(chatId: string): boolean;
  count(): number;
  /** Stores (or replaces) a chat at the three depths. Vectors are left empty when `embed` is absent or fails. */
  keep(chatId: string, title: string, messages: readonly Message[], digest: ChatDigest, embed?: Embed): Promise<{ sections: number; lines: number; vectors: boolean }>;
  drop(chatId: string): boolean;
  /** Keywords always; meaning too when `embed` is given and works. */
  search(query: string, embed?: Embed): Promise<ChatHit[]>;
  /** Adds the vectors kept chats are missing (kept while the embedding model was unavailable). Returns how many. */
  fillVectors(embed: Embed): Promise<number>;
}

type Turn = { role: "user" | "assistant"; content: string };

/** The chat's user and assistant turns in sections of SECTION_SIZE messages. */
export function chatSections(messages: readonly Message[]): Turn[][] {
  const turns = messages.filter((m): m is Turn => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "");
  const sections: Turn[][] = [];
  for (let i = 0; i < turns.length; i += SECTION_SIZE) sections.push(turns.slice(i, i + SECTION_SIZE));
  return sections;
}

/** One message as pieces of at most MAX_LINE_CHARS, split at a space where possible. */
export function splitLine(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const pieces: string[] = [];
  let rest = clean;
  while (rest.length > MAX_LINE_CHARS) {
    const cut = rest.lastIndexOf(" ", MAX_LINE_CHARS);
    const at = cut > MAX_LINE_CHARS / 2 ? cut : MAX_LINE_CHARS;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** The most frequent content words of a text (deterministic). */
export function keywords(text: string, limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (word.length > 3 && !STOP_WORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** Used when the model is unavailable, so keeping a chat never fails: first lines and keywords. */
export function fallbackDigest(title: string, sections: readonly Turn[][]): ChatDigest {
  const all = sections.flat();
  const firstUser = all.find((t) => t.role === "user")?.content ?? title;
  const words = keywords(all.map((t) => t.content).join(" "));
  const summary = oneLine(`${title}. Started with: ${firstUser}${words.length ? ` Keywords: ${words.join(", ")}.` : ""}`, MAX_DIGEST_SUMMARY);
  const headings = sections.map((s) => {
    const first = s.find((t) => t.role === "user")?.content ?? s[0]?.content ?? "";
    return oneLine(first, MAX_HEADING) || "Section";
  });
  return { summary, headings };
}

/** The chat as numbered sections, for the model that writes the digest. Each message is cut to `perMessage` characters. */
export function digestBrief(title: string, sections: readonly Turn[][], perMessage = 400, maxChars = 30_000): string {
  const parts = [`Chat title: ${title}`];
  let size = parts[0]!.length;
  for (const [i, section] of sections.entries()) {
    const text = [`Section ${i + 1}:`, ...section.map((t) => `${t.role === "user" ? "Keshab" : "ATOM"}: ${oneLine(t.content, perMessage)}`)].join("\n");
    if (size + text.length > maxChars) {
      parts.push(`Section ${i + 1} and later: (left out, too long)`);
      break;
    }
    parts.push(text);
    size += text.length;
  }
  return parts.join("\n\n");
}

const toBlob = (v: Float32Array | undefined) => (v ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null);
const fromBlob = (b: unknown): Float32Array | undefined => {
  if (!(b instanceof Uint8Array) || b.byteLength % 4 !== 0 || b.byteLength === 0) return undefined;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i]! * b[i]!;
  return s;
};

async function embedAll(embed: Embed, texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) out.push(...(await embed(texts.slice(i, i + EMBED_BATCH))));
  if (out.length !== texts.length) throw new Error("The embedding model returned the wrong number of vectors.");
  return out;
}

/** Reciprocal rank fusion of ranked id lists: best first. */
export function fuse<T>(lists: readonly (readonly T[])[]): T[] {
  const score = new Map<T, number>();
  for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Ids ranked by similarity to `q`, those under MIN_SIMILARITY left out. */
function byMeaning<T>(q: Float32Array | undefined, rows: readonly { id: T; vec: unknown }[]): T[] {
  if (!q) return [];
  return rows
    .flatMap((r) => {
      const v = fromBlob(r.vec);
      const s = v ? dot(q, v) : -1;
      return s >= MIN_SIMILARITY ? [{ id: r.id, s }] : [];
    })
    .sort((a, b) => b.s - a.s)
    .map((r) => r.id);
}

export function openChatIndex(db: DatabaseSync, now: () => Date): ChatIndex {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kept_chats (
      chat_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      messages INTEGER NOT NULL,
      kept_at TEXT NOT NULL,
      vec BLOB
    );
    CREATE TABLE IF NOT EXISTS kept_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      heading TEXT NOT NULL,
      body TEXT NOT NULL,
      vec BLOB
    );
    CREATE INDEX IF NOT EXISTS kept_sections_chat ON kept_sections(chat_id);
    CREATE TABLE IF NOT EXISTS kept_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      text TEXT NOT NULL,
      vec BLOB
    );
    CREATE INDEX IF NOT EXISTS kept_lines_section ON kept_lines(section_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS kept_fts USING fts5(text, level UNINDEXED, ref UNINDEXED);
  `);
  const keptRows = db.prepare("SELECT chat_id, title, summary, messages, kept_at FROM kept_chats ORDER BY kept_at DESC");
  const isKeptRow = db.prepare("SELECT 1 FROM kept_chats WHERE chat_id = ?");
  const counter = db.prepare("SELECT count(*) AS n FROM kept_chats");
  const insertChat = db.prepare("INSERT INTO kept_chats (chat_id, title, summary, messages, kept_at, vec) VALUES (?, ?, ?, ?, ?, ?)");
  const insertSection = db.prepare("INSERT INTO kept_sections (chat_id, seq, heading, body, vec) VALUES (?, ?, ?, ?, ?)");
  const insertLine = db.prepare("INSERT INTO kept_lines (section_id, seq, role, text, vec) VALUES (?, ?, ?, ?, ?)");
  const insertFts = db.prepare("INSERT INTO kept_fts (text, level, ref) VALUES (?, ?, ?)");
  const ftsHits = db.prepare("SELECT ref FROM kept_fts WHERE kept_fts MATCH ? AND level = ? ORDER BY rank LIMIT 500");
  const chatVecs = db.prepare("SELECT chat_id AS id, title, vec FROM kept_chats");
  const sectionsOf = db.prepare("SELECT id, chat_id, heading, vec FROM kept_sections WHERE chat_id = ?");
  const linesOf = db.prepare("SELECT id, section_id, seq, role, text, vec FROM kept_lines WHERE section_id = ? ORDER BY seq");

  const removeLineWords = db.prepare(
    "DELETE FROM kept_fts WHERE level = 3 AND ref IN (SELECT CAST(l.id AS TEXT) FROM kept_lines l JOIN kept_sections s ON s.id = l.section_id WHERE s.chat_id = ?)",
  );
  const removeLines = db.prepare("DELETE FROM kept_lines WHERE section_id IN (SELECT id FROM kept_sections WHERE chat_id = ?)");
  const removeSectionWords = db.prepare("DELETE FROM kept_fts WHERE level = 2 AND ref IN (SELECT CAST(id AS TEXT) FROM kept_sections WHERE chat_id = ?)");
  const removeSections = db.prepare("DELETE FROM kept_sections WHERE chat_id = ?");
  const removeChatWords = db.prepare("DELETE FROM kept_fts WHERE level = 1 AND ref = ?");
  const removeChat = db.prepare("DELETE FROM kept_chats WHERE chat_id = ?");
  const remove = (chatId: string) => {
    removeLineWords.run(chatId);
    removeLines.run(chatId);
    removeSectionWords.run(chatId);
    removeSections.run(chatId);
    removeChatWords.run(chatId);
    return Number(removeChat.run(chatId).changes) > 0;
  };

  const transaction = <T>(work: () => T): T => {
    db.exec("BEGIN");
    try {
      const out = work();
      db.exec("COMMIT");
      return out;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const keywordRanks = (q: string | undefined, level: number, allowed: Set<string>): string[] =>
    q ? (ftsHits.all(q, level) as { ref: string }[]).map((r) => String(r.ref)).filter((ref) => allowed.has(ref)) : [];

  return {
    kept() {
      return (keptRows.all() as Record<string, unknown>[]).map((r) => ({
        chatId: String(r.chat_id),
        title: String(r.title),
        summary: String(r.summary),
        messages: Number(r.messages),
        keptAt: new Date(String(r.kept_at)),
      }));
    },

    isKept: (chatId) => isKeptRow.get(chatId) !== undefined,

    count: () => Number((counter.get() as { n: number }).n),

    async keep(chatId, title, messages, digest, embed) {
      const sections = chatSections(messages);
      const headings = sections.map((s, i) => oneLine(digest.headings[i] ?? "", MAX_HEADING) || fallbackDigest(title, [s]).headings[0]!);
      const summary = oneLine(digest.summary, MAX_DIGEST_SUMMARY);
      const bodies = sections.map((s) => s.map((t) => t.content).join("\n"));
      const lines = sections.map((s) => s.flatMap((t) => splitLine(t.content).map((text) => ({ role: t.role, text }))));
      // Vectors first (async), then one synchronous write.
      let vectors: { chat: Float32Array; sections: Float32Array[]; lines: Float32Array[][] } | undefined;
      if (embed) {
        try {
          const flat = lines.flat().map((l) => l.text);
          const all = await embedAll(embed, [`${title}\n${summary}`, ...sections.map((_, i) => `${headings[i]}\n${bodies[i]}`), ...flat]);
          let at = 1 + sections.length;
          vectors = { chat: all[0]!, sections: all.slice(1, at), lines: lines.map((ls) => ls.map(() => all[at++]!)) };
        } catch {
          vectors = undefined; // keeping never fails: keywords still work, fillVectors adds the vectors later
        }
      }
      transaction(() => {
        remove(chatId);
        insertChat.run(chatId, title, summary, messages.length, now().toISOString(), toBlob(vectors?.chat));
        insertFts.run(`${title}\n${summary}\n${headings.join("\n")}`, 1, chatId);
        sections.forEach((_, i) => {
          const sectionId = Number(insertSection.run(chatId, i, headings[i]!, bodies[i]!, toBlob(vectors?.sections[i])).lastInsertRowid);
          insertFts.run(`${headings[i]}\n${bodies[i]}`, 2, String(sectionId));
          lines[i]!.forEach((line, j) => {
            const lineId = Number(insertLine.run(sectionId, j, line.role, line.text, toBlob(vectors?.lines[i]![j])).lastInsertRowid);
            insertFts.run(line.text, 3, String(lineId));
          });
        });
      });
      return { sections: sections.length, lines: lines.flat().length, vectors: Boolean(vectors) };
    },

    drop: (chatId) => transaction(() => remove(chatId)),

    async search(query, embed) {
      const chats = chatVecs.all() as { id: string; title: string; vec: unknown }[];
      if (!chats.length || !query.trim()) return [];
      const q = ftsQuery(query);
      let qv: Float32Array | undefined;
      if (embed) {
        try {
          qv = (await embed([query]))[0];
        } catch {
          qv = undefined; // keywords only
        }
      }
      // Level 1: the chats, by their summary's words, by the words of their sections, and by meaning.
      const chatIds = new Set(chats.map((c) => c.id));
      const sectionsByChat = new Map(chats.map((c) => [c.id, sectionsOf.all(c.id) as { id: number; chat_id: string; heading: string; vec: unknown }[]]));
      const sectionChat = new Map<string, string>();
      for (const [chatId, list] of sectionsByChat) for (const s of list) sectionChat.set(String(s.id), chatId);
      const sectionWordsByChat = [...new Set(keywordRanks(q, 2, new Set(sectionChat.keys())).map((ref) => sectionChat.get(ref)!))];
      const topChats = fuse([keywordRanks(q, 1, chatIds), sectionWordsByChat, byMeaning(qv, chats)]).slice(0, TOP_CHATS);
      if (!topChats.length) return [];
      // Level 2: the sections inside those chats only.
      const sections = topChats.flatMap((id) => sectionsByChat.get(id) ?? []);
      const sectionIds = new Set(sections.map((s) => String(s.id)));
      const topSections = fuse([keywordRanks(q, 2, sectionIds), byMeaning(qv, sections.map((s) => ({ id: String(s.id), vec: s.vec })))]).slice(0, TOP_SECTIONS);
      // Level 3: the exact lines inside those sections only.
      const lineRows = topSections.flatMap((id) => linesOf.all(Number(id)) as { id: number; section_id: number; seq: number; role: "user" | "assistant"; text: string; vec: unknown }[]);
      const lineIds = new Set(lineRows.map((l) => String(l.id)));
      const topLines = new Set(fuse([keywordRanks(q, 3, lineIds), byMeaning(qv, lineRows.map((l) => ({ id: String(l.id), vec: l.vec })))]).slice(0, TOP_LINES));
      const titles = new Map(chats.map((c) => [c.id, c.title]));
      return topSections.flatMap((sectionId) => {
        const section = sections.find((s) => String(s.id) === sectionId)!;
        const hit = lineRows.filter((l) => String(l.section_id) === sectionId && topLines.has(String(l.id)));
        if (!hit.length) return [];
        return [{ chatId: section.chat_id, chatTitle: titles.get(section.chat_id) ?? "", heading: section.heading, lines: hit.map((l) => ({ role: l.role, text: l.text })) }];
      });
    },

    async fillVectors(embed) {
      const missing = [
        ...(db.prepare("SELECT chat_id AS id, title || char(10) || summary AS text FROM kept_chats WHERE vec IS NULL").all() as { id: string; text: string }[]).map((r) => ({ table: "kept_chats", key: "chat_id", ...r })),
        ...(db.prepare("SELECT id, heading || char(10) || body AS text FROM kept_sections WHERE vec IS NULL").all() as { id: number; text: string }[]).map((r) => ({ table: "kept_sections", key: "id", ...r })),
        ...(db.prepare("SELECT id, text FROM kept_lines WHERE vec IS NULL").all() as { id: number; text: string }[]).map((r) => ({ table: "kept_lines", key: "id", ...r })),
      ];
      if (!missing.length) return 0;
      const vecs = await embedAll(embed, missing.map((m) => m.text));
      transaction(() => missing.forEach((m, i) => db.prepare(`UPDATE ${m.table} SET vec = ? WHERE ${m.key} = ?`).run(toBlob(vecs[i]), m.id)));
      return missing.length;
    },
  };
}

/** Kept-chat lines for the system prompt, at most `maxChars`; undefined when nothing matched. */
export function keptChatContext(hits: readonly ChatHit[], maxChars = 1500): string | undefined {
  if (!hits.length) return undefined;
  const head = "From chats the user kept in memory (exact lines; use them if they help, do not recite them unprompted):";
  const out = [head];
  let size = head.length;
  for (const hit of hits) {
    const where = `[${hit.chatTitle} › ${hit.heading}]`;
    for (const line of hit.lines) {
      const text = `- ${where} ${line.role === "user" ? "User" : "ATOM"}: ${line.text}`;
      const room = maxChars - size - 1;
      if (room < 40) return out.length > 1 ? out.join("\n") : undefined;
      out.push(text.length > room ? `${text.slice(0, room - 1)}…` : text);
      size += Math.min(text.length, room) + 1;
    }
  }
  return out.length > 1 ? out.join("\n") : undefined;
}
