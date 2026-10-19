import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";

/** Plain, local display only. Never follow links, read a device, or silently truncate a review. */
export const FILE_PREVIEW_BYTES = 32 * 1024;
export function readFilePreview(path: string): { text: string; hash: string } {
  if (realpathSync(path) !== path) throw new Error("Linked files cannot be previewed.");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > FILE_PREVIEW_BYTES) throw new Error("Preview requires a regular text file of 32 KiB or less, without hard links.");
    const bytes = Buffer.alloc(before.size + 1);
    let used = 0;
    while (used < bytes.length) { const n = readSync(fd, bytes, used, bytes.length - used, used); if (!n) break; used += n; }
    const after = fstatSync(fd), current = lstatSync(path);
    if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1 || realpathSync(path) !== path) throw new Error("The file changed while reading. Refresh and try again.");
    const body = bytes.subarray(0, used);
    const text = previewText(body);
    return { text, hash: createHash("sha256").update(body).digest("hex") };
  } finally { closeSync(fd); }
}

/** The same complete UTF-8/control/line budget for raw Git blobs and disk previews. */
export function previewText(body: Uint8Array): string {
  if (body.byteLength > FILE_PREVIEW_BYTES) throw new Error("Preview supports files of 32 KiB or less.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body); }
  catch { throw new Error("Preview supports UTF-8 text files only."); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(text)) throw new Error("Binary or hidden-control text cannot be previewed.");
  if (text.split("\n").length > 1000) throw new Error("Preview supports at most 1,000 lines.");
  return text;
}
