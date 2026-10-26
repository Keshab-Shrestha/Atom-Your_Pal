import type { DatabaseSync } from "node:sqlite";
import type { MemorySelection } from "./tools.ts";

export const RECALL_SOURCES = ["turn.memory-facts", "opening.kept-chat-hits", "opening.recent-episodes", "opening.current-chat-digest", "user.chat-brief", "history.continuity"] as const;
type RecallSource = typeof RECALL_SOURCES[number];
export type RecallOutcome = "completed" | "failed" | "cancelled";
type RecallState = "prepared" | RecallOutcome | "interrupted";
export interface RecallPayload {
  schema: "atom.recall/v1";
  personal: "enabled" | "disabled";
  facts: MemorySelection | null;
  history: { mode: "replay" | "provider-session" | "provider-session-and-catchup"; suppliedMessages: number; omittedMessages: number | null };
  blocks: { source: RecallSource; selection: "full" | "fallback" | "omitted"; offeredBytes: number; retainedBytes: number }[];
}
export type RecallEvent =
  | { kind: "prepared"; chat: string; request: string; attempt: string; payload: RecallPayload }
  | { kind: "finished"; chat: string; request: string; attempt: string; outcome: RecallOutcome };
export interface RecallView { summary: string; details: string; at: string }
export interface RecallReceipts {
  record(event: RecallEvent): void;
  inspect(chat: string): RecallView | undefined;
  forget(chat: string): void;
}

const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
/** Project onto a metadata-only shape; no fact/query text is retained in a receipt. */
function payload(value: unknown): RecallPayload {
  if (!value || typeof value !== "object") throw new Error("Invalid recall metadata.");
  const p = value as RecallPayload;
  if (p.schema !== "atom.recall/v1" || !["enabled", "disabled"].includes(p.personal)
    || !p.history || !["replay", "provider-session", "provider-session-and-catchup"].includes(p.history.mode)
    || !integer(p.history.suppliedMessages) || p.history.omittedMessages !== null && !integer(p.history.omittedMessages)
    || !Array.isArray(p.blocks) || p.blocks.length > RECALL_SOURCES.length) throw new Error("Invalid recall metadata.");
  if (p.history.mode === "replay" ? p.history.omittedMessages === null : p.history.omittedMessages !== null) throw new Error("Invalid replay observation.");
  const sources = new Set<string>();
  const blocks = p.blocks.map((b) => {
    if (!b || !RECALL_SOURCES.includes(b.source) || sources.has(b.source) || !["full", "fallback", "omitted"].includes(b.selection)
      || !integer(b.offeredBytes) || b.offeredBytes < 1 || !integer(b.retainedBytes) || b.retainedBytes > b.offeredBytes
      || b.selection === "omitted" && b.retainedBytes !== 0 || b.selection === "full" && b.retainedBytes !== b.offeredBytes
      || b.selection === "fallback" && b.retainedBytes < 1) throw new Error("Invalid recall block.");
    sources.add(b.source);
    return { source: b.source, selection: b.selection, offeredBytes: b.offeredBytes, retainedBytes: b.retainedBytes };
  });
  let facts: MemorySelection | null = null;
  if (p.facts !== null) {
    if (!p.facts || !integer(p.facts.total) || !Array.isArray(p.facts.chosen) || p.facts.chosen.length > 64 || p.facts.chosen.length > p.facts.total) throw new Error("Invalid recall selection.");
    const ids = new Set<number>();
    facts = { total: p.facts.total, chosen: p.facts.chosen.map((m) => {
      if (!m || !integer(m.id) || m.id < 1 || ids.has(m.id) || !["match", "recent"].includes(m.via)) throw new Error("Invalid recall fact.");
      ids.add(m.id); return { id: m.id, via: m.via };
    }) };
  }
  if (p.personal === "disabled" && facts !== null) throw new Error("Disabled recall cannot contain facts.");
  return { schema: "atom.recall/v1", personal: p.personal, facts,
    history: { mode: p.history.mode, suppliedMessages: p.history.suppliedMessages, omittedMessages: p.history.omittedMessages }, blocks };
}

