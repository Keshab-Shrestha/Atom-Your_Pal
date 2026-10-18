import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

export type ForegroundState = "prepared" | "running" | "completed" | "failed" | "stopped" | "interrupted";
export interface ForegroundInput {
  id: string; chat: string; text: string; files: string[]; notes: number[]; source: "text" | "voice";
  provider?: string; model?: string;
}
export interface ForegroundRecord extends ForegroundInput {
  state: ForegroundState; createdAt: string; updatedAt: string; archived: boolean; dismissed: boolean;
  reply: string;
  answers: { id: string; question: string; answer: string }[];
}
export type ForegroundSummary = Omit<ForegroundRecord, "text" | "files" | "notes" | "reply" | "answers"> & { hasReply: boolean; answerCount: number };
export interface ForegroundStore {
  prepare(input: ForegroundInput): boolean;
  start(id: string, chat: string): boolean;
  finish(id: string, state: "completed" | "failed" | "stopped", reply?: string): void;
  answer(id: string, card: string, question: string, answer: string): void;
  get(id: string): ForegroundRecord | undefined;
  list(): ForegroundSummary[];
  known(ids: string[]): string[];
  knownAnswers(receipts: { id: string; digest: string }[]): string[];
  dismiss(id: string, archivedOnly?: boolean): boolean;
  forgetChat(chat: string): void;
  recover(): void;
}
const MAX_BYTES = 64 * 1024 * 1024;
export function openForeground(db: DatabaseSync, now: () => Date): ForegroundStore {
  db.exec(`CREATE TABLE IF NOT EXISTS foreground_attempts (
    id TEXT PRIMARY KEY COLLATE NOCASE, chat TEXT NOT NULL, signature TEXT NOT NULL,
    text TEXT NOT NULL, files TEXT NOT NULL, notes TEXT NOT NULL, source TEXT NOT NULL,
    provider TEXT, model TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    reply TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, archive_seq INTEGER, reply_hash TEXT, dismissed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS foreground_answers (
    attempt_id TEXT NOT NULL COLLATE NOCASE, id TEXT PRIMARY KEY COLLATE NOCASE, question TEXT NOT NULL, answer TEXT NOT NULL, answer_hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS foreground_chat ON foreground_attempts(chat, dismissed);
  CREATE INDEX IF NOT EXISTS foreground_answer_attempt ON foreground_answers(attempt_id);`);
  // Additive upgrades also tolerate a database made by an earlier local development build.
  const columns = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  const attemptsColumns = columns("foreground_attempts");
  if (!attemptsColumns.has("archive_seq")) db.exec("ALTER TABLE foreground_attempts ADD COLUMN archive_seq INTEGER");
  if (!attemptsColumns.has("reply_hash")) db.exec("ALTER TABLE foreground_attempts ADD COLUMN reply_hash TEXT");
  if (!columns("foreground_answers").has("answer_hash")) {
    db.exec("ALTER TABLE foreground_answers ADD COLUMN answer_hash TEXT NOT NULL DEFAULT ''");
    for (const a of db.prepare("SELECT id, answer FROM foreground_answers").all() as { id: string; answer: string }[]) {
      db.prepare("UPDATE foreground_answers SET answer_hash = ? WHERE id = ?").run(createHash("sha256").update(a.answer).digest("hex"), a.id);
    }
  }
  const row = db.prepare("SELECT * FROM foreground_attempts WHERE id = ?");
  const answers = db.prepare("SELECT id, question, answer FROM foreground_answers WHERE attempt_id = ? ORDER BY rowid");
  const room = (extra: number) => {
    const size = Number((db.prepare("SELECT COALESCE(SUM(length(CAST(text AS BLOB)) + length(CAST(reply AS BLOB)) + length(files) + length(notes)), 0) AS n FROM foreground_attempts WHERE dismissed = 0").get() as { n: number }).n)
      + Number((db.prepare("SELECT COALESCE(SUM(length(CAST(question AS BLOB)) + length(CAST(answer AS BLOB))), 0) AS n FROM foreground_answers").get() as { n: number }).n);
    if (size + extra > MAX_BYTES) throw new Error("Recovery storage is full. Review and dismiss old unfinished turns before sending more.");
  };
  const clear = (id: string) => {
    db.prepare("UPDATE foreground_attempts SET text = '', files = '[]', notes = '[]', reply = '', dismissed = 1, updated_at = ? WHERE id = ?").run(now().toISOString(), id);
    // Receipt ids remain as tombstones; deleted content cannot be replayed by an old delivery.
    db.prepare("UPDATE foreground_answers SET question = '', answer = '' WHERE attempt_id = ?").run(id);
  };
  const get = (id: string): ForegroundRecord | undefined => {
    const r = row.get(id) as Record<string, unknown> | undefined;
    return r ? { id: String(r.id), chat: String(r.chat), text: String(r.text), files: JSON.parse(String(r.files)), notes: JSON.parse(String(r.notes)), source: r.source as "text" | "voice",
      ...(r.provider ? { provider: String(r.provider) } : {}), ...(r.model ? { model: String(r.model) } : {}), state: r.state as ForegroundState,
      createdAt: String(r.created_at), updatedAt: String(r.updated_at), reply: (() => {
        if (r.reply) return String(r.reply);
        if (r.archived !== 1 || r.archive_seq == null || r.dismissed === 1) return "";
        const saved = db.prepare("SELECT content FROM chat_messages WHERE chat_id = ? AND seq = ? AND role = 'assistant'").get(String(r.chat), Number(r.archive_seq)) as { content: string } | undefined;
        return saved && createHash("sha256").update(saved.content).digest("hex") === r.reply_hash ? saved.content : "";
      })(), archived: r.archived === 1, dismissed: r.dismissed === 1,
      answers: answers.all(id) as unknown as ForegroundRecord["answers"] } : undefined;
  };
  return {
    prepare(input) {
      if (!/^[a-f0-9-]{36}$/i.test(input.id) || !/^[\w-]{1,100}$/.test(input.chat) || Buffer.byteLength(input.text) > 128 * 1024
          || input.files.length + input.notes.length > 5 || input.files.some((p) => !p.startsWith("/") || p.length > 4096)
          || input.notes.some((n) => !Number.isSafeInteger(n) || n < 1)) throw new Error("This request cannot fit the durable recovery record. The model was not called.");
      const signature = createHash("sha256").update(JSON.stringify([input.chat, input.text, input.files, input.notes, input.source])).digest("hex");
      const previous = row.get(input.id) as { signature: string } | undefined;
      if (previous) {
        if (previous.signature !== signature) throw new Error("That delivery id already belongs to a different request. Review recovery before trying again.");
        return false;
      }
      const count = Number((db.prepare("SELECT COUNT(*) AS n FROM foreground_attempts WHERE dismissed = 0").get() as { n: number }).n);
      if (count >= 100) throw new Error("There are 100 retained foreground attempts. Review and dismiss old attempts before sending more.");
      room(Buffer.byteLength(input.text) + Buffer.byteLength(JSON.stringify(input.files)) + 4096);
      const at = now().toISOString();
      db.prepare("INSERT INTO foreground_attempts (id, chat, signature, text, files, notes, source, provider, model, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)")
        .run(input.id, input.chat, signature, input.text, JSON.stringify(input.files), JSON.stringify(input.notes), input.source, input.provider ?? null, input.model ?? null, at, at);
      return true;
    },
    start: (id, chat) => Number(db.prepare("UPDATE foreground_attempts SET state = 'running', updated_at = ? WHERE id = ? AND chat = ? AND state = 'prepared' AND dismissed = 0").run(now().toISOString(), id, chat).changes) === 1,
    finish(id, state, reply = "") {
      const before = row.get(id) as { state: string; dismissed: number } | undefined;
      if (!before || before.dismissed || !["prepared", "running"].includes(before.state)) return;
      if (Buffer.byteLength(reply) > 4 * 1024 * 1024) throw new Error("The reply exceeds the 4 MiB recovery limit. Keep or copy the visible reply; this attempt's outcome remains uncertain.");
      room(Buffer.byteLength(reply));
      db.prepare("UPDATE foreground_attempts SET state = ?, reply = ?, updated_at = ? WHERE id = ? AND state IN ('prepared', 'running') AND dismissed = 0").run(state, reply, now().toISOString(), id);
    },
    answer(id, card, question, answer) {
      const attempt = row.get(id) as { state: string; dismissed: number } | undefined;
      if (!attempt || attempt.state !== "running" || attempt.dismissed) throw new Error("That attempt is no longer running.");
      if (!/^[a-f0-9-]{36}$/i.test(card) || question.length > 600 || !answer.trim() || answer.length > 2000) throw new Error("Invalid question answer.");
      const before = db.prepare("SELECT attempt_id, question, answer FROM foreground_answers WHERE id = ?").get(card) as { attempt_id: string; question: string; answer: string } | undefined;
      if (before) {
        if (before.attempt_id.toLowerCase() !== id.toLowerCase() || before.question !== question || before.answer !== answer) throw new Error("This question already has a different answer.");
        return;
      }
      if (answers.all(id).length >= 4) throw new Error("This attempt already has four saved answers.");
      room(Buffer.byteLength(question) + Buffer.byteLength(answer));
      db.prepare("INSERT INTO foreground_answers (attempt_id, id, question, answer, answer_hash) VALUES (?, ?, ?, ?, ?)").run(id, card, question, answer, createHash("sha256").update(answer).digest("hex"));
    },
    get,
    list() {
      return (db.prepare("SELECT id FROM foreground_attempts WHERE dismissed = 0 ORDER BY updated_at DESC, rowid DESC LIMIT 100").all() as { id: string }[]).map(({ id }) => {
        const { text, files, notes, reply, answers: saved, ...summary } = get(id)!;
        return { ...summary, hasReply: Boolean(reply), answerCount: saved.length };
      });
    },
    known: (ids) => ids.filter((id) => row.get(id) !== undefined),
    knownAnswers: (receipts) => receipts.filter((r) => db.prepare("SELECT 1 FROM foreground_answers WHERE id = ? AND answer_hash = ?").get(r.id, r.digest) !== undefined).map((r) => r.id),
    dismiss(id, archivedOnly = false) {
      const r = row.get(id) as { state: string; archived: number } | undefined;
      if (!r || ["running", "prepared"].includes(r.state) || (archivedOnly && (r.state !== "completed" || r.archived !== 1))) return false;
      db.exec("BEGIN");
      try { clear(id); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
      return true;
    },
    forgetChat(chat) {
      db.exec("SAVEPOINT foreground_forget");
      try {
        for (const r of db.prepare("SELECT id FROM foreground_attempts WHERE chat = ?").all(chat) as { id: string }[]) {
          db.prepare("UPDATE foreground_attempts SET state = 'interrupted' WHERE id = ?").run(r.id);
          clear(r.id);
        }
        db.exec("RELEASE foreground_forget");
      } catch (error) { db.exec("ROLLBACK TO foreground_forget"); db.exec("RELEASE foreground_forget"); throw error; }
    },
    recover() { db.prepare("UPDATE foreground_attempts SET state = 'interrupted', updated_at = ? WHERE state IN ('prepared', 'running') AND dismissed = 0").run(now().toISOString()); },
  };
}
