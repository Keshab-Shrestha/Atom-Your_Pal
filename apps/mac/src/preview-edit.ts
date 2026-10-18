import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fchmodSync, fsyncSync, fstatSync, lstatSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { isInside } from "@atom/helpers";
import { SECRET_SHAPES } from "./folder-run.ts";

const hash = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
const secret = (text: string) => SECRET_SHAPES.some((p) => p.test(text));
const hidden = (text: string) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}\u2028\u2029]/u.test(text);

/** Bounded no-follow read. Synchronous so the final check/rename cannot interleave with another host tool. */
function currentFile(root: string, path: string) {
  if (realpathSync(root) !== root || realpathSync(path) !== path || !isInside(root, path) || path === root) throw new Error("changed path");
  const entry = lstatSync(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!entry.isFile() || !info.isFile() || entry.dev !== info.dev || entry.ino !== info.ino || info.nlink !== 1 || info.size > 256 * 1024 || info.mode & 0o7000 || info.uid !== process.getuid?.()) throw new Error("unsupported file");
    const body = Buffer.alloc(info.size + 1);
    let used = 0;
    while (used < body.length) { const n = readSync(fd, body, used, body.length - used, used); if (!n) break; used += n; }
    const after = fstatSync(fd), now = lstatSync(path);
    if (used !== info.size || after.nlink !== 1 || now.nlink !== 1 || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || now.dev !== info.dev || now.ino !== info.ino || now.isSymbolicLink() || realpathSync(path) !== path) throw new Error("changed file");
    const bytes = body.subarray(0, used);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (hidden(text) || secret(text)) throw new Error("unsupported content");
    return { text, sha: hash(bytes), mode: info.mode & 0o777, dev: info.dev, ino: info.ino };
  } finally { closeSync(fd); }
}

/** A model proposes text; the preview receipt binds ONLY the source hash, never attests generated content. */
export async function reviewPreviewEdit(options: {
  root: string; path: string; expected: string; content: unknown;
  signal: AbortSignal; allowed(): boolean;
  read(signal: AbortSignal): Promise<boolean>;
  write(content: string, signal: AbortSignal): Promise<boolean>;
  approve(reason: string, signal: AbortSignal): Promise<boolean>;
  checkpoint(before: string, expectedBefore: string, expectedAfter: string): boolean;
}): Promise<{ text: string; isError: boolean }> {
  if (typeof options.content !== "string" || Buffer.byteLength(options.content) > 256 * 1024 || Buffer.from(options.content).toString("utf8") !== options.content || hidden(options.content) || secret(options.content)) return { text: "Provide bounded UTF-8 replacement text without secret-shaped data or hidden controls.", isError: true };
  const content = options.content;
  const allowed = () => { try { return !options.signal.aborted && options.allowed(); } catch { return false; } };
  const deadline = new AbortController();
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), 120_000);
  let aborted: (() => void) | undefined;
  let temp: string | undefined, committed = false;
  try {
    const prepare = async () => {
      if (!allowed() || signal.aborted || !await options.read(signal) || !allowed() || signal.aborted) return undefined;
      const before = currentFile(options.root, options.path);
      if (before.sha !== options.expected || before.text === content) return undefined;
      // Full JSON text must fit: never authorize a clipped change. No whitespace ambiguity in quoted text.
      const quoted = (text: string) => JSON.stringify(text).replace(/\s/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      const reason = `One file edit; undo copy required. File: ${quoted(relative(options.root, options.path))}. Before: ${quoted(before.text)}. After: ${quoted(content)}`;
      if (reason.length > 600) return undefined;
      if (!await options.write(content, signal) || !allowed() || signal.aborted) return undefined;
      if (!await options.approve(reason, signal) || !allowed() || signal.aborted) return undefined;
      return before;
    };
    const before = await Promise.race([
      prepare(),
      new Promise<undefined>((resolve) => { aborted = () => resolve(undefined); signal.addEventListener("abort", aborted, { once: true }); if (signal.aborted) aborted(); }),
    ]);
    if (!before || !allowed() || signal.aborted) return { text: "Preview edit was refused, stale, unchanged, stopped, or too large for a complete 600-character before/after review. No replacement ran. Do not automatically retry or use Write/Edit to bypass a declined or uncertain review; await fresh user direction.", isError: true };
    const now = currentFile(options.root, options.path);
    if (now.sha !== options.expected || now.dev !== before.dev || now.ino !== before.ino || now.mode !== before.mode) return { text: "The source changed during review. No replacement ran; request a fresh preview.", isError: true };
    if (!options.checkpoint(now.text, options.expected, hash(content))) return { text: "A verified undo copy could not be secured. The preview edit was refused; no replacement ran.", isError: true };
    // There are no awaits from checkpoint arming through replacement. External editors still have a race window.
    if (!allowed() || signal.aborted) return { text: "Stopped before replacement. The armed checkpoint may show a conflict; no replacement ran.", isError: true };
    const parent = dirname(options.path), directory = lstatSync(parent);
    if (realpathSync(parent) !== parent || !directory.isDirectory()) throw new Error("changed parent");
    temp = join(parent, `.atom-preview-edit-${randomUUID()}`);
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let stage;
    try { writeFileSync(fd, content, "utf8"); fchmodSync(fd, now.mode); fsyncSync(fd); stage = fstatSync(fd); } finally { closeSync(fd); }
    const last = currentFile(options.root, options.path), parentNow = lstatSync(parent), staged = currentFile(options.root, temp);
    if (!allowed() || signal.aborted || staged.sha !== hash(content) || staged.dev !== stage.dev || staged.ino !== stage.ino || last.sha !== options.expected || last.dev !== before.dev || last.ino !== before.ino || last.mode !== before.mode || parentNow.dev !== directory.dev || parentNow.ino !== directory.ino || realpathSync(parent) !== parent) throw new Error("changed before commit");
    renameSync(temp, options.path); committed = true; temp = undefined;
    if (currentFile(options.root, options.path).sha !== hash(content)) throw new Error("changed after commit");
    return { text: "The separately approved text replacement was applied to one file. Its verified undo copy is listed with the task after it ends. This does not attest shell output, a build/test result, or a transaction across files.", isError: false };
  } catch {
    return { text: committed ? "Replacement was dispatched, but its final state could not be confirmed. Review the file and task checkpoint; do not automatically retry or overwrite it." : "The preview edit could not be safely completed; no replacement was dispatched. Its armed checkpoint may show a conflict. Request a fresh review rather than retrying automatically.", isError: true };
  } finally {
    clearTimeout(timer); deadline.abort();
    if (aborted) signal.removeEventListener("abort", aborted);
    if (temp) { try { unlinkSync(temp); } catch { return { text: "Preview edit staging-file cleanup could not be confirmed. No successful outcome is claimed; review the file and task checkpoint before another attempt.", isError: true }; } }
  }
}
