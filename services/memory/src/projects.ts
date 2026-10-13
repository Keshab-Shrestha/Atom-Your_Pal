import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// ADR-107: a project is a named folder and its chats. Its chats are ordinary chats with a project id (chats.ts). The
// folder is checked by the caller (grants.ts) before it arrives here; this file keeps the rows and the limits. Names and
// folders are never logged.

export const MAX_PROJECTS = 20;
export const MAX_PROJECT_NAME = 60;

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

export interface Project {
  id: string;
  name: string;
  /** Real paths. Exactly one in v1. */
  folders: string[];
  /** The project's own Agent (a folders-kit worker) that does every write. */
  helper?: string;
  provider?: string;
  model?: string;
  kit: string;
  /** Web search in the project's chats. Off until Keshab turns it on. */
  web: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectStore {
  /** Newest first. */
  list(): Project[];
  get(id: string): Project | undefined;
  /** Throws ProjectError for a bad or taken name, or when 20 projects are open. */
  add(input: { name: string; folder: string; helper?: string }): Project;
  rename(id: string, name: string): boolean;
  /** Keeps the chats as plain chats, or deletes them. False when there is no such project. */
  remove(id: string, options: { deleteChats: boolean }): boolean;
  archive(id: string, archived: boolean): boolean;
  /** The project's model; undefined clears it (the global model applies). */
  setModel(id: string, choice: { provider: string; model: string } | undefined): boolean;
  setWeb(id: string, web: boolean): boolean;
  setHelper(id: string, helper: string | undefined): boolean;
  /** Saved chats in the project. */
  chatCount(id: string): number;
}

/** A project's name: one line, 1 to 60 characters. Throws ProjectError. */
export function cleanProjectName(raw: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new ProjectError("The project needs a name.");
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(name)) throw new ProjectError("A project name is one line.");
  if ([...name].length > MAX_PROJECT_NAME) throw new ProjectError(`A project name has at most ${MAX_PROJECT_NAME} characters.`);
  return name;
}

interface Row {
  id: string;
  name: string;
  folders: string;
  helper: string | null;
  provider: string | null;
  model: string | null;
  kit: string;
  web: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

function toProject(row: Row): Project {
  let folders: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.folders);
    if (Array.isArray(parsed)) folders = parsed.filter((f): f is string => typeof f === "string");
  } catch {
    // a damaged entry reads as no folder: the project then opens as text only
  }
  return {
    id: row.id,
    name: row.name,
    folders,
    ...(row.helper ? { helper: row.helper } : {}),
    ...(row.provider && row.model ? { provider: row.provider, model: row.model } : {}),
    kit: row.kit,
    web: row.web === 1,
    archived: row.archived === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function openProjects(db: DatabaseSync, now: () => Date): ProjectStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folders TEXT NOT NULL,
      helper TEXT,
      provider TEXT,
      model TEXT,
      kit TEXT NOT NULL DEFAULT 'folders',
      web INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const all = db.prepare("SELECT * FROM projects ORDER BY created_at DESC, rowid DESC");
  const one = db.prepare("SELECT * FROM projects WHERE id = ?");
  const named = db.prepare("SELECT id FROM projects WHERE lower(name) = lower(?) AND id <> ?");
  const open = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE archived = 0");
  const insert = db.prepare("INSERT INTO projects (id, name, folders, helper, kit, created_at, updated_at) VALUES (?, ?, ?, ?, 'folders', ?, ?)");
  const touch = (sql: string) => db.prepare(`UPDATE projects SET ${sql}, updated_at = ? WHERE id = ?`);
  const setName = touch("name = ?");
  const setArchived = touch("archived = ?");
  const setModel = touch("provider = ?, model = ?");
  const setWeb = touch("web = ?");
  const setHelper = touch("helper = ?");
  const drop = db.prepare("DELETE FROM projects WHERE id = ?");
  const chatIds = db.prepare("SELECT id FROM chats WHERE project_id = ?");
  const clearMessages = db.prepare("DELETE FROM chat_messages WHERE chat_id = ?");
  const dropChat = db.prepare("DELETE FROM chats WHERE id = ?");
  const detach = db.prepare("UPDATE chats SET project_id = NULL WHERE project_id = ?");
  const counter = db.prepare("SELECT COUNT(*) AS n FROM chats WHERE project_id = ?");
  const openCount = () => Number((open.get() as { n: number }).n);
  const changed = (r: { changes: number | bigint }) => Number(r.changes) > 0;
  const at = () => now().toISOString();
  const mustBeFree = (name: string, except: string) => {
    if (named.get(name, except)) throw new ProjectError("Another project has that name.");
  };

  return {
    list: () => (all.all() as unknown as Row[]).map(toProject),
    get: (id) => {
      const row = one.get(id) as Row | undefined;
      return row ? toProject(row) : undefined;
    },

    add({ name: raw, folder, helper }) {
      const name = cleanProjectName(raw);
      mustBeFree(name, "");
      if (openCount() >= MAX_PROJECTS) throw new ProjectError(`There are already ${MAX_PROJECTS} projects. Archive or remove one first.`);
      const id = `p-${randomUUID().slice(0, 8)}`;
      insert.run(id, name, JSON.stringify([folder]), helper ?? null, at(), at());
      return toProject(one.get(id) as unknown as Row);
    },

    rename(id, raw) {
      const name = cleanProjectName(raw);
      mustBeFree(name, id);
      return changed(setName.run(name, at(), id));
    },

    remove(id, { deleteChats }) {
      let removed = false;
      db.exec("BEGIN");
      try {
        if (deleteChats) {
          for (const row of chatIds.all(id) as { id: string }[]) {
            clearMessages.run(row.id);
            dropChat.run(row.id);
          }
        } else detach.run(id);
        removed = changed(drop.run(id));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return removed;
    },

    archive(id, archived) {
      const row = one.get(id) as Row | undefined;
      if (row && !archived && row.archived === 1 && openCount() >= MAX_PROJECTS) {
        throw new ProjectError(`There are already ${MAX_PROJECTS} projects. Archive or remove one first.`);
      }
      return changed(setArchived.run(archived ? 1 : 0, at(), id));
    },

    setModel: (id, choice) => changed(setModel.run(choice?.provider ?? null, choice?.model ?? null, at(), id)),
    setWeb: (id, web) => changed(setWeb.run(web ? 1 : 0, at(), id)),
    setHelper: (id, helper) => changed(setHelper.run(helper ?? null, at(), id)),
    chatCount: (id) => Number((counter.get(id) as { n: number }).n),
  };
}
