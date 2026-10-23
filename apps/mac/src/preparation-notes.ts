import { createHash } from "node:crypto";
import { looksSecret, validChatBrief, type MemoryStore, type PreparationSource } from "@atom/memory";

export interface PreparationSelection { sources: PreparationSource[]; valid(): boolean }

/** Explicitly selected saved copies only. No search, folder refresh, personal facts, chat or account collection. */
export function capturePreparationNotes(memory: MemoryStore, ids: readonly number[], at: Date): PreparationSelection {
  const version = (id: number) => {
    const note = memory.brain.get(id), source = memory.brainSources?.note(id);
    if (!note || note.ghost || note.kind !== "note" || source?.state === "missing" || source?.state === "conflict") return undefined;
    if (looksSecret(note.body) || looksSecret(note.title) || !validChatBrief(note.title)) return undefined;
    return { note, source, hash: createHash("sha256").update(JSON.stringify([note.title, note.body, source ?? null])).digest("hex") };
  };
  const selected = ids.slice(0, 12).flatMap((id) => {
    const current = version(id);
    if (!current) return [];
    // Excerpts are explicit bounded preparation input; the original remains available in Second brain.
    let text = "", bytes = 0;
    for (const character of current.note.body) {
      bytes += Buffer.byteLength(character);
      if (bytes > 1200) break;
      text += character;
    }
    if (text !== current.note.body) text += "\n[Excerpt shortened; review the original note.]";
    if (!text.trim() || !validChatBrief(text)) return [];
    const provenance = current.source ? `${current.source.relativePath}; ${current.source.state}` : "authored note";
    const label = `${current.note.title} · note #${id} · ${provenance}`;
    if (!validChatBrief(label) || looksSecret(label)) return [];
    return [{ id, hash: current.hash, source: { id: `notes:${ids.indexOf(id) + 1}`, label, text, collectedAt: current.source?.checkedAt ?? at.toISOString() } }];
  });
  // Notes share a bounded request with the daily categories. Reject oversize input rather than silently drop opted-in items.
  if (Buffer.byteLength(JSON.stringify(selected.map((item) => item.source))) > 16_000) throw new Error("Selected notes exceed the preparation excerpt budget. Select fewer notes.");
  return { sources: selected.map((item) => item.source), valid: () => selected.every((item) => version(item.id)?.hash === item.hash) };
}
