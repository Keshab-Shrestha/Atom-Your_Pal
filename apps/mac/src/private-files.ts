import { chmodSync, existsSync } from "node:fs";

// 2026-10-15 (security review): data/helpers.db and data/memory.db hold MCP secrets and every chat; they were mode 0644 in a 0755
// folder, readable by any other account on the Mac. Only data/api-token was private. This makes the data folder, its databases (with
// their WAL files) and the log files owner-only. A failure never stops ATOM: it is returned, and the caller logs it.

const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;
const SIDE_FILES = ["", "-wal", "-shm"];

/** Makes each folder 0700 and each file (and a database's -wal and -shm) 0600. Missing paths are skipped. Returns what failed. */
export function makePrivate(paths: { dirs?: readonly string[]; files?: readonly string[]; databases?: readonly string[] }): string[] {
  const failed: string[] = [];
  const apply = (path: string, mode: number) => {
    if (!existsSync(path)) return;
    try {
      chmodSync(path, mode);
    } catch {
      failed.push(path);
    }
  };
  for (const dir of paths.dirs ?? []) apply(dir, PRIVATE_DIR);
  for (const file of paths.files ?? []) apply(file, PRIVATE_FILE);
  for (const db of paths.databases ?? []) for (const side of SIDE_FILES) apply(`${db}${side}`, PRIVATE_FILE);
  return failed;
}
