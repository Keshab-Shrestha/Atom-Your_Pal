import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { HelperError } from "./jobs.ts";
import { SKILL_DRAFT_NAME, parseSkillFile, skillFile, writeSkill } from "./skill-drafts.ts";
import type { HelperChange } from "./store-types.ts";

// B3.5, ADR-102: skills from a pinned public repo. Keshab sees a preview with review flags and approves it into ZENO's
// folder (`data/skills/<name>/SKILL.md`). One file only; nothing runs; no worker gets the skill; never updated by itself.
// The network lives in apps/mac/src/skill-hub.ts. This module never logs and never sends skill text anywhere.

/** A hub skill's text over this many characters is refused, never cut. */
export const MAX_HUB_BODY = 16000;
export const MAX_HUB_DESCRIPTION = 1024;
export const MAX_HUB_PENDING = 3;
export const MAX_HUB_INSTALLED = 30;
/** `skills/<name>/SKILL.md` or `<name>/SKILL.md`: one plain folder name, never a path. */
export const HUB_PATH = /^(?:skills\/)?([^/\\]+)\/SKILL\.md$/;
const HUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HUB_SHA = /^[0-9a-f]{40}$/;
const EXCERPT_CHARS = 100;
const FLAGS_PER_KIND = 5;

export const SKILL_HUB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS skill_hub_installs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('new', 'update')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    repo TEXT NOT NULL,
    path TEXT NOT NULL,
    sha TEXT NOT NULL,
    text TEXT NOT NULL,
    flags TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skill_hub (
    name TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    path TEXT NOT NULL,
    sha TEXT NOT NULL,
    origin_url TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    installed_at TEXT NOT NULL,
    previous_text TEXT,
    previous_sha TEXT
  );
`;

export interface ReviewFlag {
  kind: string;
  severity: "warn" | "info";
  excerpt: string;
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const cut = (text: string, max = EXCERPT_CHARS) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// Zero-width, bidi and tag characters: text a reader cannot see.
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿\u{E0000}-\u{E007F}]/gu;

/** (kind, severity, pattern, what to show): each pattern is checked on the whole text. */
const PATTERNS: readonly [string, "warn" | "info", RegExp][] = [
  ["url", "info", /https?:\/\/[^\s)>\]"'`]+/gi],
  ["shell-block", "warn", /```[ \t]*(?:sh|bash|zsh|shell|console|powershell|ps1)\b[^\n]*\n[^\n]*/gi],
  ["shell-command", "warn", /.*(?:\b(?:curl|wget|sudo|chmod|ssh|eval|base64)\b|\brm\s+-[a-z]*r[a-z]*f?\b|\|\s*(?:ba|z)?sh\b).*/gi],
  ["injection", "warn", /\b(?:ignore|disregard)\s+(?:(?:all|any|the|your|every)\s+)*(?:previous|prior|above|earlier|all|instructions)\b|\byou are now\b|\bsystem prompt\b|\bdo not tell the user\b|\bsecretly\b/gi],
  ["tool-request", "warn", /\b(?:Bash|WebFetch|WebSearch)\b|`(?:Write|Edit)`|\b(?:Write|Edit) tool\b|\bmcp__[\w-]+|\ballowed-tools\b/g],
  ["secret-path", "warn", /(?:\.env\b|\.ssh\b|api[-_]?token|keychain)/gi],
  ["missing-file", "info", /\b(?:scripts|references|assets)\/[\w./-]+/g],
  ["html-comment", "warn", /<!--[\s\S]*?-->/g],
  ["base64-run", "warn", /[A-Za-z0-9+/]{200,}={0,2}/g],
];

/** The front matter's keys, other than name and description (they are dropped when the skill is saved). */
function droppedKeys(text: string): string[] {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!m) return [];
  const keys = m[1]!.split("\n").map((l) => /^([A-Za-z][\w-]*)\s*:/.exec(l)?.[1]).filter((k): k is string => Boolean(k));
  return [...new Set(keys.filter((k) => k !== "name" && k !== "description"))];
}

/**
 * What a reader should look at before approving. Pure and deterministic: no model, no network. A flag never approves or
 * refuses anything (see `hubRefusal` for the two refusals).
 */
export function reviewFlags(text: string): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const seen = new Set<string>();
  const add = (kind: string, severity: "warn" | "info", excerpt: string) => {
    const key = `${kind}\u0000${excerpt}`;
    if (seen.has(key) || flags.filter((f) => f.kind === kind).length >= FLAGS_PER_KIND) return;
    seen.add(key);
    flags.push({ kind, severity, excerpt });
  };
  for (const [kind, severity, pattern] of PATTERNS) {
    for (const m of text.matchAll(pattern)) add(kind, severity, kind === "base64-run" ? `${m[0].length} characters of base64` : cut(flat(m[0])));
  }
  for (const m of text.matchAll(HIDDEN_CHARS)) add("hidden-char", "warn", `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
  const dropped = droppedKeys(text);
  if (dropped.length) add("front-matter", "info", `Left out when saved: ${dropped.join(", ")}`);
  return flags;
}

