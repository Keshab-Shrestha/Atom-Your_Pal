// Keeps what the window has not sent yet (drafts and held messages) across restarts: one JSON file in a private folder. The browser's own storage
// cannot do this, because the window's address changes with the port on every run. Words only: no files, no attachment names. Plaintext in the user's
// own data folder, like the Mac app's ChatInput snapshot (docs/chat-input-recovery.md); never logged.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_BODY = 8 * 1024 * 1024;
const MAX_TEXT = 128 * 1024;
const MAX_CHATS = 100;
const MAX_ENTRIES = 20;
const CHAT_ID = /^[\w-]{1,100}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export interface SavedInput {
  version: 1;
  chats: Record<string, { draft: string; held: { id: string; text: string; lost: number }[] }>;
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** Strict: the exact shape or nothing. Unknown fields, long texts, bad ids and too many entries are all refusals, never truncations. */
export function validateSaved(value: unknown): { ok: true; saved: SavedInput } | { ok: false; why: string } {
  const bad = (why: string) => ({ ok: false as const, why });
  if (typeof value !== "object" || value === null || Array.isArray(value)) return bad("The saved input is not an object.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "chats,version" || v.version !== 1) return bad("The saved input has an unknown shape or version.");
  if (typeof v.chats !== "object" || v.chats === null || Array.isArray(v.chats)) return bad("The saved chats are not an object.");
  const entries = Object.entries(v.chats as Record<string, unknown>);
  if (entries.length > MAX_CHATS) return bad(`At most ${MAX_CHATS} chats keep input.`);
  const chats: SavedInput["chats"] = {};
  for (const [id, raw] of entries) {
    if (!CHAT_ID.test(id)) return bad("A chat id is malformed.");
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("A chat's input is not an object.");
    const c = raw as Record<string, unknown>;
    if (Object.keys(c).sort().join() !== "draft,held") return bad("A chat's input has unknown fields.");
    if (typeof c.draft !== "string" || bytes(c.draft) > MAX_TEXT) return bad("A draft is too long to keep.");
    if (!Array.isArray(c.held) || c.held.length > MAX_ENTRIES) return bad(`At most ${MAX_ENTRIES} messages wait per chat.`);
    const held: SavedInput["chats"][string]["held"] = [];
    const seen = new Set<string>();
    for (const h of c.held as unknown[]) {
      const e = h as Record<string, unknown>;
      if (typeof h !== "object" || h === null || Object.keys(e).sort().join() !== "id,lost,text") return bad("A waiting message has unknown fields.");
      if (typeof e.id !== "string" || !UUID.test(e.id) || seen.has(e.id)) return bad("A waiting message has a bad or repeated id.");
      if (typeof e.text !== "string" || bytes(e.text) > MAX_TEXT) return bad("A waiting message is too long to keep.");
      if (!Number.isInteger(e.lost) || (e.lost as number) < 0 || (e.lost as number) > 5) return bad("A waiting message has a bad file count.");
      seen.add(e.id);
      held.push({ id: e.id, text: e.text, lost: e.lost as number });
    }
    chats[id] = { draft: c.draft, held };
  }
  return { ok: true, saved: { version: 1, chats } };
}

export interface InputStore {
  load(): Promise<{ saved: SavedInput; note?: string }>;
  save(saved: SavedInput): Promise<void>;
}

export function createInputStore(dir: string): InputStore {
  const file = join(dir, "chat-input.json");
  const empty = (): SavedInput => ({ version: 1, chats: {} });
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        return { saved: empty() };
      }
      try {
        const checked = validateSaved(JSON.parse(text));
        if (checked.ok) return { saved: checked.saved };
      } catch {
        // fall through: keep the unreadable file for the user, start clean
      }
      // An unreadable file is kept under another name rather than overwritten.
      await rename(file, `${file}.unreadable-${Date.now()}`).catch(() => {});
      return { saved: empty(), note: "The saved drafts could not be read, so they were set aside and the window starts clean." };
    },
    async save(saved) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(saved), { mode: 0o600, flag: "wx" });
        await rename(tmp, file); // atomic: a crash leaves the old file or the new one, never half of one
      } catch (error) {
        await rm(tmp, { force: true });
        throw error;
      }
    },
  };
}
