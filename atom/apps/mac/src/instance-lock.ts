// One ATOM runtime per data folder. A second runtime that opened the helpers store would run its startup recovery
// and mark the live jobs of the first one as failed (CLOSED_WHILE_RUNNING). The lock file holds the owner's pid.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type InstanceLock = { ok: true; release(): void } | { ok: false; pid: number };

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // ESRCH: the process is gone
  }
}

function ownerOf(file: string): number | undefined {
  try {
    const pid = (JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown }).pid;
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined; // missing or unreadable: no live owner
  }
}

/** Takes the lock, taking over one left by a dead process. */
export function acquireInstanceLock(file: string): InstanceLock {
  const pid = process.pid;
  mkdirSync(dirname(file), { recursive: true });
  const body = JSON.stringify({ pid, startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, body, { flag: "wx" });
      return {
        ok: true,
        release: () => {
          if (ownerOf(file) === pid) unlinkSync(file);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const other = ownerOf(file);
      if (other !== undefined && isAlive(other)) return { ok: false, pid: other };
      try {
        unlinkSync(file); // stale: dead owner or unreadable file
      } catch {
        /* another process removed it first: try again */
      }
    }
  }
  return { ok: false, pid: ownerOf(file) ?? 0 };
}
