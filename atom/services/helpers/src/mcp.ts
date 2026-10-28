import type { DatabaseSync } from "node:sqlite";
import { HelperError } from "./jobs.ts";

// ADR-090: MCP servers Keshab adds for his workers. Saved off; tested; turned on per worker; every tool call asks on
// Pal's card unless the server is trusted. Env values and header values are secrets: kept in this local file, never
// logged, never sent to the island in full.

export type McpKind = "command" | "url";
export type McpTransport = "http" | "sse";

export interface McpServer {
  id: number;
  /** Lower case, letters, digits, - and _: the name tools appear under (`mcp__<name>__<tool>`). */
  name: string;
  kind: McpKind;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  transport: McpTransport;
  headers: Record<string, string>;
  enabled: boolean;
  trusted: boolean;
  /** Worker ids that may use it. */
  workers: string[];
  /** Tool names from the last test. */
  tools: string[];
  testedAt?: Date;
  /** Why the last test failed, in words. */
  problem?: string;
}

export interface McpServerInput {
  name: string;
  kind: McpKind;
  command?: string;
  args?: string[];
  /** `KEY=value` lines. */
  env?: string[];
  url?: string;
  transport?: McpTransport;
  /** `Name: value` lines. */
  headers?: string[];
}

export const MAX_MCP_SERVERS = 20;
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** ATOM's own MCP servers, new names and old (ADR-105): Keshab's servers may not use them. */
const RESERVED_SERVER_NAMES = new Set(["atom", "atom-browser", "zeno", "zeno-browser"]);
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HEADER_KEY = /^[A-Za-z0-9-]{1,64}$/;

/** The input checked and cleaned; throws HelperError with what is wrong. */
export function cleanMcpInput(input: McpServerInput, taken: readonly string[]): Omit<McpServer, "id" | "enabled" | "trusted" | "workers" | "tools"> {
  const name = input.name.trim().toLowerCase().replace(/\s+/g, "-");
  if (!NAME.test(name)) throw new HelperError("A server's name is lower case letters, digits, - or _ (at most 32).");
  if (RESERVED_SERVER_NAMES.has(name)) throw new HelperError("That name is ATOM's own.");
  if (taken.includes(name)) throw new HelperError(`There is already a server called ${name}.`);
  const pairs = (lines: string[] | undefined, sep: string, key: RegExp, what: string) =>
    Object.fromEntries(
      (lines ?? []).map((l) => l.trim()).filter(Boolean).map((line) => {
        const at = line.indexOf(sep);
        const k = at > 0 ? line.slice(0, at).trim() : "";
        if (!key.test(k)) throw new HelperError(`"${line.slice(0, 30)}" is not a ${what}.`);
        return [k, line.slice(at + 1).trim()];
      }),
    );
  if (input.kind === "command") {
    const command = input.command?.trim() ?? "";
    if (!command || command.length > 500 || /[\n\0]/.test(command)) throw new HelperError("Give the command to run (the program, without arguments).");
    const args = (input.args ?? []).map((a) => a.trim()).filter(Boolean);
    if (args.length > 30 || args.some((a) => a.length > 500)) throw new HelperError("At most 30 arguments, each at most 500 characters.");
    return { name, kind: "command", command, args, env: pairs(input.env, "=", ENV_KEY, "KEY=value line"), transport: "http", headers: {} };
  }
  if (input.kind === "url") {
    let url: URL;
    try {
      url = new URL((input.url ?? "").trim());
    } catch {
      throw new HelperError("Give the server's address, such as https://example.com/mcp.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new HelperError("The address must start with https:// (or http://).");
    if (url.username || url.password || /token|key|secret/i.test(url.search)) throw new HelperError("Put tokens in a header, never in the address.");
    return { name, kind: "url", url: url.toString(), args: [], env: {}, transport: input.transport === "sse" ? "sse" : "http", headers: pairs(input.headers, ":", HEADER_KEY, "Name: value header") };
  }
  throw new HelperError("A server runs a command or connects to a URL.");
}

interface Row {
  id: number;
  name: string;
  kind: string;
  command: string | null;
  args: string;
  env: string;
  url: string | null;
  transport: string;
  headers: string;
  enabled: number;
  trusted: number;
  workers: string;
  tools: string;
  tested_at: string | null;
  problem: string | null;
}

const toServer = (r: Row): McpServer => ({
  id: r.id,
  name: r.name,
  kind: r.kind as McpKind,
  ...(r.command ? { command: r.command } : {}),
  args: JSON.parse(r.args) as string[],
  env: JSON.parse(r.env) as Record<string, string>,
  ...(r.url ? { url: r.url } : {}),
  transport: r.transport as McpTransport,
  headers: JSON.parse(r.headers) as Record<string, string>,
  enabled: r.enabled === 1,
  trusted: r.trusted === 1,
  workers: JSON.parse(r.workers) as string[],
  tools: JSON.parse(r.tools) as string[],
  ...(r.tested_at ? { testedAt: new Date(r.tested_at) } : {}),
  ...(r.problem ? { problem: r.problem } : {}),
});

/** The table, for the store. */
export function mcpTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    command TEXT,
    args TEXT NOT NULL,
    env TEXT NOT NULL,
    url TEXT,
    transport TEXT NOT NULL,
    headers TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    trusted INTEGER NOT NULL DEFAULT 0,
    workers TEXT NOT NULL DEFAULT '[]',
    tools TEXT NOT NULL DEFAULT '[]',
    tested_at TEXT,
    problem TEXT
  )`);
  const all = db.prepare("SELECT * FROM mcp_servers ORDER BY id");
  const one = db.prepare("SELECT * FROM mcp_servers WHERE id = ?");
  const insert = db.prepare("INSERT INTO mcp_servers (name, kind, command, args, env, url, transport, headers) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const forget = db.prepare("DELETE FROM mcp_servers WHERE id = ?");
  const setFlags = db.prepare("UPDATE mcp_servers SET enabled = ?, trusted = ?, workers = ? WHERE id = ?");
  const setTest = db.prepare("UPDATE mcp_servers SET tools = ?, tested_at = ?, problem = ? WHERE id = ?");
  return {
    list: () => (all.all() as unknown as Row[]).map(toServer),
    get: (id: number) => {
      const row = one.get(id) as unknown as Row | undefined;
      return row ? toServer(row) : undefined;
    },
    add(input: McpServerInput): number {
      const existing = (all.all() as unknown as Row[]).map((r) => r.name);
      if (existing.length >= MAX_MCP_SERVERS) throw new HelperError(`There are already ${MAX_MCP_SERVERS} servers.`);
      const s = cleanMcpInput(input, existing);
      return Number(insert.run(s.name, s.kind, s.command ?? null, JSON.stringify(s.args), JSON.stringify(s.env), s.url ?? null, s.transport, JSON.stringify(s.headers)).lastInsertRowid);
    },
    remove: (id: number) => Number(forget.run(id).changes) > 0,
    flags: (id: number, enabled: boolean, trusted: boolean, workers: string[]) => void setFlags.run(enabled ? 1 : 0, trusted ? 1 : 0, JSON.stringify(workers), id),
    tested: (id: number, tools: string[], at: Date, problem: string | null) => void setTest.run(JSON.stringify(tools), at.toISOString(), problem, id),
  };
}
