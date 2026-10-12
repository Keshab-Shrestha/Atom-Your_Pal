// ADR-098 item 5: ATOM as an MCP server over stdio, for Claude Code, Hermes and other MCP clients. A thin client of the
// local HTTP API (api-server.ts): it reads the token in data/api-token and calls http://127.0.0.1:<ATOM_API_PORT>.
// ATOM must be running with Settings → General → "Local API" on.
//   claude mcp add zeno -- node /path/to/zeno/apps/mac/src/mcp-serve.ts
// stdout carries only MCP messages; nothing else is written there.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readEnv } from "@zeno/shared";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** The same default as api-server.ts (not imported, so this entry loads nothing of the runtime). */
const DEFAULT_API_PORT = 4790;
const TOKEN_FILE = fileURLToPath(new URL("../../../data/api-token", import.meta.url));
const BASE = `http://127.0.0.1:${readEnv(process.env, "ATOM_API_PORT")?.trim() || DEFAULT_API_PORT}`;
/** An ATOM turn can take minutes (it may hand work to the team first). */
const CALL_TIMEOUT_MS = 10 * 60_000;

interface ToolDef {
  name: string;
  description: string;
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
  call(args: Record<string, unknown>): Promise<unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const id = (v: unknown) => encodeURIComponent(String(v ?? ""));

async function api(method: "GET" | "POST", path: string, body?: object): Promise<unknown> {
  let token: string;
  try {
    token = readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    throw new Error(`No token in ${TOKEN_FILE}. Turn on Settings → General → "Local API" in ATOM first.`);
  }
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`ATOM does not answer at ${BASE}. Start ATOM and turn on Settings → General → "Local API".`);
  }
  const json = (await response.json().catch(() => ({ ok: false, error: `ATOM answered ${response.status}.` }))) as { ok: boolean; data?: unknown; error?: string };
  if (!json.ok) throw new Error(json.error ?? `ATOM answered ${response.status}.`);
  return json.data;
}

const TOOLS: ToolDef[] = [
  {
    name: "zeno_give_goal",
    description: "Give a goal to ATOM. ATOM hands it to its team of workers, who work in the background. Returns goalId (null when ATOM answered without handing it out) and ATOM's answer.",
    properties: { goal: { type: "string", description: "What to get done, in plain words" } },
    required: ["goal"],
    call: (a) => api("POST", "/v1/goals", { goal: str(a.goal) }),
  },
  {
    name: "zeno_goal_status",
    description: "A goal's status (running or ended), its tasks and, once it has ended, its combined report.",
    properties: { goalId: { type: "number", description: "The goalId from zeno_give_goal" } },
    required: ["goalId"],
    call: (a) => api("GET", `/v1/goals/${id(a.goalId)}`),
  },
  {
    name: "zeno_chat",
    description: "Say one thing to ATOM and get its answer. Turns with the same chatId continue one conversation.",
    properties: {
      text: { type: "string", description: "What to say" },
      chatId: { type: "string", description: "Optional: 1 to 40 letters, digits, - or _ that name the conversation" },
    },
    required: ["text"],
    call: (a) => api("POST", "/v1/chat", { text: str(a.text), ...(a.chatId ? { chatId: str(a.chatId) } : {}) }),
  },
  {
    name: "zeno_list_tasks",
    description: "ATOM's tasks, newest first. Optionally only those in one state.",
    properties: { state: { type: "string", description: "Optional state", enum: ["queued", "running", "done", "failed", "stopped"] } },
    call: (a) => api("GET", `/v1/tasks${a.state ? `?state=${encodeURIComponent(str(a.state))}` : ""}`),
  },
  {
    name: "zeno_task_report",
    description: "One task and its report (title, summary, body and sources), when it has one.",
    properties: { taskId: { type: "number", description: "The task's number" } },
    required: ["taskId"],
    call: (a) => api("GET", `/v1/tasks/${id(a.taskId)}`),
  },
  {
    name: "zeno_needs_you",
    description: "What waits for Keshab's answer in ATOM (questions, plans, proposals, held and failed tasks), with the actions each one takes. Keshab answers them in ATOM or on Telegram.",
    properties: {},
    call: () => api("GET", "/v1/needs"),
  },
  {
    name: "zeno_answer_need",
    description: "Answer one thing that waits in ATOM (see zeno_needs_you). Give its key and one of its actions, such as allow, decline, approve, reject, accept or retry.",
    properties: {
      key: { type: "string", description: "The key from zeno_needs_you" },
      action: { type: "string", description: "One of the actions listed for that key" },
    },
    required: ["key", "action"],
    call: (a) => api("POST", `/v1/needs/${id(a.key)}`, { action: str(a.action) }),
  },
];

const server = new Server({ name: "zeno", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: "object" as const, properties: t.properties, ...(t.required ? { required: t.required } : {}) } })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) return { isError: true, content: [{ type: "text" as const, text: `There is no tool called ${request.params.name}.` }] };
  try {
    const data = await tool.call(request.params.arguments ?? {});
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
  }
});

await server.connect(new StdioServerTransport());
