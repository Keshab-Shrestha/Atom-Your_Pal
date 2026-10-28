/** Host-authored prefix on imported note output; documents cannot turn it off. */
export const SOURCE_DATA_MARKER = "[IMPORTED_NOTE_REFERENCE_DATA]";
export function importedNoteResult(result: unknown): boolean {
  return (typeof result === "string" ? result : JSON.stringify(result ?? "")).includes(SOURCE_DATA_MARKER);
}