/** The two hard refusals: text that hides characters, and text over the size limit. Undefined when the text may be previewed. */
export function hubRefusal(text: string): string | undefined {
  if (text.length > MAX_HUB_BODY) return `That skill is over ${MAX_HUB_BODY} characters, so ZENO does not take it.`;
  if (new RegExp(HIDDEN_CHARS.source, "u").test(text)) return "That skill has hidden characters (zero-width or text-direction marks), so ZENO does not take it.";
  return undefined;
}

export interface HubPending {
  id: number;
  kind: "new" | "update";
  name: string;
  description: string;
  repo: string;
  path: string;
  sha: string;
  text: string;
  flags: ReviewFlag[];
  createdAt: Date;
}

export interface HubInstalled {
  name: string;
  repo: string;
  path: string;
  sha: string;
  originUrl: string;
  installedAt: Date;
  /** After an update: the earlier text can be restored once. */
  canUndo: boolean;
}

interface PendingRow {
  id: number;
  kind: string;
  name: string;
  description: string;
  repo: string;
  path: string;
  sha: string;
  text: string;
  flags: string;
  created_at: string;
}

interface InstalledRow {
  name: string;
  repo: string;
  path: string;
  sha: string;
  origin_url: string;
  sha256: string;
  installed_at: string;
  previous_text: string | null;
  previous_sha: string | null;
}

const toPending = (r: PendingRow): HubPending => ({
  id: r.id,
  kind: r.kind as "new" | "update",
  name: r.name,
  description: r.description,
  repo: r.repo,
  path: r.path,
  sha: r.sha,
  text: r.text,
  flags: JSON.parse(r.flags) as ReviewFlag[],
  createdAt: new Date(r.created_at),
});

const toInstalled = (r: InstalledRow): HubInstalled => ({
  name: r.name,
  repo: r.repo,
  path: r.path,
  sha: r.sha,
  originUrl: r.origin_url,
  installedAt: new Date(r.installed_at),
  canUndo: r.previous_text !== null,
});

const originUrl = (repo: string, sha: string, path: string) => `https://github.com/${repo}/blob/${sha}/${path}`;

export interface SkillHubDeps {
  db: DatabaseSync;
  now: () => Date;
  skillsDir?: string;
  userSkillsDir: string;
  emit(change: HelperChange): void;
}

/** What a fetched file must say about itself before it is previewed. */
export interface HubFile {
  repo: string;
  path: string;
  sha: string;
  text: string;
}