const names: Record<RecallSource, string> = {
  "turn.memory-facts": "Saved facts", "opening.kept-chat-hits": "Saved-chat search results",
  "opening.recent-episodes": "Recent conversation notes", "opening.current-chat-digest": "This chat's project summary",
  "user.chat-brief": "Current Chat brief block", "history.continuity": "Older-message summary or its status notice",
};
function explain(p: RecallPayload, state: RecallState): { summary: string; details: string } {
  const selected = p.facts?.chosen.length;
  const summary = state === "completed"
    ? p.personal === "disabled" ? "The reply completed without adding new personal facts or cross-chat background."
      : selected !== undefined ? `The reply completed with ${selected} saved ${selected === 1 ? "fact" : "facts"} prepared as background.`
        : "The reply completed; saved-fact selection was not recorded."
    : state === "prepared" ? "Context was prepared; request completion is not confirmed."
      : state === "cancelled" ? "The request was stopped. Prepared context does not confirm delivery."
        : state === "interrupted" ? "ATOM closed before request completion was confirmed."
          : "The request failed. Prepared context does not confirm delivery.";
  const lines = [p.personal === "disabled" ? "New personal saved-fact selection was disabled by Chat only. Previously sent copies can remain in a resumed provider session."
    : p.facts ? `${p.facts.total} facts were kept at selection time; ${p.facts.chosen.length} were selected automatically. ${p.facts.total - p.facts.chosen.length} were not selected for this background block; they may still be found with recall.`
      : "Saved-fact selection was not observed for this request; no storage or recall failure is inferred."];
  if (p.facts?.chosen.length) lines.push("Selected fact IDs: " + p.facts.chosen.map((m) => `${m.id} (${m.via === "match" ? "matching words" : "recent"})`).join(", ") + ". These are historical IDs, not a claim they remain saved now.");
  lines.push(p.history.mode === "replay"
    ? `${p.history.suppliedMessages} earlier messages were supplied in this request; ${p.history.omittedMessages ?? 0} were outside this replay. The saved archive was not changed.`
    : `An existing provider session also carried conversation context. ${p.history.suppliedMessages} additional earlier messages were supplied. ATOM cannot inspect that session's full retained or compacted contents.`);
  for (const b of p.blocks) lines.push(`${names[b.source]}: ${b.selection === "full" ? "included" : b.selection === "fallback" ? "shortened for the context budget" : "omitted for the context budget"} (${b.retainedBytes}/${b.offeredBytes} UTF-8 bytes).`);
  lines.push("This records request preparation at ATOM's model-adapter boundary, not proof the model read or used any item. Unlisted sources may not have been searched or observed; no absence or storage failure is inferred. Tool-driven recall and source searches are not traced here. Setup failures before context composition have no receipt. Permissions are checked separately.");
  return { summary, details: lines.join("\n\n") };
}

/** Bounded host-only metadata in the existing memory DB. No prompts, fact text, query, paths or model output. */
export function openRecallReceipts(db: DatabaseSync, owner: string, now: () => Date): RecallReceipts {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_recall_receipts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, chat TEXT NOT NULL, request TEXT NOT NULL,
    attempt TEXT NOT NULL, at TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(owner, attempt));
    CREATE INDEX IF NOT EXISTS chat_recall_recent ON chat_recall_receipts(owner, chat, seq DESC);
    CREATE TRIGGER IF NOT EXISTS chat_recall_deleted AFTER DELETE ON chats BEGIN DELETE FROM chat_recall_receipts WHERE chat = old.id; END;`);
  db.prepare("UPDATE chat_recall_receipts SET state = 'interrupted' WHERE owner = ? AND state = 'prepared'").run(owner);
  const insert = db.prepare("INSERT OR IGNORE INTO chat_recall_receipts(owner, chat, request, attempt, at, state, payload) VALUES (?, ?, ?, ?, ?, 'prepared', ?)");
  const finish = db.prepare("UPDATE chat_recall_receipts SET state = ? WHERE owner = ? AND chat = ? AND request = ? AND attempt = ? AND state = 'prepared'");
  const latest = db.prepare("SELECT request, attempt, at, state, payload FROM chat_recall_receipts WHERE owner = ? AND chat = ? ORDER BY seq DESC LIMIT 1");
  const drop = db.prepare("DELETE FROM chat_recall_receipts WHERE owner = ? AND chat = ?");
  return {
    record(event) {
      if (![event.chat, event.request, event.attempt].every((s) => typeof s === "string" && s.length > 0 && s.length <= 200 && !/[\x00-\x1f\x7f]/.test(s))) throw new Error("Invalid recall identity.");
      if (event.kind === "prepared") {
        const text = JSON.stringify(payload(event.payload));
        insert.run(owner, event.chat, event.request, event.attempt, now().toISOString(), text);
        db.prepare("DELETE FROM chat_recall_receipts WHERE owner = ? AND chat = ? AND seq NOT IN (SELECT seq FROM chat_recall_receipts WHERE owner = ? AND chat = ? ORDER BY seq DESC LIMIT 8)").run(owner, event.chat, owner, event.chat);
        db.prepare("DELETE FROM chat_recall_receipts WHERE owner = ? AND seq NOT IN (SELECT seq FROM chat_recall_receipts WHERE owner = ? ORDER BY seq DESC LIMIT 1000)").run(owner, owner);
      } else {
        if (!["completed", "failed", "cancelled"].includes(event.outcome)) throw new Error("Invalid recall outcome.");
        finish.run(event.outcome, owner, event.chat, event.request, event.attempt);
      }
    },
    inspect(chat) {
      const row = latest.get(owner, chat) as { request: string; attempt: string; at: string; state: RecallState; payload: string } | undefined;
      if (!row) return;
      try {
        if (!["prepared", "completed", "failed", "cancelled", "interrupted"].includes(row.state)) throw new Error();
        const view = explain(payload(JSON.parse(row.payload)), row.state);
        return { ...view, details: `${view.details}\n\nRequest: ${row.request}\nAttempt: ${row.attempt}`, at: row.at };
      } catch { return { summary: "The latest context record could not be read.", details: "No older receipt is substituted, and no memory selection or delivery is inferred.", at: row.at }; }
    },
    forget(chat) { drop.run(owner, chat); },
  };
}
