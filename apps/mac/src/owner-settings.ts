// ADR-271: the owner's name, kept by the runtime in config/owner.json (next to config/island.json) as `{ "name": "…" }`.
// The island sends it with `owner.set` after every start and when the owner changes it. It reaches prompts through
// `ownerName()` in @ark/shared.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanOwnerName, ownerName, setOwnerName, type Logger } from "@ark/shared";

export interface OwnerSettings {
  /** Sets the name, saves it when it changed and returns the name in use. An empty or invalid name is refused (undefined). */
  set(name: unknown): string | undefined;
}

export function ownerPath(settingsPath: string): string {
  return join(dirname(settingsPath), "owner.json");
}

/** The saved name, or undefined when there is none or the file cannot be used (logged). Never throws. */
export function readSavedOwner(path: string, log?: Logger): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return cleanOwnerName((JSON.parse(readFileSync(path, "utf8")) as { name?: unknown } | null)?.name);
  } catch (error) {
    log?.warn("owner.ignored", { path, message: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

/** Reads the saved name into `ownerName()` now; `set` changes and saves it (a temp file, then rename). */
export function createOwnerSettings(path: string, log?: Logger): OwnerSettings {
  const saved = readSavedOwner(path, log);
  if (saved) setOwnerName(saved);
  return {
    set(input) {
      const name = cleanOwnerName(input);
      if (!name) return undefined;
      if (name === readSavedOwner(path) && name === ownerName()) return name;
      setOwnerName(name);
      try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify({ name }, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, path);
      } catch (error) {
        log?.warn("owner.save_failed", { message: error instanceof Error ? error.message : String(error) });
      }
      return name;
    },
  };
}
