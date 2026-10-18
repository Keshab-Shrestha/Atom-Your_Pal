import type { ForegroundRecord, ForegroundStore, ForegroundSummary } from "@atom/memory";
import { excerpt } from "./chat-history.ts";
export type ForegroundCommand =
  | { type: "foreground.list"; request: string; pending: string[]; pendingAnswers: { id: string; digest: string }[] }
  | { type: "foreground.read"; request: string; id: string; offset: number }
  | { type: "foreground.dismiss"; request: string; id: string }
  | { type: "foreground.ack"; id: string };
export type ForegroundReceipt = { type: "foreground.receipt"; id: string; chat: string; state: ForegroundRecord["state"]; archived: boolean };
export type ForegroundResponse = { type: "foreground.recovery"; request: string; ok: boolean; error?: string;
  attempts?: ForegroundSummary[]; known?: string[]; knownAnswers?: string[];
  record?: Omit<ForegroundRecord, "reply"> & { reply: string; offset: number; nextOffset?: number } };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function parseForeground(v: Record<string, unknown>): { command: ForegroundCommand } | { error: string } {
  const keys = v.type === "foreground.list" ? ["type", "request", "pending", "pendingAnswers"] : v.type === "foreground.read" ? ["type", "request", "id", "offset"] : v.type === "foreground.dismiss" ? ["type", "request", "id"] : ["type", "id"];
  const ids = (x: unknown) => Array.isArray(x) && x.length <= 2000 && x.every(uuid);
  const answerIds = (x: unknown) => Array.isArray(x) && x.length <= 2000 && x.every((r) => r && typeof r === "object" && Object.keys(r).length === 2 && uuid(r.id) && typeof r.digest === "string" && /^[a-f0-9]{64}$/.test(r.digest));
  if (Object.keys(v).some((k) => !keys.includes(k)) || (v.type !== "foreground.ack" && !uuid(v.request))
      || (v.type === "foreground.list" ? !ids(v.pending) || !answerIds(v.pendingAnswers) : !uuid(v.id))
      || (v.type === "foreground.read" && (!Number.isSafeInteger(v.offset) || Number(v.offset) < 0 || Number(v.offset) > 8_000_000))) return { error: "Use the current recovery request ids and returned text cursor." };
  return { command: v as unknown as ForegroundCommand };
}
export function foregroundReceipt(store: ForegroundStore, id: string): ForegroundReceipt | undefined {
  const row = store.get(id);
  return row && { type: "foreground.receipt", id: row.id, chat: row.chat, state: row.state, archived: row.archived };
}
export function foregroundResponse(store: ForegroundStore, command: Exclude<ForegroundCommand, { type: "foreground.ack" }>): ForegroundResponse {
  const base: ForegroundResponse = { type: "foreground.recovery", request: command.request, ok: false };
  try {
    if (command.type === "foreground.list") return { ...base, ok: true, attempts: store.list(), known: store.known(command.pending), knownAnswers: store.knownAnswers(command.pendingAnswers) };
    if (command.type === "foreground.dismiss") {
      if (!store.dismiss(command.id)) throw new Error("That attempt is still running or is unavailable. Stop it before dismissing.");
      return { ...base, ok: true };
    }
    const row = store.get(command.id);
    if (!row || row.dismissed) throw new Error("That recovery record is no longer available.");
    const offset = command.offset;
    if (offset > row.reply.length || (offset > 0 && /[\uD800-\uDBFF]/u.test(row.reply[offset - 1]!) && /[\uDC00-\uDFFF]/u.test(row.reply[offset] ?? ""))) throw new Error("Invalid reply cursor. Reload this record.");
    const text = excerpt(row.reply.slice(offset), 8192);
    return { ...base, ok: true, record: { ...row, reply: text, offset, ...(offset + text.length < row.reply.length ? { nextOffset: offset + text.length } : {}) } };
  } catch (error) { return { ...base, error: error instanceof Error ? error.message : "Recovery is unavailable. Your saved records were not changed." }; }
}
