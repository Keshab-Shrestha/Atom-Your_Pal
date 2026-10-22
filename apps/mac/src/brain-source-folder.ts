import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { checkGrant, floorProblem, isSecretLike } from "@atom/helpers";
import { looksSecret, type BrainSources, type SourceFile, type SourceSummary } from "@atom/memory";

export interface BrainSourceRequest {
  type: "brain.source"; request: string;
  action: "get" | "preview" | "cancel" | "connect" | "refresh" | "disconnect" | "restore";
  path?: string; token?: string; id?: number;
}
export interface SourcePreview { token: string; path: string; files: string[]; count: number; skipped: number }
export interface BrainSourceResponse { type: "brain.source"; request: string; state: SourceSummary; preview?: SourcePreview; error?: string }
interface Scan { path: string; identity: string; files: SourceFile[]; skipped: number }
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const fingerprint = (scan: Scan) => hash(JSON.stringify([scan.path, scan.identity, scan.files.map((file) => [file.path, file.hash]), scan.skipped]));
const identity = (stat: { dev: number; ino: number }) => `${stat.dev}:${stat.ino}`;

/** Explicit local read only. Bounds are scan budgets, not text-editor input limits. */
async function scanFolder(raw: string, home: string): Promise<Scan> {
  if (!isAbsolute(raw) || raw !== resolve(raw) || /[\x00-\x1f\x7f]/.test(raw)) throw new Error("Choose an ordinary notes folder using its absolute path.");
  const path = checkGrant(raw, home);
  const problem = floorProblem(home, [], path, path);
  if (problem || isSecretLike(path, home)) throw new Error(problem ?? "That folder holds protected data.");
  const root = await lstat(path);
  const result: Scan = { path, identity: identity(root), files: [], skipped: 0 };
  let entries = 0, bytes = 0;
  const deadline = Date.now() + 10_000;
  const guard = () => { if (Date.now() > deadline) throw new Error("Folder scan exceeded its time budget. Choose a smaller notes folder."); };
  const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
    guard();
    const dir = await lstat(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("A folder changed during the scan. Preview or refresh again.");
    const children: Dirent[] = [];
    for await (const child of await opendir(directory)) {
      guard();
      if (++entries > 5000) throw new Error("Folder exceeds the 5,000-entry scan budget. Choose a smaller notes folder.");
      children.push(child);
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      guard();
      const file = join(directory, child.name), relative = prefix + child.name;
      if (child.name.startsWith(".") || /[\x00-\x1f\x7f]/.test(child.name) || child.isSymbolicLink() || isSecretLike(file, home) || floorProblem(home, [], path, file)) { result.skipped++; continue; }
      const stat = await lstat(file);
      if (stat.isDirectory()) {
        if (depth >= 8) throw new Error("Folder exceeds the eight-level scan budget. Choose a smaller notes folder.");
        await walk(file, relative + "/", depth + 1);
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1 || ![".md", ".markdown", ".txt"].includes(extname(file).toLowerCase())) { result.skipped++; continue; }
      if (stat.size > 256 * 1024) { result.skipped++; continue; }
      if (result.files.length >= 500 || bytes + stat.size > 8 * 1024 * 1024) throw new Error("Folder exceeds the 500-note / 8 MiB scan budget. Choose a smaller notes folder.");
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 || identity(before) !== identity(stat) || await realpath(file) !== file) throw new Error("A file changed location during the scan. Nothing was imported.");
        const buffer = Buffer.alloc(256 * 1024 + 1);
        let size = 0;
        while (size < buffer.length) {
          const read = await handle.read(buffer, size, buffer.length - size, size);
          if (!read.bytesRead) break;
          size += read.bytesRead;
        }
        const after = await handle.stat();
        if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size || await realpath(file) !== file) throw new Error("A note changed during the scan. Refresh again; existing notes were kept.");
        bytes += size;
        if (bytes > 8 * 1024 * 1024) throw new Error("Folder exceeded its read budget. Existing notes were kept.");
        if (size > 256 * 1024) { result.skipped++; continue; }
        let body: string;
        try { body = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)); }
        catch { result.skipped++; continue; }
        if (body.includes("\0") || looksSecret(body)) { result.skipped++; continue; }
        const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(file, extname(file)).trim() || "Untitled note";
        result.files.push({ path: relative, title, body, hash: hash(buffer.subarray(0, size)) });
      } finally { await handle.close(); }
    }
    const after = await lstat(directory);
    if (identity(after) !== identity(dir) || dir.mtimeMs !== after.mtimeMs || await realpath(directory) !== directory) throw new Error("A folder changed during the scan. Existing notes were kept.");
  };
  await walk(path, "", 0);
  guard();
  if (identity(await lstat(path)) !== result.identity || checkGrant(path, home) !== path) throw new Error("The selected folder was replaced during the scan.");
  return result;
}

export function createBrainSourceFolder(options: { store: BrainSources; changed(): void; home?: string }) {
  const home = options.home ?? homedir();
  let busy = false;
  let pending: { token: string; scan: Scan; expires: number } | undefined;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const clearPreview = () => { pending = undefined; clearTimeout(previewTimer); };
  return async (request: BrainSourceRequest): Promise<BrainSourceResponse> => {
    const response = (extra: Partial<BrainSourceResponse> = {}): BrainSourceResponse => ({ type: "brain.source", request: request.request, state: options.store.summary(), ...extra });
    if (request.action === "get") return response();
    if (busy) return response({ error: "A source operation is still running. Wait for it to finish." });
    busy = true;
    try {
      if (request.action === "cancel") { clearPreview(); return response(); }
      if (request.action === "preview") {
        clearPreview();
        if (options.store.summary().folder) throw new Error("Remove the connected folder before choosing another.");
        const scan = await scanFolder(request.path!, home);
        pending = { token: randomUUID(), scan, expires: Date.now() + 5 * 60_000 };
        previewTimer = setTimeout(clearPreview, 5 * 60_000);
        previewTimer.unref();
        return response({ preview: { token: pending.token, path: scan.path, files: scan.files.slice(0, 50).map((file) => file.path), count: scan.files.length, skipped: scan.skipped } });
      }
      if (request.action === "disconnect") {
        clearPreview();
        options.store.disconnect();
      } else if (request.action === "connect") {
        const preview = pending; clearPreview();
        if (!preview || preview.token !== request.token || preview.expires < Date.now() || options.store.summary().folder) throw new Error("Preview expired. Choose the folder again before importing.");
        const scan = await scanFolder(preview.scan.path, home);
        if (fingerprint(scan) !== fingerprint(preview.scan)) throw new Error("The folder changed since preview. Preview it again before importing.");
        options.store.apply(scan, scan.files, scan.skipped);
      } else {
        const folder = options.store.summary().folder;
        if (!folder) throw new Error("Choose and connect a notes folder first.");
        const scan = await scanFolder(folder.path, home);
        if (scan.identity !== folder.identity) throw new Error("The connected folder was replaced. Remove it and preview the intended folder again.");
        options.store.apply(scan, scan.files, scan.skipped, request.action === "restore" ? request.id : undefined);
      }
      options.changed();
      return response();
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : "The notes source could not be updated. Existing notes were kept." });
    } finally { busy = false; }
  };
}
