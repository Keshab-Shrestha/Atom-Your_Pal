import { checkGrant } from "@atom/helpers";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IslandHelpers } from "./island-types.ts";

type FolderRecord = { agent: string; path: string; identity: string };
export type ArkAgentAccessInput =
  | { action: "preview"; agent: string; expectedRevision: string; path: string }
  | { action: "grant"; agent: string; expectedRevision: string; token: string }
  | { action: "revoke"; agent: string; expectedRevision: string; path: string };
export type ArkAgentAccessCommand = { type: "ark.agent.access"; request: string; input: ArkAgentAccessInput };
export type ArkAgentAccessEvent = { type: "ark.agent.access.result"; request: string; value?: unknown; error?: string };
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parseArkAgentAccess(value: Record<string, unknown>): ArkAgentAccessCommand | undefined {
  const input = value.input;
  if (typeof value.request !== "string" || !/^[a-f0-9-]{36}$/i.test(value.request) || !isRecord(input) || typeof input.agent !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(input.agent) || typeof input.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedRevision)) return;
  const base = { type: "ark.agent.access" as const, request: value.request };
  if ((input.action === "preview" || input.action === "revoke") && typeof input.path === "string" && input.path.length <= 4096 && !input.path.includes("\0")) return { ...base, input: { action: input.action, agent: input.agent, expectedRevision: input.expectedRevision, path: input.path } };
  if (input.action === "grant" && typeof input.token === "string" && /^[a-f0-9-]{36}$/i.test(input.token)) return { ...base, input: { action: input.action, agent: input.agent, expectedRevision: input.expectedRevision, token: input.token } };
  return;
}

export function createArkAgentAccess(options: { helpers: IslandHelpers; home: string; file?: string }) {
  const { helpers, home, file } = options;
  let memoryRecords: FolderRecord[] = [];
  const previews = new Map<string, { agent: string; path: string; identity: string; revision: string; expires: number }>();
  const identity = (path: string) => {
    const real = checkGrant(path, home);
    if (real !== path) throw new Error("The folder target changed. Review its resolved location again.");
    const info = statSync(real, { bigint: true });
    return sha([real, String(info.dev), String(info.ino)]);
  };
  const records = (): { rows: FolderRecord[]; available: boolean } => {
    try {
      if (!file) return { rows: memoryRecords, available: true };
      if (!existsSync(file)) return { rows: [], available: true };
      const info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 262144) throw new Error("Invalid access records");
      const value: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.folders) || value.folders.length > 512) throw new Error("Invalid access records");
      const rows: FolderRecord[] = [];
      for (const row of value.folders) {
        if (!isRecord(row) || typeof row.agent !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(row.agent) || typeof row.path !== "string" || row.path.length > 4096 || row.path.includes("\0") || typeof row.identity !== "string" || !/^[a-f0-9]{64}$/.test(row.identity) || rows.some((existing) => existing.agent === row.agent && existing.path === row.path)) throw new Error("Invalid access records");
        rows.push({ agent: row.agent, path: row.path, identity: row.identity });
      }
      return { rows, available: true };
    } catch { return { rows: [], available: false }; }
  };
  const save = (rows: FolderRecord[]) => {
    const known = new Set(helpers.list().map((agent) => agent.id));
    if (!file) { memoryRecords = rows.filter((row) => known.has(row.agent)); return; }
    const temporary = `${file}.${randomUUID()}.tmp`;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, folders: rows.filter((row) => known.has(row.agent)) }), { mode: 0o600, flag: "wx" });
      renameSync(temporary, file);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  };
  const policy = (id: string) => {
    const agent = helpers.list().find((candidate) => candidate.id === id);
    if (!agent) throw new Error("That agent is unavailable.");
    const saved = records();
    const folders = agent.grants.map((path) => {
      const expected = saved.rows.find((row) => row.agent === id && row.path === path)?.identity;
      try {
        const observed = identity(path);
        return { path, state: !expected ? "unverified" as const : observed === expected ? "verified" as const : "changed" as const, identity: observed };
      } catch {
        return { path, state: existsSync(path) ? "invalid" as const : "missing" as const, identity: "" };
      }
    }).sort((a, b) => a.path.localeCompare(b.path));
    const toolKinds = agent.kit === "research" ? ["web.search", "web.read"] : agent.kit === "folders" ? ["file.read", "file.write"] : [];
    const blockers = [
      ...(!agent.available ? ["This agent is unavailable."] : []),
      ...(agent.paused ? ["This agent is paused."] : []),
      ...(!saved.available ? ["Saved folder identities could not be checked. Folder additions are blocked."] : []),
      ...(agent.kit === "folders" && !folders.length ? ["Review at least one folder before launching file work."] : []),
      ...(folders.some((folder) => folder.state !== "verified") ? ["One or more folders need review before they can be used."] : []),
      "Provider enforcement is not connected yet. Agent-profile task launches remain blocked.",
    ];
    return {
      kind: "agent" as const, agent: id, name: agent.name, kit: agent.kit, soulVersion: agent.soulVersion,
      available: agent.available, paused: agent.paused, skills: agent.skills, folders, toolKinds,
      launchAllowed: false as const, blockers,
      revision: sha([id, agent.kit, agent.soul, agent.soulVersion, agent.available, agent.paused, [...agent.skills].sort(), folders, saved.available]),
    };
  };
  const update = (input: ArkAgentAccessInput) => {
    const before = policy(input.agent);
    if (before.revision !== input.expectedRevision) throw new Error("This agent's access changed. Reload its access before continuing.");
    if (input.action === "revoke") {
      if (!before.folders.some((folder) => folder.path === input.path)) throw new Error("That folder is no longer assigned to this agent. Reload access.");
      helpers.removeGrant(input.agent, input.path);
      const saved = records();
      if (saved.available) save(saved.rows.filter((row) => row.agent !== input.agent || row.path !== input.path));
      for (const [token, preview] of previews) if (preview.agent === input.agent) previews.delete(token);
      return { policy: policy(input.agent), agents: helpers.list() };
    }
    if (before.kit !== "folders") throw new Error("Only the folders tool kit can receive folder access.");
    const saved = records();
    if (!saved.available) throw new Error("Saved folder identities could not be checked. No folder was added.");
    if (input.action === "preview") {
      const path = checkGrant(input.path, home), observed = identity(path);
      for (const [token, preview] of previews) if (preview.expires <= Date.now() || preview.agent === input.agent) previews.delete(token);
      if (previews.size >= 64) throw new Error("Too many folder reviews are open. Close another review and try again.");
      const token = randomUUID();
      previews.set(token, { agent: input.agent, path, identity: observed, revision: before.revision, expires: Date.now() + 300000 });
      return { policy: before, preview: { token, path, replaces: before.folders.some((folder) => folder.path === path) } };
    }
    const preview = previews.get(input.token);
    previews.delete(input.token);
    if (!preview || preview.agent !== input.agent || preview.expires <= Date.now() || preview.revision !== before.revision) throw new Error("That folder review expired or changed. Preview the folder again.");
    if (identity(preview.path) !== preview.identity) throw new Error("The reviewed folder changed. Preview it again before granting access.");
    if (!before.folders.some((folder) => folder.path === preview.path)) helpers.addGrant(input.agent, preview.path);
    try { save([...saved.rows.filter((row) => row.agent !== input.agent || row.path !== preview.path), { agent: input.agent, path: preview.path, identity: preview.identity }]); }
    catch { throw new Error("The folder identity could not be saved. Reopen access to check its state before retrying."); }
    return { policy: policy(input.agent), agents: helpers.list() };
  };
  return { policy, update };
}