/** The store's skills hub operations (see HelperStore for each one's contract). */
export function skillHubStore(deps: SkillHubDeps) {
  const { db, now, skillsDir, userSkillsDir, emit } = deps;
  db.exec(SKILL_HUB_SCHEMA);
  const q = {
    pending: db.prepare("SELECT * FROM skill_hub_installs WHERE id = ?"),
    allPending: db.prepare("SELECT * FROM skill_hub_installs ORDER BY id"),
    pendingNamed: db.prepare("SELECT id FROM skill_hub_installs WHERE name = ?"),
    countPending: db.prepare("SELECT COUNT(*) AS n FROM skill_hub_installs"),
    addPending: db.prepare("INSERT INTO skill_hub_installs (kind, name, description, repo, path, sha, text, flags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    dropPending: db.prepare("DELETE FROM skill_hub_installs WHERE id = ?"),
    installed: db.prepare("SELECT * FROM skill_hub WHERE name = ?"),
    allInstalled: db.prepare("SELECT * FROM skill_hub ORDER BY name"),
    countInstalled: db.prepare("SELECT COUNT(*) AS n FROM skill_hub"),
    install: db.prepare("INSERT INTO skill_hub (name, repo, path, sha, origin_url, sha256, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    replace: db.prepare("UPDATE skill_hub SET sha = ?, origin_url = ?, sha256 = ?, installed_at = ?, previous_text = ?, previous_sha = ? WHERE name = ?"),
    remove: db.prepare("DELETE FROM skill_hub WHERE name = ?"),
    unchoose: db.prepare("DELETE FROM helper_skills WHERE skill = ?"),
  };
  const count = (stmt: { get(): unknown }) => Number((stmt.get() as { n: number }).n);
  const pendingOf = (id: number) => {
    const row = q.pending.get(id) as unknown as PendingRow | undefined;
    return row ? toPending(row) : undefined;
  };
  const rowOf = (name: string) => q.installed.get(name) as unknown as InstalledRow | undefined;
  const fileOf = (name: string) => join(skillsDir!, name, "SKILL.md");
  const needDir = () => {
    if (!skillsDir) throw new HelperError("ZENO's skills folder is not set up, so a skill cannot be saved.");
  };
  /** The folder is exactly what was written: one SKILL.md with the recorded hash. */
  const untouched = (row: InstalledRow) => {
    try {
      return readdirSync(join(skillsDir!, row.name)).join() === "SKILL.md" && sha256(readFileSync(fileOf(row.name), "utf8")) === row.sha256;
    } catch {
      return false;
    }
  };
  const parsed = (text: string) => {
    const { description, body } = parseSkillFile(text);
    return { description: cut(flat(description) || "(no description)", MAX_HUB_DESCRIPTION), body };
  };

  /** Validates a fetched file and returns the skill's name. */
  function checked(file: HubFile): string {
    const name = HUB_PATH.exec(file.path)?.[1] ?? "";
    if (!HUB_REPO.test(file.repo) || !HUB_SHA.test(file.sha) || file.path.includes("..") || !SKILL_DRAFT_NAME.test(name)) {
      throw new HelperError("That is not a skill ZENO can take: its name is 2 to 41 lower-case letters, digits and dashes.");
    }
    const refusal = hubRefusal(file.text);
    if (refusal) throw new HelperError(refusal);
    return name;
  }

  function addPending(kind: "new" | "update", name: string, file: HubFile, extra: ReviewFlag[]): HubPending {
    if (count(q.countPending) >= MAX_HUB_PENDING) throw new HelperError(`At most ${MAX_HUB_PENDING} skills from the hub wait for your answer. Answer one first.`);
    if (q.pendingNamed.get(name)) throw new HelperError(`A skill called "${name}" from the hub already waits for your answer.`);
    const { description } = parsed(file.text);
    const flags = [...extra, ...reviewFlags(file.text)];
    const id = Number(q.addPending.run(kind, name, description, file.repo, file.path, file.sha, file.text, JSON.stringify(flags), now().toISOString()).lastInsertRowid);
    emit({ action: "skillHub", id, skill: name, state: "pending" });
    return pendingOf(id)!;
  }

  return {
    /** A fetched skill is shown for Keshab's OK; nothing is written in ZENO's folder. */
    previewSkillHub(file: HubFile): HubPending {
      const name = checked(file);
      if (rowOf(name)) throw new HelperError(`"${name}" is installed from the hub already. Use Update to look for a newer version.`);
      const clash = existsSync(join(userSkillsDir, name)) || (skillsDir && existsSync(join(skillsDir, name)));
      return addPending("new", name, file, clash ? [{ kind: "name-clash", severity: "warn", excerpt: `A skill called "${name}" exists already, so it cannot be installed.` }] : []);
    },

    approveSkillHub(id: number) {
      const p = pendingOf(id);
      if (!p) throw new HelperError("No skill from the hub waits for an answer there.");
      needDir();
      const { body } = parsed(p.text);
      const written = skillFile(p.name, p.description, body);
      if (p.kind === "new") {
        if (existsSync(join(userSkillsDir, p.name))) throw new HelperError(`You already have a skill called "${p.name}" in ~/.claude/skills, and ZENO never changes yours. Reject this one.`);
        if (existsSync(join(skillsDir!, p.name))) throw new HelperError(`ZENO already has a skill called "${p.name}". Reject this one.`);
        if (count(q.countInstalled) >= MAX_HUB_INSTALLED) throw new HelperError(`At most ${MAX_HUB_INSTALLED} skills from the hub can be installed. Uninstall one first.`);
        writeSkill(skillsDir!, p.name, p.description, body);
        q.install.run(p.name, p.repo, p.path, p.sha, originUrl(p.repo, p.sha, p.path), sha256(written), now().toISOString());
      } else {
        const row = rowOf(p.name);
        if (!row) throw new HelperError(`"${p.name}" is not installed from the hub any more. Reject this update.`);
        if (!untouched(row)) throw new HelperError(`The ${p.name} skill has been changed by hand, so the update would overwrite it. Reject this update.`);
        const before = readFileSync(fileOf(p.name), "utf8");
        writeSkill(skillsDir!, p.name, p.description, body);
        q.replace.run(p.sha, originUrl(p.repo, p.sha, p.path), sha256(written), now().toISOString(), before, row.sha, p.name);
      }
      q.dropPending.run(id);
      emit({ action: "skillHub", id, skill: p.name, state: p.kind === "new" ? "approved" : "updated" });
    },

    rejectSkillHub(id: number) {
      const p = pendingOf(id);
      if (!p) throw new HelperError("No skill from the hub waits for an answer there.");
      q.dropPending.run(id);
      emit({ action: "skillHub", id, skill: p.name, state: "rejected" });
    },

    /** Removes the folder, the record and the workers' choice of it. A folder changed by hand stays unless `force`. */
    uninstallSkillHub(name: string, force = false) {
      const row = rowOf(name);
      if (!row || !SKILL_DRAFT_NAME.test(name)) throw new HelperError(`"${name.slice(0, 40)}" is not a skill from the hub.`);
      needDir();
      if (existsSync(join(skillsDir!, name)) && !force && !untouched(row)) {
        throw new HelperError(`The ${name} skill has been changed by hand since it was installed. Uninstall it anyway to delete those changes.`);
      }
      rmSync(join(skillsDir!, name), { recursive: true, force: true });
      q.remove.run(name);
      q.unchoose.run(name);
      emit({ action: "skillHub", skill: name, state: "uninstalled" });
    },

    /**
     * Keshab asked to look for a newer version: `file` is what the repo has now. Returns the pending update, or
     * undefined when it is the text that was installed. Writes nothing.
     */
    updateSkillHub(name: string, file: { sha: string; text: string }): HubPending | undefined {
      const row = rowOf(name);
      if (!row) throw new HelperError(`"${name.slice(0, 40)}" is not a skill from the hub.`);
      const next: HubFile = { repo: row.repo, path: row.path, sha: file.sha, text: file.text };
      checked(next);
      const { description, body } = parsed(file.text);
      if (sha256(skillFile(name, description, body)) === row.sha256) return undefined;
      return addPending("update", name, next, []);
    },

    /** Restores the text before the last update (once), unless the folder was changed by hand since. */
    undoSkillHub(name: string) {
      const row = rowOf(name);
      if (!row || row.previous_text === null) throw new HelperError("There is no hub update to undo for that skill.");
      needDir();
      if (!untouched(row)) throw new HelperError(`The ${name} skill has been changed by hand since the update, so undoing it would overwrite that.`);
      const file = fileOf(name);
      writeFileSync(`${file}.tmp`, row.previous_text);
      renameSync(`${file}.tmp`, file);
      const url = originUrl(row.repo, row.previous_sha ?? row.sha, row.path);
      q.replace.run(row.previous_sha ?? row.sha, url, sha256(row.previous_text), now().toISOString(), null, null, name);
      emit({ action: "skillHub", skill: name, state: "undone" });
    },

    isHubSkill: (name: string) => Boolean(rowOf(name)),
    skillHubPending: () => (q.allPending.all() as unknown as PendingRow[]).map(toPending),
    skillHubInstalled: () => (q.allInstalled.all() as unknown as InstalledRow[]).map(toInstalled),
  };
}
