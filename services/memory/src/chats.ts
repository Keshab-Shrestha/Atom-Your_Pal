import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { openForeground } from "./foreground.ts";
import type { Message } from "@atom/contracts";
import { chatSearch, type ChatSearchHit } from "./chat-search.ts";
import { PLAIN_CHAT_LIMIT, ProjectError } from "./projects.ts";

export const CHAT_BRIEF_BYTES = 4000;
export function validChatBrief(text: unknown): text is string {
  return typeof text === "string" && Buffer.byteLength(text, "utf8") <= CHAT_BRIEF_BYTES
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ud800-\udfff]/u.test(text);
}

// ADR-091: Keshab's chat sessions with ATOM, kept on this Mac (in the memory file) so he can go back to one. A chat is
// ATOM Core's session: its id, a title from its first words and its turns. Never logged; the newest 200 are kept.

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: Date;
  /** User and assistant turns. */
  messages: number;
  pinned?: true;
  archived?: true;
  flagsVersion?: number;
  /** ADR-107: the project this chat belongs to; undefined for a plain chat. */
  projectId?: string;
}

export interface ChatStore {
  brief(id: string): { text: string; version: number } | undefined;
  setBrief(id: string, text: string, version: number): boolean;
  metadata(id: string): { pinned: boolean; archived: boolean; version: number } | undefined;
  setFlags(id: string, change: { pinned?: boolean; archived?: boolean }, version: number): boolean;
  forkRecord(id: string): { source: string; count: number; kind: string; revision: string } | undefined;
  fork(source: string, id: string, count: number, kind: string, revision: string): void;
  /** All ids for explicit project deletion cleanup, including protected chats beyond retention limits. */
  idsInProject(projectId: string): string[];
  /** Saves a session's turns (after each exchange); the title comes from its first words. */
  save(id: string, turns: readonly Message[], completion?: { requestId: string; reply: string }): void;
  /** The newest first: a limit, or `{ projectId, limit }` for one project's chats (ADR-107). */
  /** The newest first: a limit, or `{ projectId, limit }` for one project's chats; `projectId: null` lists plain chats only (ADR-107). */
  list(options?: number | { projectId?: string | null; limit?: number; pinned?: boolean; archived?: boolean }): ChatSummary[];
  /** ADR-107: gives the chat its own title (kept when it is saved again). False when the chat is not saved yet. Throws ProjectError for a bad title. */
  rename(id: string, title: string): boolean;
  /** ADR-107: the chat's project; undefined for a plain chat. */
  project(id: string): string | undefined;
  /** ADR-107: puts a chat in a project (undefined: a plain chat). False when the chat is not saved yet. */
  setProject(id: string, projectId: string | undefined): boolean;
  messages(id: string): Message[];
  remove(id: string): boolean;
  /** ADR-097: the chat's own provider and model; undefined when it uses the default. */
  model(id: string): { provider: string; model: string } | undefined;
  /** Sets the model durably, even before the first answer. False means no transcript row exists yet. */
  setModel(id: string, choice: { provider: string; model: string } | undefined): boolean;
  /** ADR-098 item 9: the chat's Claude Code session (its id, model and last answer's hash); undefined when none. */
  session(id: string): ChatSessionRef | undefined;
  /** ADR-098 item 9: sets the chat's session. False when the chat is not saved yet. */
  setSession(id: string, session: ChatSessionRef): boolean;
  /** ADR-098: chats whose messages match the words (titles are a chat's first words), best first. */
  search(query: string): ChatSearchHit[];
}

export interface ChatSessionRef {
  id: string;
  model: string;
  tail: string;
}

/** Plain chats kept (a project's chats are never pruned by this). */
export const MAX_CHATS = PLAIN_CHAT_LIMIT;
/** ADR-107: chats kept in one project, the newest. */
export const MAX_PROJECT_CHATS = 500;
export const CHAT_TITLE_LENGTH = 60;

/** A title Keshab gives a chat: one line, 1 to 60 characters. Throws ProjectError. */
export function cleanChatTitle(raw: string): string {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (!title) throw new ProjectError("The chat needs a title.");
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(title)) throw new ProjectError("A chat title is one line.");
  if ([...title].length > CHAT_TITLE_LENGTH) throw new ProjectError(`A chat title has at most ${CHAT_TITLE_LENGTH} characters.`);
  return title;
}

/** The chat's title: its first words, on one line. */
export function chatTitle(turns: readonly Message[]): string {
  const first = turns.find((m) => m.role === "user")?.content ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  if (!line) return "New chat";
  return line.length > CHAT_TITLE_LENGTH ? `${line.slice(0, CHAT_TITLE_LENGTH - 1).trimEnd()}…` : line;
}

