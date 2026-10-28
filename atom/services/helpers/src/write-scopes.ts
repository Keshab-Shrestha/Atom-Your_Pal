import { lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { HelperError } from "./jobs.ts";
import type { WorkPlan } from "./work-plan.ts";

export interface WriteScopeBinding {
  schema: "atom.write-scope/v1";
  root: string | null;
  /** null is an unknown non-project scope; a missing declaration in a project covers its entire root. */
  paths: string[] | null;
}

/** Literal relative file/directory declarations only; no permissions are inferred from them. */
export function parseWriteScope(value: unknown): string[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 32) throw new HelperError("writeScope must list at most 32 literal relative files or folders.");
  const paths = value.map((p: unknown) => {
    if (typeof p !== "string" || !p || p !== p.trim() || isAbsolute(p) || win32.isAbsolute(p) || /[\\\x00-\x1f\x7f*?\[\]{}~$]/.test(p)) {
      throw new HelperError("writeScope uses literal project-relative paths, not absolute paths, patterns or shell expressions.");
    }
    if (p === ".") return p;
    const segments = p.replace(/\/+$/, "").split("/");
    if (segments.some((s) => !s || s === "." || s === ".." || s.toLowerCase() === ".git")) throw new HelperError("writeScope cannot contain parent traversal, empty components or Git internals.");
    return segments.join("/");
  });
  return [...new Set(paths)];
}

const inside = (root: string, path: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
const key = (path: string) => path.normalize("NFC").toLowerCase();

/** Metadata-only resolution, including new paths. Dangling links, inaccessible ancestors and hard-linked files refuse. */
function scopePath(root: string, path: string): string {
  if (path === ".") return root;
  const pieces = path.split("/");
  let at = root;
  for (let i = 0; i < pieces.length; i++) {
    const next = resolve(at, pieces[i]!);
    let info;
    try { info = lstatSync(next); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new HelperError("A write-scope path cannot be inspected. Recheck the declared project paths.");
      const missing = resolve(at, ...pieces.slice(i));
      if (!inside(root, missing)) throw new HelperError("A write-scope path leaves the project.");
      return missing;
    }
    try { at = realpathSync.native(next); }
    catch { throw new HelperError("A write-scope link is dangling or cannot be resolved. Declare its real project target."); }
    if (!inside(root, at)) throw new HelperError("A write-scope link points outside the project.");
    if (relative(root, at).split(sep).some((p) => p.toLowerCase() === ".git")) throw new HelperError("A write-scope link targets Git internals.");
    const target = info.isSymbolicLink() ? statSync(at) : info;
    if ((!target.isFile() && !target.isDirectory()) || target.isFile() && target.nlink > 1 || i < pieces.length - 1 && !target.isDirectory()) {
      throw new HelperError("Write scopes require ordinary project files/directories without hard-linked files.");
    }
  }
  return at;
}

function resolveScope(declared: string[] | undefined, projectRoot?: string): WriteScopeBinding {
  let root: string | null = null;
  if (projectRoot) {
    try { root = realpathSync.native(projectRoot); if (!statSync(root).isDirectory()) throw new Error(); }
    catch { throw new HelperError("The plan's project folder is unavailable. Reopen it before preparing file scopes."); }
  }
  const paths = parseWriteScope(declared);
  if (!root && paths?.length) throw new HelperError("Explicit writeScope paths require a selected project.");
  return { schema: "atom.write-scope/v1", root, paths: root ? [...new Set((paths?.length ? paths : ["."]).map((p) => scopePath(root!, p)))].sort() : null };
}

/** Re-resolve declared paths before each admission; a retargeted link or changed project needs a new plan. */
export function currentWriteScope(portion: { writeScope?: string[]; scopeBinding?: WriteScopeBinding }, projectRoot?: string): WriteScopeBinding {
  const current = resolveScope(portion.writeScope, projectRoot);
  const saved = portion.scopeBinding;
  if (saved === undefined) {
    if (portion.writeScope !== undefined) throw new HelperError("This plan's write scopes lack a host binding. Prepare a new plan.");
    return current; // legacy: unknown/whole-project scope, never an inferred read-only scope
  }
  if (!saved || saved.schema !== "atom.write-scope/v1" || saved.root !== current.root || JSON.stringify(saved.paths) !== JSON.stringify(current.paths)) {
    throw new HelperError("The plan's project or resolved write paths changed. Prepare a new plan before starting this portion.");
  }
  return current;
}

/** Component-aware, conservative case/Unicode comparison; src and src-old do not overlap. */
export function writeScopesOverlap(a: WriteScopeBinding, b: WriteScopeBinding): boolean {
  if (a.paths === null || b.paths === null) return true;
  return a.paths.some((x) => b.paths!.some((y) => inside(key(x), key(y)) || inside(key(y), key(x))));
}

function ordered(plan: WorkPlan, a: number, b: number): boolean {
  const ancestors = (n: number): Set<number> => {
    const seen = new Set<number>(), pending = [...(plan.portions.find((p) => p.n === n)?.after ?? [])];
    while (pending.length) {
      const next = pending.pop()!;
      if (seen.has(next)) continue;
      seen.add(next); pending.push(...(plan.portions.find((p) => p.n === next)?.after ?? []));
    }
    return seen;
  };
  return ancestors(a).has(b) || ancestors(b).has(a);
}

/** Host binding is derived here, never taken from model fields. Persist it in the existing portion JSON. */
export function bindPlanWriteScopes(plan: WorkPlan, projectRoot?: string): WorkPlan {
  const bound = { ...plan, portions: plan.portions.map((p) => ({ ...p, scopeBinding: resolveScope(p.writeScope, projectRoot) })) };
  for (let i = 0; i < bound.portions.length; i++) {
    const a = bound.portions[i]!;
    for (const b of bound.portions.slice(i + 1)) {
      if (a.writeScope?.length && b.writeScope?.length && writeScopesOverlap(a.scopeBinding, b.scopeBinding) && !ordered(bound, a.n, b.n)) {
        throw new HelperError(`P${a.n} and P${b.n} have overlapping write scopes. Add an after dependency (including an earlier chain) or separate their paths.`);
      }
    }
  }
  return bound;
}
