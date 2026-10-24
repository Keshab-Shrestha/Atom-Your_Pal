// Stages a file that the window hands over, so the runtime can be given a full path (the protocol's `files` are paths, and a web page never
// knows a real one). The runtime then runs its own checks (a real file, not a secret, a readable type, 10 MB) and copies the file into ATOM's
// folder; this staging copy is only a handoff. Each upload gets its own folder under one private root, keeps the file's own (sanitised) name
// so the runtime's secret-name check still sees it, and is removed after a while, and with the whole root when the bridge stops.

import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";

/** The runtime's own limit (MAX_ATTACH_BYTES in apps/mac/src/attachments.ts). A larger file is refused here before it is written. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** What may wait in the staging root at once. */
export const MAX_STAGED_BYTES = 256 * 1024 * 1024;
/** How long a staged file stays. The runtime copies it within moments of the message being sent. */
export const STAGED_TTL_MS = 2 * 60 * 60 * 1000;

export type UploadResult = { ok: true; path: string; size: number } | { ok: false; status: number; error: string };

/** C0 and DEL controls, and the two Unicode line separators (built from character codes so no raw separator sits in this source). */
const CONTROLS = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(0x1f) + String.fromCharCode(0x7f, 0x2028, 0x2029) + "]", "g");

/**
 * A name safe to keep on disk: no path parts, no control characters, at most 120 characters, the extension kept. A leading dot is KEPT: the
 * runtime refuses secret-looking names (".env", ".npmrc", ...) by the name it is given, and a staged ".env" must still look like one. A name
 * of dots only ("..") would name the folder itself, so it is replaced; the folder is private and unique, so nothing else needs hiding.
 */
export function safeUploadName(raw: string): string {
  let name = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  name = name.replace(CONTROLS, "").replace(/[<>:"|?*]/g, "_").trim().replace(/[. ]+$/, "");
  if (name === "") return "file";
  if ([...name].length > 120) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = [...name.slice(0, dot > 0 && ext ? dot : undefined)].slice(0, 120 - ext.length).join("") + ext;
  }
  // Windows reserves these device names, with or without an extension.
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name) ? `_${name}` : name;
}

export async function stagedBytes(root: string): Promise<number> {
  let total = 0;
  for (const dir of await readdir(root).catch(() => [])) {
    for (const file of await readdir(join(root, dir)).catch(() => [])) total += (await stat(join(root, dir, file)).catch(() => undefined))?.size ?? 0;
  }
  return total;
}

/** Removes uploads older than the time to live. */
export async function sweepUploads(root: string, now = Date.now(), ttlMs = STAGED_TTL_MS): Promise<void> {
  for (const dir of await readdir(root).catch(() => [])) {
    const info = await stat(join(root, dir)).catch(() => undefined);
    if (info && now - info.mtimeMs > ttlMs) await rm(join(root, dir), { recursive: true, force: true });
  }
}

/** Streams the request body to `<root>/<uuid>/<name>`, refusing past the size limit and leaving nothing behind on a failure. */
export async function stageUpload(root: string, req: IncomingMessage, rawName: string, now = Date.now()): Promise<UploadResult> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return { ok: false, status: 413, error: `That file is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB, too big to attach.` };
  await sweepUploads(root, now);
  if ((await stagedBytes(root)) > MAX_STAGED_BYTES) return { ok: false, status: 507, error: "Too many attachments are waiting. Try again in a moment." };
  const dir = join(root, randomUUID());
  await mkdir(dir, { mode: 0o700 });
  const path = join(dir, safeUploadName(rawName));
  const fail = async (status: number, error: string): Promise<UploadResult> => {
    await rm(dir, { recursive: true, force: true });
    return { ok: false, status, error };
  };
  let size = 0;
  const out = createWriteStream(path, { flags: "wx", mode: 0o600 });
  try {
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) {
          req.unpipe(out);
          out.destroy();
          reject(new RangeError("too big"));
        }
      });
      req.on("error", reject);
      req.on("aborted", () => reject(new Error("aborted")));
      out.on("error", reject);
      out.on("finish", resolve);
      req.pipe(out);
    });
  } catch (error) {
    return error instanceof RangeError ? fail(413, `That file is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB, too big to attach.`) : fail(400, "The file did not arrive. Try again.");
  }
  if (size === 0) return fail(400, "That file is empty.");
  return { ok: true, path, size };
}
