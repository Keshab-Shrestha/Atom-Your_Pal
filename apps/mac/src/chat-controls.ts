import { createHash } from "node:crypto";
import type { Message } from "@atom/contracts";
import type { ChatStore } from "@atom/memory";
import { CHAT_REPLAY_BYTES, chatContext, excerpt } from "./chat-history.ts";

export interface ChatControlRequest {
  type: "chat.control";
  action: "inspect" | "page" | "flags" | "fork";
  id: string;
  request: string;
  revision?: string;
  message?: number;
  offset?: number;
  through?: number;
  kind?: "fork" | "edit" | "retry";
  pinned?: boolean;
  archived?: boolean;
  version?: number;
}
export interface ChatControlResponse {
  type: "chat.control";
  action: ChatControlRequest["action"];
  id: string;
  request: string;
  ok: boolean;
  error?: string;
  revision?: string;
  info?: { messages: number; archiveBytes: number; replayBytes: number; replayBudget: number; omitted: number; lastUser?: number;
    access?: { provider: string; hostTools: boolean; project: boolean; fileGrants: number; computer: boolean; web: boolean } };
  page?: { messages: { seq: number; role: string; offset: number; text: string }[]; nextMessage?: number; nextOffset?: number };
  branch?: { id: string; kind: string; draft: string; created: boolean };
  metadata?: { pinned: boolean; archived: boolean; version: number; previousPinned: boolean; previousArchived: boolean };
}

export function parseChatControl(value: Record<string, unknown>): { command: ChatControlRequest } | { error: string } {
  const actions = ["inspect", "page", "flags", "fork"];
  const common = ["type", "action", "id", "request"];
  const action = String(value.action);
  const extra = action === "page" ? ["revision", "message", "offset"] : action === "flags" ? ["pinned", "archived", "version"] : action === "fork" ? ["revision", "through", "kind"] : [];
  const integer = (key: string, min: number) => Number.isSafeInteger(value[key]) && Number(value[key]) >= min && Number(value[key]) <= 2_000_000_000;
  const revision = () => typeof value.revision === "string" && /^[a-f0-9]{64}$/.test(value.revision);
  if (!actions.includes(action) || Object.keys(value).some((key) => ![...common, ...extra].includes(key))
      || typeof value.id !== "string" || !/^[\w-]{1,100}$/.test(value.id)
      || typeof value.request !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.request)) return { error: "chat.control needs a saved chat, a known action and a request UUID." };
  if (action === "page" && (!integer("message", 1) || !integer("offset", 0) || (value.revision !== undefined && !revision()))) return { error: "Use the history cursor and revision returned by ATOM." };
  if (action === "flags" && (!integer("version", 0) || (value.pinned === undefined && value.archived === undefined)
      || (value.pinned !== undefined && typeof value.pinned !== "boolean") || (value.archived !== undefined && typeof value.archived !== "boolean"))) return { error: "Chat flags need booleans and the current metadata version." };
  if (action === "fork" && (!revision() || !integer("through", value.kind === "fork" ? 0 : 1) || !["fork", "edit", "retry"].includes(String(value.kind)))) return { error: "Fork needs the current archive revision and a saved message number." };
  return { command: value as unknown as ChatControlRequest };
}

function revisionOf(messages: readonly Message[]): string {
  const hash = createHash("sha256");
  for (const message of messages) hash.update(JSON.stringify([message.role, message.content])).update("\n");
  return hash.digest("hex");
}

