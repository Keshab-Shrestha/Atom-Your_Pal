import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import type { Tool } from "@ark/tool-engine";
import { expandHome, realish } from "@ark/helpers";

/**
 * 2026-11-01 (Keshab: "ask and give any permission, like Claude Code"; a delete goes to the Trash): trash_file moves one file or folder
 * to ~/.Trash, so it can be put back from Finder. The safety gate asks before every call (native-safety, folderCheck's `Trash`), unless
 * the chat is in Full access. Only agents with the folders kit have it; the main chat hands deletes to them.
 */
export const TRASH_TOOL = "trash_file";

/** Moves `path` into `trash` under a name that is free there ("a.txt", "a 2.txt", ...). Returns where it went. */
export function moveToTrash(path: string, trash = join(homedir(), ".Trash")): string {
  mkdirSync(trash, { recursive: true });
  const name = basename(path), ext = extname(name), stem = ext ? name.slice(0, -ext.length) : name;
  let target = join(trash, name);
  for (let n = 2; existsSync(target); n++) target = join(trash, `${stem} ${n}${ext}`);
  try {
    renameSync(path, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    // Another disk: copy, then remove the original only once the copy is there.
    cpSync(path, target, { recursive: true, errorOnExist: true, verbatimSymlinks: true });
    rmSync(path, { recursive: true });
  }
  return target;
}

export function createTrashTool(options: { home?: string; trash?: string } = {}): Tool {
  const home = options.home ?? homedir();
  return {
    spec: {
      name: TRASH_TOOL,
      description: "Move one file or folder to the macOS Trash (Keshab can put it back from Finder). Keshab is asked first. Give the full path.",
      inputSchema: { type: "object", properties: { path: { type: "string", description: "The full path of the file or folder." } }, required: ["path"] },
    },
    run(input) {
      const raw = typeof input.path === "string" ? input.path.trim() : "";
      if (!raw) throw new Error("Give the path of the file or folder to move to the Trash.");
      const real = realish(resolve(isAbsolute(raw) || raw.startsWith("~") ? expandHome(raw, home) : raw));
      if (!existsSync(real) && !isLink(real)) throw new Error(`${raw} does not exist.`);
      // Never a whole home folder, a disk or the system: those are not "a file".
      if (real === "/" || real === realish(home) || /^\/Volumes\/[^/]+\/?$/.test(real) || /^\/(?:System|Library|Applications|Users|usr|bin|sbin|private|etc|var)\/?$/.test(real)) {
        throw new Error(`${raw} is a whole home folder, disk or system folder; it is not moved to the Trash.`);
      }
      const to = moveToTrash(real, options.trash);
      return `Moved ${raw} to the Trash (${basename(to)}).`;
    },
  };
}

function isLink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}
