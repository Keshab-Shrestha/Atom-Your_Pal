import { gitWorkspace, gitFileReview, gitPathAvailable, type GitWorkspace, type GitReview, type GitSection } from "./git-review.ts";
import { lstatSync, opendirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { checkGrant, isSecretLike, readFilePreview, type HelperStore, type WorkspaceChange, type WorkspaceReview } from "@atom/helpers";

export type WorkspaceAction = "list" | "read" | "changes" | "review" | "undo" | "git" | "gitReview";
export interface WorkspaceRequest {
  type: "workspace"; request: string; chat: string; project: string; action: WorkspaceAction;
  path: string; job?: number; token?: string; section?: GitSection;
}
export interface WorkspaceEntry { path: string; name: string; directory: boolean }
export interface WorkspaceResponse {
  type: "workspace"; request: string; chat: string; project: string; action: WorkspaceAction; path: string;
  ok: boolean; error?: string; root?: string; entries?: WorkspaceEntry[]; limited?: boolean;
  gitStatus?: GitWorkspace; gitReview?: GitReview; section?: GitSection;
  text?: string; absolute?: string; changes?: WorkspaceChange[]; review?: WorkspaceReview; notice?: string;
}
export interface WorkspaceProject { folder: string; archived: boolean }
const skipped = new Set(["node_modules", "vendor", "build", "dist", "target", "Pods", "DerivedData"]);
function workspaceName(root: string, path: string, home: string): string {
  if (path.length > 4096 || path.startsWith("/") || path.includes(":") || /[\\`$\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(path)) throw new Error("Choose a file inside this project.");
  const parts = path ? path.split("/") : [];
  if (parts.some((p) => !p || p === ".." || p.startsWith(".") || p.toLowerCase().startsWith("id_ed25519") || skipped.has(p))) throw new Error("Hidden, generated and linked paths are excluded from the workspace.");
  const absolute = resolve(root, path);
  if ((absolute !== root && !absolute.startsWith(root + "/")) || isSecretLike(absolute, home)) throw new Error("That path is unavailable or protected.");
  return absolute;
}
export function workspacePath(root: string, path: string, home: string, directory = false): string {
  const absolute = workspaceName(root, path, home);
  if (realpathSync(absolute) !== absolute) throw new Error("Linked paths are excluded from the workspace.");
  const info = lstatSync(absolute);
  if (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) throw new Error("That path is not an available regular file or folder.");
  return absolute;
}

/** Local window only. Each command is synchronous, freshly scoped to its current chat/project by runIsland. */
export function createProjectWorkspace(options: { project(id: string): WorkspaceProject | undefined; helpers?: HelperStore; home?: string }) {
  const home = options.home ?? homedir();
  let readingGit = false;
  const projectRoot = (id: string) => {
    const project = options.project(id);
    if (!project || project.archived) throw new Error("This project is no longer available. Reopen an active project chat.");
    const root = checkGrant(project.folder, home);
    if (root !== project.folder) throw new Error("The project folder moved or became a link. Reopen the project.");
    workspacePath(root, "", home, true);
    return root;
  };
  return {
    async git(command: WorkspaceRequest): Promise<WorkspaceResponse> {
      const result: WorkspaceResponse = { type: "workspace", request: command.request, chat: command.chat, project: command.project, action: command.action, path: command.path, ...(command.section ? { section: command.section } : {}), ok: false };
      if (readingGit) return { ...result, error: "A Git read is still finishing. Refresh in a moment." };
      readingGit = true;
      try {
        const root = projectRoot(command.project);
        const allowed = (path: string) => { try { workspaceName(root, path, home); return gitPathAvailable(root, path); } catch { return false; } };
        if (command.action === "git") result.gitStatus = await gitWorkspace(root, allowed);
        else if (command.action === "gitReview" && command.section) {
          const status = await gitWorkspace(root, allowed);
          const file = status.files.find((f) => f.path === command.path && f.section === command.section);
          if (!file) throw new Error("That change is no longer in this Git snapshot. Refresh the list.");
          result.gitReview = await gitFileReview(root, file, allowed);
        } else throw new Error("Choose a Git status or file review.");
        if (projectRoot(command.project) !== root) throw new Error("The project changed while reading Git. Refresh it.");
        result.root = root; result.ok = true;
      } catch {
        // Git stderr/config/filter commands may contain private content: never forward or log them.
        return { ...result, gitStatus: undefined, gitReview: undefined, error: "Git review is unavailable or exceeded its text/time budget. Check that this is a Git working tree, then refresh. Only supported regular text files can be compared." };
      } finally { readingGit = false; }
      return result;
    },
    handle(command: WorkspaceRequest): WorkspaceResponse {
      const result: WorkspaceResponse = { type: "workspace", request: command.request, chat: command.chat, project: command.project, action: command.action, path: command.path, ok: false };
      try {
        const project = options.project(command.project);
        if (!project || project.archived) throw new Error("This project is no longer available. Reopen an active project chat.");
        const root = checkGrant(project.folder, home);
        if (root !== project.folder) throw new Error("The project folder moved or became a link. Reopen the project.");
        workspacePath(root, "", home, true);
        result.root = root;
        if (command.action === "list") {
          const path = workspacePath(root, command.path, home, true);
          const dir = opendirSync(path); const entries: WorkspaceEntry[] = [];
          let visited = 0, listedBytes = 0;
          try {
            for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
              if (++visited > 1000 || entries.length >= 300) { result.limited = true; break; }
              const child = relative(root, join(path, entry.name));
              try {
                const directory = entry.isDirectory();
                if (!directory && !entry.isFile()) continue;
                workspacePath(root, child, home, directory);
                const item = { path: child, name: entry.name, directory };
                listedBytes += Buffer.byteLength(JSON.stringify(item));
                if (listedBytes > 128 * 1024) { result.limited = true; break; }
                entries.push(item);
              } catch { /* Omit protected, disappeared and unsupported entries; no content is read. */ }
            }
          } finally { dir.closeSync(); }
          if (workspacePath(root, command.path, home, true) !== path) throw new Error("The folder changed. Refresh it.");
          result.entries = entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
        } else if (command.action === "read") {
          result.absolute = workspacePath(root, command.path, home);
          result.text = readFilePreview(result.absolute).text;
        } else {
          const helpers = options.helpers;
          if (!helpers) throw new Error("Task change tracking is unavailable.");
          if (command.action === "changes") {
            const changes = helpers.workspaceChanges(root);
            result.limited = changes.limited;
            result.changes = [];
            let listedBytes = 0;
            for (const change of changes.changes) {
              // Metadata may refer to a deleted file, but never reveal excluded names or another root.
              try { if (workspaceName(root, change.path, home) !== change.absolute) continue; } catch { continue; }
              listedBytes += Buffer.byteLength(JSON.stringify(change));
              if (listedBytes > 256 * 1024) { result.limited = true; break; }
              result.changes.push(change);
            }
            result.notice = "Tracked task edits only; original copies are normally kept for 14 days. Git-backed work and shell edits may have no checkpoint: use branch review for those.";
          } else {
            const absolute = workspacePath(root, command.path, home);
            if (!command.job) throw new Error("Choose the task that changed this file.");
            if (command.action === "review") result.review = helpers.workspaceReview(command.job, root, absolute);
            else {
              if (!command.token) throw new Error("Review the current change before undoing.");
              const undone = helpers.workspaceUndo(command.job, root, absolute, command.token);
              if (undone.length !== 1 || undone[0]?.result !== "restored") throw new Error(undone[0]?.reason ?? "Undo was not confirmed. Refresh the file.");
              result.notice = "File change undone.";
            }
          }
        }
        result.ok = true;
      } catch (error) {
        // Do not send OS errors containing unrestricted paths, copied contents or provider text.
        const message = error instanceof Error ? error.message : "";
        result.error = /^[A-Z]/.test(message) && !/\b(?:ENOENT|EACCES|EPERM|ELOOP)\b/.test(message) ? message : "This file or its original copy is unavailable. Refresh the workspace.";
      }
      return result;
    },
  };
}