/** Synchronous: validation, store mutation and foreground resume can run in one command turn. Never calls a model. */
export function runChatControl(store: ChatStore, command: ChatControlRequest, checkProject: (id: string) => { error?: string }): ChatControlResponse {
  const result: ChatControlResponse = { type: "chat.control", action: command.action, id: command.id, request: command.request, ok: false };
  try {
    if (command.action === "flags") {
      const before = store.metadata(command.id);
      if (!before || !store.setFlags(command.id, { pinned: command.pinned, archived: command.archived }, command.version!)) throw new Error("Chat metadata changed or the chat is gone. Refresh before changing it again.");
      result.metadata = { ...store.metadata(command.id)!, previousPinned: before.pinned, previousArchived: before.archived };
      return { ...result, ok: true };
    }
    const destination = `fork-${command.request.toLowerCase()}`;
    const count = command.kind === "fork" ? command.through! : command.through! - 1;
    if (command.action === "fork") {
      const previous = store.forkRecord(destination);
      if (previous) {
        if (previous.source !== command.id || previous.count !== count || previous.kind !== command.kind || previous.revision !== command.revision) throw new Error("That request UUID belongs to a different fork.");
        if (!store.metadata(destination)) throw new Error("That fork was deleted. This request cannot recreate it.");
        return { ...result, ok: true, branch: { id: destination, kind: command.kind!, draft: "", created: false } };
      }
    }
    const messages = store.messages(command.id);
    if (!store.metadata(command.id)) throw new Error("That chat is not saved yet. Send a message first.");
    const revision = revisionOf(messages);
    if (command.revision && command.revision !== revision) throw new Error("Saved history changed. Refresh history before continuing.");
    result.revision = revision;
    if (command.action === "inspect") {
      const context = chatContext(messages, "");
      const lastUser = messages.findLastIndex((m) => m.role === "user");
      return { ...result, ok: true, info: { messages: messages.length, archiveBytes: messages.reduce((sum, m) => sum + Buffer.byteLength(m.content, "utf8") + 32, 0), replayBytes: context.bytes, replayBudget: CHAT_REPLAY_BYTES, omitted: context.start, ...(lastUser >= 0 ? { lastUser: lastUser + 1 } : {}) } };
    }
    if (command.action === "page") {
      let message = command.message!, offset = command.offset!;
      if (message > messages.length + 1 || (message > messages.length && offset)) throw new Error("That history cursor is no longer available.");
      const rows: NonNullable<ChatControlResponse["page"]>["messages"] = [];
      while (message <= messages.length && rows.length < 8) {
        const source = messages[message - 1]!;
        if (offset > source.content.length || (offset && /[\uD800-\uDBFF]/u.test(source.content[offset - 1]!) && /[\uDC00-\uDFFF]/u.test(source.content[offset] ?? ""))) throw new Error("Invalid history offset. Refresh history.");
        const left = 8192 - Buffer.byteLength(JSON.stringify(rows), "utf8") - 400;
        if (left < 200) break;
        const text = excerpt(source.content.slice(offset), left - 100);
        rows.push({ seq: message, role: source.role, offset, text });
        offset += text.length;
        if (offset < source.content.length) break;
        message++; offset = 0;
      }
      return { ...result, ok: true, page: { messages: rows, ...(message <= messages.length ? { nextMessage: message, nextOffset: offset } : {}) } };
    }
    if (count < 0 || count > messages.length) throw new Error("That saved message is no longer available.");
    const source = messages[command.through! - 1];
    if (command.kind !== "fork" && source?.role !== "user") throw new Error("Choose a saved user message to edit or retry.");
    const draft = command.kind === "fork" ? "" : source!.content;
    if (Buffer.byteLength(draft, "utf8") > 128 * 1024) throw new Error("That original prompt is too large for a restored draft. Fork before it and attach edited text instead.");
    if (messages.length > 20_000 || messages.slice(0, count).reduce((n, m) => n + Buffer.byteLength(m.content, "utf8"), 0) > 16 * 1024 * 1024) throw new Error("This fork exceeds the 16 MiB/20,000-message copy limit. The source is unchanged.");
    const project = store.project(command.id);
    if (project) { const checked = checkProject(project); if (checked.error) throw new Error(checked.error); }
    store.fork(command.id, destination, count, command.kind!, revision);
    return { ...result, ok: true, branch: { id: destination, kind: command.kind!, draft, created: true } };
  } catch (error) {
    return { ...result, error: error instanceof Error ? error.message : "Chat controls could not complete. Refresh and try again." };
  }
}
