import { createHash } from "node:crypto";
import { HelperError } from "./jobs.ts";
import { parseWriteScope } from "./write-scopes.ts";

export interface TaskFileCheck {
  schema: "atom.file-check/v1";
  kind: "exists" | "contains" | "sha256";
  path: string;
  expected?: string;
}

/** Literal, bounded predicates; no command, expression, glob, test runner or model-declared result. */
export function taskFileChecks(value: unknown): TaskFileCheck[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 6) throw new HelperError("fileChecks lists at most six literal file predicates.");
  const seen = new Set<string>();
  const checks = value.map((raw: unknown): TaskFileCheck => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HelperError("A file check is {kind, path, expected?}.");
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["schema", "kind", "path", "expected"].includes(key))
      || row.schema !== undefined && row.schema !== "atom.file-check/v1"
      || typeof row.kind !== "string" || !["exists", "contains", "sha256"].includes(row.kind) || typeof row.path !== "string" || row.path.length > 4096) throw new HelperError("Unsupported file-check declaration.");
    const path = parseWriteScope([row.path])![0]!;
    if (path === "." || row.path.endsWith("/")) throw new HelperError("File checks name regular files, not directory scopes.");
    const kind = row.kind as TaskFileCheck["kind"];
    if (kind === "exists" ? row.expected !== undefined
      : typeof row.expected !== "string" || !row.expected.length || Buffer.byteLength(row.expected, "utf8") > 2048 || row.expected.includes("\0")
        || kind === "sha256" && !/^[a-f0-9]{64}$/.test(row.expected)) throw new HelperError("Contains checks need a nonempty bounded literal; sha256 needs a lowercase digest; exists has no expected field.");
    const check: TaskFileCheck = { schema: "atom.file-check/v1", kind, path, ...(kind !== "exists" ? { expected: row.expected as string } : {}) };
    const key = path.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new HelperError("Use one predicate per file; contains and sha256 already require the file to exist.");
    seen.add(key); return check;
  });
  if (Buffer.byteLength(JSON.stringify(checks), "utf8") > 8192) throw new HelperError("Generated file-check metadata exceeds its envelope. Use fewer concise predicates.");
  return checks;
}

export const fileCheckManifest = (checks: readonly TaskFileCheck[]): string => createHash("sha256").update(JSON.stringify(taskFileChecks(checks)!)).digest("hex");
export type FileCheckResult = {
  n: number;
  state: "matched" | "not-matched" | "unavailable";
  reason: "file_present" | "literal_present" | "digest_matches" | "file_missing" | "literal_missing" | "digest_mismatch" | "policy_refused" | "file_unreadable" | "scope_changed" | "cancelled";
  snapshot?: string;
};
export interface TaskVerificationInput {
  id: string;
  attempt: string;
  manifestDigest: string;
  workspaceDigest: string;
  checks: FileCheckResult[];
}
export interface TaskVerification extends TaskVerificationInput {
  schema: "atom.task-verification/v1";
  kind: "host-file-predicates";
  at: string;
}

const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REASONS: Record<FileCheckResult["state"], readonly FileCheckResult["reason"][]> = {
  matched: ["file_present", "literal_present", "digest_matches"],
  "not-matched": ["file_missing", "literal_missing", "digest_mismatch"],
  unavailable: ["policy_refused", "file_unreadable", "scope_changed", "cancelled"],
};
/** A closed result payload. Raw file text, paths and expected literals never enter host evidence. */
export function verificationInput(value: unknown): TaskVerificationInput | undefined {
  if (!value || typeof value !== "object") return;
  const r = value as TaskVerificationInput;
  if (typeof r.id !== "string" || !UUID.test(r.id) || typeof r.attempt !== "string" || !UUID.test(r.attempt)
    || typeof r.manifestDigest !== "string" || !SHA.test(r.manifestDigest) || typeof r.workspaceDigest !== "string" || !SHA.test(r.workspaceDigest)
    || !Array.isArray(r.checks) || !r.checks.length || r.checks.length > 6) return;
  const checks: FileCheckResult[] = [];
  for (const [index, c] of r.checks.entries()) {
    if (!c || c.n !== index + 1 || typeof c.state !== "string" || typeof c.reason !== "string" || !Object.hasOwn(REASONS, c.state) || !REASONS[c.state].includes(c.reason)
      || c.snapshot !== undefined && (typeof c.snapshot !== "string" || !SHA.test(c.snapshot))
      || (c.state === "matched" || c.reason === "literal_missing" || c.reason === "digest_mismatch") && c.snapshot === undefined
      || (c.state === "unavailable" || c.reason === "file_missing") && c.snapshot !== undefined) return;
    checks.push({ n: c.n, state: c.state, reason: c.reason, ...(c.snapshot ? { snapshot: c.snapshot } : {}) });
  }
  return { id: r.id, attempt: r.attempt, manifestDigest: r.manifestDigest, workspaceDigest: r.workspaceDigest, checks };
}

export function fileVerificationSummary(checks: readonly FileCheckResult[]): string {
  const count = (state: FileCheckResult["state"]) => checks.filter((c) => c.state === state).length;
  return `Declared file predicates: ${count("matched")} matched, ${count("not-matched")} did not match, ${count("unavailable")} unavailable. These are historical file observations, not test passes or proof the whole task is correct.`;
}
