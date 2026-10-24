// Rules for the Recovery view (ADR-157, docs/foreground-recovery.md). Pure. Recovery restores an unsent draft and never repeats work:
// a missing reply does not prove that nothing happened.

import type { RecoveryRecord } from "./protocol.ts";

export const MAX_DRAFT_BYTES = 128 * 1024;

/** The prompt, with any clarification answers it was given appended as labelled history (the Mac app's wording). */
type Answered = { text: string; answers: readonly { question: string; answer: string }[] };

export function draftText(record: Answered): string {
  if (record.answers.length === 0) return record.text;
  return `${record.text}\n\nEarlier clarifications (review before retry; not permissions):\n${record.answers.map((a) => `Question: ${a.question}\nAnswer: ${a.answer}`).join("\n\n")}`;
}

const running = (state: string) => state === "prepared" || state === "running";

/** Why a record cannot be restored to the draft now; undefined when it can. */
export function restoreWhy(record: Answered & { state: string }, composerWhy: string | undefined): string | undefined {
  if (running(record.state)) return "This request is still running. Stop it or wait for it to finish first.";
  if (new TextEncoder().encode(draftText(record)).length > MAX_DRAFT_BYTES) return "This prompt is too large to restore as a draft. Copy it instead, then shorten it or attach it as a file.";
  return composerWhy;
}

/** Whether a record cannot be dismissed yet. A request still in flight is settled first, so a late reply is not thrown away. */
export const dismissWhy = (state: string) => (running(state) ? "A request that is still running cannot be dismissed. Stop it first." : undefined);

/** An attempt that needs a look: it did not finish cleanly, or its reply is held in the journal because it was not saved with the chat. */
export const needsReview = (a: { state: string; archived: boolean; hasReply: boolean }) => a.state !== "completed" || !a.archived;

export const stateWord = (state: string) => state.charAt(0).toUpperCase() + state.slice(1);

/** The names of the files a request carried, for display. The window cannot re-attach them: it never had their paths. */
export function fileNames(paths: readonly string[]): string[] {
  return paths.map((p) => p.replace(/\\/g, "/").split("/").pop() || p);
}

/** What to tell the user after a restore: the words are back, the files are not. */
export function restoredNote(record: Pick<RecoveryRecord, "files" | "notes">): string {
  const missing = record.files.length + record.notes.length;
  const base = "Draft restored. Review it and the chat's model, project and permissions before sending; earlier effects may already exist.";
  return missing === 0 ? base : `${base} ${missing} attached file${missing === 1 ? "" : "s"} or note${missing === 1 ? "" : "s"} cannot be restored here (${[...fileNames(record.files), ...record.notes.map((n) => `note #${n}`)].join(", ")}). Attach ${missing === 1 ? "it" : "them"} again if needed.`;
}

/** Held copies the host has already accepted are in its journal now; the local copy is no longer needed. */
export function dropKnown<T extends { id: string }>(entries: readonly T[], known: readonly string[]): T[] {
  const ids = new Set(known.map((k) => k.toLowerCase()));
  return entries.filter((e) => !ids.has(e.id.toLowerCase()));
}