export function openChats(db: DatabaseSync, now: () => Date, onRemove?: (id: string) => void): ChatStore {
  openForeground(db, now); // schema also exists for callers opening only the chat store
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      PRIMARY KEY (chat_id, seq)
    );
    CREATE INDEX IF NOT EXISTS chats_updated ON chats(updated_at);
    CREATE TABLE IF NOT EXISTS pending_chat_models (
      chat_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL
    );
  `);
  // ADR-097: a chat's own model; NULL uses the default. Added to files made before it.
  const columns = (db.prepare("PRAGMA table_info(chats)").all() as { name: string }[]).map((c) => c.name);
  if (!columns.includes("provider")) db.exec("ALTER TABLE chats ADD COLUMN provider TEXT");
  if (!columns.includes("model")) db.exec("ALTER TABLE chats ADD COLUMN model TEXT");
  // ADR-098 item 9: the chat's Claude Code session as JSON; NULL starts a fresh one.
  if (!columns.includes("session")) db.exec("ALTER TABLE chats ADD COLUMN session TEXT");
  // ADR-107: the chat's project; NULL is a plain chat. Added to files made before projects.
  if (!columns.includes("project_id")) db.exec("ALTER TABLE chats ADD COLUMN project_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS chats_project ON chats(project_id, updated_at)");
  // ADR-107: 1 once Keshab renamed the chat: saving no longer takes its title from its first words.
  if (!columns.includes("named")) db.exec("ALTER TABLE chats ADD COLUMN named INTEGER NOT NULL DEFAULT 0");
  // ADR-155: flags are presentation metadata; branch records are durable deduplication tombstones.
  for (const [column, declaration] of [["pinned", "INTEGER NOT NULL DEFAULT 0"], ["archived", "INTEGER NOT NULL DEFAULT 0"], ["flags_version", "INTEGER NOT NULL DEFAULT 0"]]) {
    if (!columns.includes(column!)) db.exec(`ALTER TABLE chats ADD COLUMN ${column} ${declaration}`);
  }
  if (!columns.includes("brief")) db.exec("ALTER TABLE chats ADD COLUMN brief TEXT NOT NULL DEFAULT ''");
  if (!columns.includes("brief_version")) db.exec("ALTER TABLE chats ADD COLUMN brief_version INTEGER NOT NULL DEFAULT 0");
  const readBrief = db.prepare("SELECT brief AS text, brief_version AS version FROM chats WHERE id = ?");
  const writeBrief = db.prepare("UPDATE chats SET brief = ?, brief_version = brief_version + 1 WHERE id = ? AND brief_version = ?");
  db.exec("CREATE TABLE IF NOT EXISTS chat_branches (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, message_count INTEGER NOT NULL, kind TEXT NOT NULL, revision TEXT NOT NULL)");
  const metadata = db.prepare("SELECT pinned, archived, flags_version FROM chats WHERE id = ?");
  const branchRecord = db.prepare("SELECT source_id, message_count, kind, revision FROM chat_branches WHERE id = ?");
  const writeTitle = db.prepare("UPDATE chats SET title = ?, named = 1 WHERE id = ?");
  const readProject = db.prepare("SELECT project_id FROM chats WHERE id = ?");
  const writeProject = db.prepare("UPDATE chats SET project_id = ? WHERE id = ?");
  const readSession = db.prepare("SELECT session FROM chats WHERE id = ?");
  const writeSession = db.prepare("UPDATE chats SET session = ? WHERE id = ?");
  const finder = chatSearch(db);
  const readModel = db.prepare("SELECT provider, model FROM chats WHERE id = ?");
  const writeModel = db.prepare("UPDATE chats SET provider = ?, model = ? WHERE id = ?");
  const readPendingModel = db.prepare("SELECT provider, model FROM pending_chat_models WHERE chat_id = ?");
  const writePendingModel = db.prepare("INSERT INTO pending_chat_models(chat_id, provider, model) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET provider = excluded.provider, model = excluded.model");
  const dropPendingModel = db.prepare("DELETE FROM pending_chat_models WHERE chat_id = ?");
  const upsert = db.prepare(
    "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = CASE WHEN chats.named = 1 THEN chats.title ELSE excluded.title END, updated_at = excluded.updated_at",
  );
  const clear = db.prepare("DELETE FROM chat_messages WHERE chat_id = ?");
  const insert = db.prepare("INSERT INTO chat_messages (chat_id, seq, role, content) VALUES (?, ?, ?, ?)");
  const drop = db.prepare("DELETE FROM chats WHERE id = ?");
  const columnsOf = "c.id, c.title, c.updated_at, c.project_id, c.pinned, c.archived, c.flags_version, (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id) AS n";
  const read = db.prepare("SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY seq");
  // ADR-107: the plain chats beyond 200, and a project's chats beyond 500, oldest first. A project chat is never in the first.
  const old = db.prepare("SELECT id FROM chats WHERE project_id IS NULL AND pinned = 0 AND archived = 0 AND id NOT IN (SELECT chat FROM foreground_attempts WHERE dismissed = 0) AND id NOT IN (SELECT b.source_id FROM chat_branches b JOIN chats child ON child.id = b.id) ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?");
  const oldIn = db.prepare("SELECT id FROM chats WHERE project_id = ? AND pinned = 0 AND archived = 0 AND id NOT IN (SELECT chat FROM foreground_attempts WHERE dismissed = 0) AND id NOT IN (SELECT b.source_id FROM chat_branches b JOIN chats child ON child.id = b.id) ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?");
  const prune = (project: string | undefined) => {
    const rows = (project ? oldIn.all(project, MAX_PROJECT_CHATS) : old.all(MAX_CHATS)) as { id: string }[];
    for (const row of rows) {
      onRemove?.(row.id);
      clear.run(row.id);
      dropPendingModel.run(row.id);
      drop.run(row.id);
    }
  };

  return {
    brief(id) {
      const row = readBrief.get(id) as { text: string; version: number } | undefined;
      if (!row) return undefined;
      if (!validChatBrief(row.text) || !Number.isSafeInteger(row.version) || row.version < 0 || row.version > 2_000_000_000) throw new ProjectError("The saved chat brief is invalid. Restore its data before continuing.");
      return { text: row.text, version: row.version };
    },
    setBrief(id, text, version) {
      if (!validChatBrief(text) || !Number.isSafeInteger(version) || version < 0 || version >= 2_000_000_000) throw new ProjectError("Use at most 4,000 UTF-8 bytes without hidden control characters and the current brief version.");
      if (Number(writeBrief.run(text, id, version).changes)) return true;
      const current = readBrief.get(id) as { text: string; version: number } | undefined;
      // A lost acknowledgement may be checked again; never overwrite a newer edit.
      return current?.version === version + 1 && current.text === text;
    },
    idsInProject(projectId) {
      return (db.prepare("SELECT id FROM chats WHERE project_id = ?").all(projectId) as { id: string }[]).map((row) => row.id);
    },
    metadata(id) {
      const row = metadata.get(id) as { pinned: number; archived: number; flags_version: number } | undefined;
      return row ? { pinned: Boolean(row.pinned), archived: Boolean(row.archived), version: row.flags_version } : undefined;
    },
    setFlags(id, change, version) {
      const row = metadata.get(id) as { pinned: number; archived: number } | undefined;
      if (!row) return false;
      return Number(db.prepare("UPDATE chats SET pinned = ?, archived = ?, flags_version = flags_version + 1 WHERE id = ? AND flags_version = ?")
        .run(change.pinned === undefined ? row.pinned : Number(change.pinned), change.archived === undefined ? row.archived : Number(change.archived), id, version).changes) > 0;
    },
    forkRecord(id) {
      const row = branchRecord.get(id) as { source_id: string; message_count: number; kind: string; revision: string } | undefined;
      return row ? { source: row.source_id, count: row.message_count, kind: row.kind, revision: row.revision } : undefined;
    },
    fork(source, id, count, kind, revision) {
      if (branchRecord.get(id) || metadata.get(id)) throw new ProjectError("That fork request already exists. Refresh the chat list.");
      const row = db.prepare("SELECT title, project_id FROM chats WHERE id = ?").get(source) as { title: string; project_id: string | null } | undefined;
      const n = Number((db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE chat_id = ?").get(source) as { n: number }).n);
      if (!row || !Number.isSafeInteger(count) || count < 0 || count > n) throw new ProjectError("The saved chat changed. Refresh its history.");
      const at = now().toISOString();
      const title = Array.from("Fork of " + row.title).slice(0, CHAT_TITLE_LENGTH).join("");
      db.exec("BEGIN");
      try {
        db.prepare("INSERT INTO chats (id, title, created_at, updated_at, named, project_id, provider, model) SELECT ?, ?, ?, ?, 1, project_id, provider, model FROM chats WHERE id = ?").run(id, title, at, at, source);
        db.prepare("INSERT INTO chat_messages (chat_id, seq, role, content) SELECT ?, seq, role, content FROM chat_messages WHERE chat_id = ? AND seq < ? ORDER BY seq").run(id, source, count);
        db.prepare("INSERT INTO chat_branches (id, source_id, message_count, kind, revision) VALUES (?, ?, ?, ?, ?)").run(id, source, count, kind, revision);
        // Fork creation never prunes another chat; ordinary future saves retain the existing retention policy.
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    save(id, turns, completion) {
      const kept = turns.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
      if (!kept.length) return;
      const at = now().toISOString();
      db.exec("BEGIN");
      try {
        upsert.run(id, chatTitle(kept), at, at);
        const pending = readPendingModel.get(id) as { provider: string; model: string } | undefined;
        if (pending) {
          writeModel.run(pending.provider, pending.model, id);
          dropPendingModel.run(id);
        }
        clear.run(id);
        kept.forEach((m, i) => insert.run(id, i, m.role, m.content));
        if (completion && kept.at(-1)?.role === "assistant" && kept.at(-1)?.content === completion.reply) {
          db.prepare("UPDATE foreground_attempts SET state = 'completed', archived = 1, archive_seq = ?, reply_hash = ?, updated_at = ? WHERE id = ? AND chat = ? AND state = 'running' AND dismissed = 0")
            .run(kept.length - 1, createHash("sha256").update(completion.reply).digest("hex"), at, completion.requestId, id);
        }
        const project = (readProject.get(id) as { project_id: string | null }).project_id ?? undefined;
        prune(project);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    list(options = 50) {
      const opts = typeof options === "number" ? { limit: options } : options;
      const conditions: string[] = [];
      const args: (string | number)[] = [];
      if (opts.projectId === null) conditions.push("c.project_id IS NULL");
      else if (opts.projectId) { conditions.push("c.project_id = ?"); args.push(opts.projectId); }
      if (opts.pinned !== undefined) { conditions.push("c.pinned = ?"); args.push(Number(opts.pinned)); }
      if (opts.archived !== undefined) { conditions.push("c.archived = ?"); args.push(Number(opts.archived)); }
      args.push(Math.max(1, Math.min(2000, opts.limit ?? 50)));
      const rows = db.prepare(`SELECT ${columnsOf} FROM chats c ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY c.pinned DESC, c.updated_at DESC, c.rowid DESC LIMIT ?`).all(...args) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        updatedAt: new Date(String(r.updated_at)),
        messages: Number(r.n),
        ...(r.pinned ? { pinned: true as const } : {}),
        ...(r.archived ? { archived: true as const } : {}),
        ...(r.flags_version ? { flagsVersion: Number(r.flags_version) } : {}),
        ...(r.project_id ? { projectId: String(r.project_id) } : {}),
      }));
    },

    rename: (id, title) => Number(writeTitle.run(cleanChatTitle(title), id).changes) > 0,

    project(id) {
      const row = readProject.get(id) as { project_id: string | null } | undefined;
      return row?.project_id ?? undefined;
    },

    setProject(id, projectId) {
      const done = Number(writeProject.run(projectId ?? null, id).changes) > 0;
      if (done && projectId) prune(projectId);
      return done;
    },

    messages(id) {
      return (read.all(id) as { role: "user" | "assistant"; content: string }[]).map((r) => ({ role: r.role, content: r.content }));
    },

    remove(id) {
      onRemove?.(id);
      clear.run(id);
      dropPendingModel.run(id);
      return Number(drop.run(id).changes) > 0;
    },

    model(id) {
      const row = (readModel.get(id) ?? readPendingModel.get(id)) as { provider: string | null; model: string | null } | undefined;
      return row?.provider && row.model ? { provider: row.provider, model: row.model } : undefined;
    },

    session(id) {
      const row = readSession.get(id) as { session: string | null } | undefined;
      if (!row?.session) return undefined;
      try {
        const s = JSON.parse(row.session) as Partial<ChatSessionRef>;
        return typeof s.id === "string" && typeof s.model === "string" && typeof s.tail === "string" ? { id: s.id, model: s.model, tail: s.tail } : undefined;
      } catch {
        return undefined; // a damaged entry only means a fresh session
      }
    },

    setSession(id, session) {
      return Number(writeSession.run(JSON.stringify({ id: session.id, model: session.model, tail: session.tail }), id).changes) > 0;
    },

    setModel(id, choice) {
      db.exec("BEGIN");
      try {
        const saved = Number(writeModel.run(choice?.provider ?? null, choice?.model ?? null, id).changes) > 0;
        if (!saved && choice) writePendingModel.run(id, choice.provider, choice.model);
        else dropPendingModel.run(id);
        db.exec("COMMIT");
        return saved;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },

    search: (query) => finder.search(query),
  };
}
