// What the window may attach, and what a paste does. The limits and type lists mirror apps/mac/src/attachments.ts (a test compares them with
// that file, so they cannot drift); the runtime still checks every file itself and its answer is final. The paste rules are ADR-149/150.

import { graphemes, stripHidden } from "./copy.ts";

export const MAX_FILES = 5;
export const MAX_BYTES = 10 * 1024 * 1024;
/** A cleaned paste of this many characters, or one that would take the draft past it, becomes a text file instead (ADR-150). */
export const LONG_PASTE = 4000;

export const IMAGE_TYPES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
export const TEXT_TYPES = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".css", ".log", ".ini", ".conf",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".cs", ".php", ".sh", ".sql", ".ipynb", ".tex", ".srt", ".rtf",
]);

export type FileKind = "image" | "pdf" | "text";

const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

/** The kind of a file by its name. A file with no extension is let through: the runtime looks inside it. */
export function kindOf(name: string): FileKind | "unknown" | undefined {
  const ext = extOf(name);
  if (IMAGE_TYPES.has(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if (TEXT_TYPES.has(ext)) return "text";
  return ext === "" ? "unknown" : undefined;
}

/** Why a file cannot be attached, in words for the user; undefined when it can (the runtime has the last word). */
export function refuseFile(name: string, size: number, alreadyAttached: number): string | undefined {
  if (alreadyAttached >= MAX_FILES) return `Attach at most ${MAX_FILES} files to one message.`;
  if (size === 0) return `${name} is empty.`;
  if (size > MAX_BYTES) return `${name} is over ${MAX_BYTES / 1024 / 1024} MB, too big to attach.`;
  if (kindOf(name) === undefined) return `${name}: ATOM reads text, code, PDFs and images (png, jpg, gif, webp).`;
  return undefined;
}

export function pastedTextName(n: number): string {
  return `Pasted text ${n}.txt`;
}

export type PasteDecision =
  /** Let the browser paste it as it is. */
  | { kind: "normal" }
  /** Insert this cleaned text in place of the selection. */
  | { kind: "clean"; text: string; removed: number }
  /** Nothing but hidden controls: paste nothing. */
  | { kind: "nothing"; removed: number }
  /** Make a text file of it; the draft is left as it is. */
  | { kind: "attach"; text: string; removed: number }
  | { kind: "refuse"; why: string };

/**
 * What to do with pasted text. It is cleaned of hidden display controls first. A cleaned paste of 4,000 characters or more, or one that would
 * put the draft over 4,000 after replacing the selection, becomes a file. That needs a free slot, and a chat that takes attachments
 * (a project chat does not): otherwise it is refused and the draft and the clipboard are left alone.
 */
export function pasteDecision(pasted: string, draft: string, selection: [number, number], slotsFree: number, attachWhy: string | undefined): PasteDecision {
  const cleaned = stripHidden(pasted);
  if (cleaned.text === "") return cleaned.removed > 0 ? { kind: "nothing", removed: cleaned.removed } : { kind: "normal" };
  const pastedLength = graphemes(cleaned.text).length;
  const after = graphemes(draft.slice(0, selection[0])).length + pastedLength + graphemes(draft.slice(selection[1])).length;
  if (pastedLength >= LONG_PASTE || after > LONG_PASTE) {
    if (attachWhy) return { kind: "refuse", why: `${attachWhy} Save the text in a file yourself, or use a chat outside a project.` };
    if (slotsFree <= 0) return { kind: "refuse", why: `This message already has ${MAX_FILES} attachments, so the long text was not pasted. Remove one, then paste again.` };
    return { kind: "attach", text: cleaned.text, removed: cleaned.removed };
  }
  return cleaned.removed > 0 ? { kind: "clean", text: cleaned.text, removed: cleaned.removed } : { kind: "normal" };
}

// ---------- attachments shown in a sent message ----------

/** The runtime puts "[Attached: name — path]" in the request for each file. The window shows the name and never the local path. */
const MARKER = /\[Attached: (.+?) — (.+?)\]/g;

export type Piece = { text: string } | { attached: string };

export function splitAttachments(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ attached: m[1]! });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
