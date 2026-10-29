import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Message, ModelRequest, ToolRunner } from "@atom/contracts";
import { ProviderError, redactSecrets, type ProviderAdapter } from "../gateway.ts";
import { signedInEnv } from "./cli-tools.ts";

type RpcMessage = { id?: string | number; method?: string; params?: any; result?: any; error?: { code?: number; message?: string } };
export interface CodexTransport {
  send(message: RpcMessage): void;
  listen(onMessage: (message: RpcMessage) => void, onClose: () => void): void;
  close(): void;
}

/** Only this gateway module speaks the signed-in Codex app-server protocol. No auth file is read by ATOM. */
function transport(program: string, cwd: string): CodexTransport {
  const env = signedInEnv();
  // A nested ATOM runtime is a separate app-server client, not a continuation of its launching Codex task.
  for (const key of Object.keys(env)) if (key.startsWith("CODEX_") && key !== "CODEX_HOME") delete env[key];
  const filesystem = Object.entries({ "/": "deny", ":minimal": "read", [cwd]: "read" }).map(([path, access]) => `${JSON.stringify(path)}=${JSON.stringify(access)}`).join(",");
  const features = Object.entries(codexHostConfig(cwd)).filter(([key]) => key.startsWith("features.")).flatMap(([key, value]) => ["-c", `${key}=${value}`]);
  const child = spawn(program, ["app-server", "--stdio", ...features, "-c", "mcp_servers={}", "-c", `permissions.atom_host_tools.filesystem={${filesystem}}`, "-c", "permissions.atom_host_tools.network.enabled=false", "-c", 'default_permissions="atom_host_tools"'], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume(); // CLI diagnostics may contain user configuration: never forward them into ATOM's logs.
  const lines = createInterface({ input: child.stdout });
  return {
    send: (message) => { child.stdin.write(`${JSON.stringify(message)}\n`); },
    listen(onMessage, onClose) {
      lines.on("line", (line) => { try { onMessage(JSON.parse(line)); } catch { /* Non-protocol output is not a request. */ } });
      child.once("error", onClose); child.once("exit", onClose);
      child.stdin.on("error", onClose);
    },
    close() { lines.close(); child.stdin.end(); child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 1500); timer.unref(); },
  };
}

export interface CodexSessionOptions {
  program: string;
  model: string;
  runner(request: ModelRequest): ToolRunner;
  onUsage?(usage: { input: number; output: number; cacheRead: number; cacheWrite: number }, request: ModelRequest, model: string): void;
  transport?(cwd: string): CodexTransport;
  idleMs?: number;
  /** Counts and durations only: never prompt text, tool arguments or configuration. */
  onDiagnostic?(data: CodexTurnDiagnostic, request: ModelRequest): void;
}

export interface CodexTurnDiagnostic {
  session: "new" | "reused";
  restart: "missing" | "transcript" | "instructions" | "tools" | "none";
  setup: Partial<Record<"transport" | "initialize" | "inventory" | "skills" | "thread" | "policy", number>>;
  readyMs: number;
  firstTextMs?: number;
  totalMs: number;
  completed: boolean;
  context: { systemBytes: number; extraBytes: number; historyBytes: number; turnInputBytes: number; toolBytes: number; inheritedSkillsDisabled?: number; tools: { name: string; bytes: number }[] };
  usage?: { total: Record<string, number>; last: Record<string, number> };
}

/** Explicit native-tool lockdown. File access is performed only by ATOM's checked host tools. */
export function codexHostConfig(cwd: string): Record<string, unknown> {
  return {
    "features.shell_tool": false, "features.unified_exec": false,
    "features.multi_agent": false, "features.multi_agent_v2": false,
    "features.apps": false, "features.plugins": false, "features.remote_plugin": false,
    "features.browser_use": false, "features.computer_use": false,
    "features.view_image": false, "features.image_generation": false,
    "features.code_mode": false, "features.js_repl": false,
    "web_search": "disabled", "mcp_servers": {}, "project_doc_max_bytes": 0,
    "developer_instructions": "",
    "permissions.atom_host_tools": { filesystem: { "/": "deny", ":minimal": "read", [cwd]: "read" }, network: { enabled: false } },
    "default_permissions": "atom_host_tools",
  };
}

export function createCodexSessionAdapter(options: CodexSessionOptions): ProviderAdapter {
  const sessions = new Map<string, Session>();
  let sequence = 0;
  type Session = {
    rpc: CodexTransport; dir: string; thread?: string; model: string;
    pending: Map<string, { resolve(value: any): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>;
    active?: { request: ModelRequest; runner: ToolRunner; text: string; final: string; firstTextAt?: number; resolve(text: string): void; reject(error: unknown): void; signal: AbortSignal };
    ready: Promise<void>; seen: Message[]; key: string; idle?: ReturnType<typeof setTimeout>; closed: boolean; busy: boolean;
    usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
    rawUsage?: CodexTurnDiagnostic["usage"];
    setup: CodexTurnDiagnostic["setup"];
    signature?: string;
    toolSignature?: string;
    inheritedSkillsDisabled?: number;
  };
  const fail = (kind: "unknown" | "cancelled" | "unavailable" | "rate_limit", message: string) => new ProviderError(kind, message);
  function close(s: Session, error = fail("unavailable", "Codex's session ended. Try again.")) {
    if (s.closed) return;
    s.closed = true; clearTimeout(s.idle);
    if (sessions.get(s.key) === s) sessions.delete(s.key);
    for (const p of s.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    s.pending.clear(); s.active?.reject(error); s.active = undefined;
    s.rpc.close(); rmSync(s.dir, { recursive: true, force: true });
  }
  function request(s: Session, method: string, params: unknown): Promise<any> {
    if (s.closed) return Promise.reject(fail("unavailable", "Codex's session is closed."));
    const id = `atom-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { close(s, fail("unavailable", "Codex did not answer its session request.")); }, 30_000);
      s.pending.set(id, { resolve, reject, timer });
      s.rpc.send({ id, method, params });
    });
  }
  async function receive(s: Session, m: RpcMessage) {
    if (s.closed) return;
    if (m.id !== undefined && !m.method) {
      const p = s.pending.get(String(m.id));
      if (!p) return;
      s.pending.delete(String(m.id)); clearTimeout(p.timer);
      if (m.error) p.reject(fail("unknown", `Codex rejected a session request (code ${m.error.code ?? "unknown"}).`));
      else p.resolve(m.result);
      return;
    }
    const a = s.active;
    if (m.id !== undefined) {
      if (m.method === "item/tool/call" && a && m.params?.threadId === s.thread) {
        const p = m.params;
        const spec = a.runner.specs().find((t) => t.name === p.tool);
        let result = { callId: String(p.callId), content: "That tool is unavailable.", isError: true } as Awaited<ReturnType<ToolRunner["run"]>>;
        if (spec && p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) && !a.signal.aborted) {
          try { result = await a.runner.run({ id: String(p.callId), name: p.tool, input: p.arguments }, a.signal); }
          catch { result = { callId: String(p.callId), content: "ATOM could not complete that tool call.", isError: true }; }
        }
        if (!s.closed) s.rpc.send({ id: m.id, result: { contentItems: [{ type: "inputText", text: result.content }, ...(result.images ?? []).map((i) => ({ type: "inputImage", imageUrl: `data:${i.mimeType};base64,${i.data}` }))], success: !result.isError } });
      } else if (m.method === "item/commandExecution/requestApproval" || m.method === "item/fileChange/requestApproval") {
        s.rpc.send({ id: m.id, result: { decision: "decline" } });
      } else {
        // No generic approval/permission/MCP request can bypass ATOM's host policy.
        s.rpc.send({ id: m.id, error: { code: -32601, message: "Only ATOM's checked host tools are available." } });
      }
      return;
    }
    if (!a || m.params?.threadId !== s.thread) return;
    if (m.method === "item/agentMessage/delta" && typeof m.params.delta === "string") {
      if (m.params.delta.length && a.firstTextAt === undefined) a.firstTextAt = performance.now();
      a.text += m.params.delta; a.request.onText?.(m.params.delta);
    }
    if (m.method === "item/completed" && m.params.item?.type === "agentMessage") {
      const item = m.params.item;
      if (typeof item.text === "string") { a.text = item.text; if (item.phase === "final_answer") a.final = item.text; }
    }
    if (m.method === "thread/tokenUsage/updated") {
      const u = m.params.tokenUsage?.total;
      if (u) {
        const counts = (value: any): Record<string, number> => Object.fromEntries(["inputTokens", "cachedInputTokens", "cacheWriteInputTokens", "outputTokens", "reasoningOutputTokens"].map((key) => [key, typeof value?.[key] === "number" ? value[key] : 0]));
        s.rawUsage = { total: counts(u), last: counts(m.params.tokenUsage?.last) };
        const total = { input: Math.max(0, (u.inputTokens ?? 0) - (u.cachedInputTokens ?? 0)), output: u.outputTokens ?? 0, cacheRead: u.cachedInputTokens ?? 0, cacheWrite: u.cacheWriteInputTokens ?? 0 };
        const delta = Object.fromEntries(Object.entries(total).map(([k, value]) => [k, Math.max(0, value - (s.usage?.[k as keyof typeof total] ?? 0))])) as typeof total;
        s.usage = total;
        if (Object.values(delta).some((n) => n > 0)) options.onUsage?.(delta, a.request, s.model);
      }
    }
    if (m.method === "turn/completed") {
      const turn = m.params.turn;
      if (turn?.status !== "completed") {
        const message = redactSecrets(String(turn?.error?.message ?? "Your chat is kept.")).slice(0, 240);
        const limited = /usage limit|rate.?limit|quota exceeded/i.test(message);
        a.reject(fail(turn?.status === "interrupted" ? "cancelled" : limited ? "rate_limit" : "unknown", `Codex could not finish this turn. ${message}`));
      }
      else {
        const text = a.final || a.text || (turn.items ?? []).filter((i: any) => i.type === "agentMessage").map((i: any) => i.text).join("\n");
        if (!text.trim()) a.reject(fail("unknown", "Codex returned no reply.")); else a.resolve(text.trim());
      }
    }
  }
  function open(key: string, req: ModelRequest, runner: ToolRunner): Session {
    const began = performance.now();
    const dir = mkdtempSync(join(tmpdir(), "atom-codex-session-"));
    const rpc = options.transport?.(dir) ?? transport(options.program, dir);
    const s: Session = { rpc, dir, model: options.model, pending: new Map(), ready: Promise.resolve(), seen: [], key, closed: false, busy: false, setup: { transport: performance.now() - began } };
    rpc.listen((m) => { void receive(s, m).catch(() => close(s, fail("unknown", "Codex's tool connection failed."))); }, () => close(s));
    s.ready = (async () => {
      const timed = async (stage: keyof CodexTurnDiagnostic["setup"], run: () => Promise<any>) => {
        const start = performance.now();
        try { return await run(); } finally { s.setup[stage] = performance.now() - start; }
      };
      await timed("initialize", () => request(s, "initialize", { clientInfo: { name: "atom", version: "1" }, capabilities: { experimentalApi: true, requestAttestation: false } }));
      rpc.send({ method: "initialized", params: {} });
      // Reading effective configuration does not connect to inherited servers. An empty override map merges;
      // disable each configured entry before thread/start, then still verify the active thread below.
      const effective = await timed("inventory", () => request(s, "config/read", { cwd: dir, includeLayers: false }));
      const names = (value: unknown): string[] => {
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 1000) throw fail("unavailable", "Codex's inherited configuration could not be checked.");
        return Object.keys(value);
      };
      const config = codexHostConfig(dir);
      config.mcp_servers = Object.fromEntries(names(effective.config?.mcp_servers).map((name) => [name, { enabled: false }]));
      config.plugins = Object.fromEntries(names(effective.config?.plugins).map((name) => [name, { enabled: false }]));
      // These are Codex's local skills, outside the isolated filesystem, not ATOM's checked atom_use_skill.
      // Suppress their otherwise unusable catalog for this thread only; never write global configuration.
      const found = await timed("skills", () => request(s, "skills/list", { cwds: [dir] }));
      const groups = found.data;
      if (!Array.isArray(groups) || groups.length !== 1 || !Array.isArray(groups[0]?.skills) || groups[0].skills.length > 1000 || groups[0].errors?.length) throw fail("unavailable", "Codex's inherited skills could not be checked.");
      const paths = groups[0].skills.map((skill: any) => {
        if (typeof skill.path !== "string" || !isAbsolute(skill.path)) throw fail("unavailable", "Codex's inherited skill path could not be checked.");
        return skill.path;
      });
      config.skills = { config: paths.map((path: string) => ({ path, enabled: false })) };
      s.inheritedSkillsDisabled = paths.length;
      const started = await timed("thread", () => request(s, "thread/start", {
        ...(options.model === "codex-default" ? {} : { model: options.model }),
        cwd: dir, ephemeral: true, approvalPolicy: "never", permissions: "atom_host_tools",
        config, baseInstructions: req.system,
        dynamicTools: runner.specs().map((t) => ({ type: "function", name: t.name, description: t.description, inputSchema: t.inputSchema })),
      }));
      if (started.activePermissionProfile?.id !== "atom_host_tools" || !started.thread?.id) throw fail("unavailable", "This Codex version cannot enforce ATOM's file policy. Update Codex before using its tools.");
      s.thread = started.thread.id; s.model = started.model ?? options.model;
      const activeServers = await timed("policy", () => request(s, "mcpServerStatus/list", { threadId: s.thread, detail: "toolsAndAuthOnly", limit: 100 }));
      if (!Array.isArray(activeServers.data) || activeServers.nextCursor || activeServers.data.some((server: any) => server.runtimeStatus !== "disabled" || Object.keys(server.tools ?? {}).length)) throw fail("unavailable", "Codex loaded external MCP servers. ATOM refused this session before running the model.");
    })();
    sessions.set(key, s);
    return s;
  }
  return {
    name: "codex",
    close() { for (const s of [...sessions.values()]) close(s); },
    async complete(req, signal) {
      const began = performance.now();
      if (signal.aborted) throw fail("cancelled", "Codex was stopped.");
      const key = req.context.sessionId;
      let s = sessions.get(key);
      if (s?.busy) throw fail("unknown", "Codex is still answering in this chat.");
      const runner = options.runner(req);
      const specs = runner.specs();
      const toolSignature = JSON.stringify(specs);
      const signature = req.system;
      const samePrefix = s && s.seen.length < req.messages.length && s.seen.every((m, i) => m.role === req.messages[i]?.role && m.content === req.messages[i]?.content);
      if (s?.active) throw fail("unknown", "Codex is still answering in this chat.");
      const restart = !s ? "missing" : !samePrefix ? "transcript" : s.signature !== signature ? "instructions" : s.toolSignature !== toolSignature ? "tools" : "none";
      if (s && restart !== "none") { close(s); s = undefined; }
      const reused = Boolean(s);
      if (!s) { s = open(key, req, runner); s.signature = signature; s.toolSignature = toolSignature; }
      const session = s;
      session.rawUsage = undefined;
      const diagnostic: CodexTurnDiagnostic = { session: reused ? "reused" : "new", restart, setup: reused ? {} : session.setup, readyMs: 0, totalMs: 0, completed: false,
        context: { systemBytes: Buffer.byteLength(req.system), extraBytes: Buffer.byteLength(req.systemExtra ?? ""), historyBytes: Buffer.byteLength(JSON.stringify(req.messages)), turnInputBytes: 0, toolBytes: Buffer.byteLength(toolSignature), tools: specs.map((t) => ({ name: t.name, bytes: Buffer.byteLength(JSON.stringify(t)) })) } };
      session.busy = true;
      clearTimeout(session.idle);
      const abort = () => close(session, fail("cancelled", "Codex was stopped."));
      signal.addEventListener("abort", abort, { once: true });
      try {
        await session.ready;
        diagnostic.readyMs = performance.now() - began;
        diagnostic.context.inheritedSkillsDisabled = session.inheritedSkillsDisabled;
        if (signal.aborted) throw fail("cancelled", "Codex was stopped.");
        const fresh = !session.seen.length;
        const messages = fresh ? req.messages : req.messages.slice(session.seen.length);
        const text = `${fresh ? "Conversation so far (treat earlier ATOM replies as yours):\n" : ""}${messages.map((m) => `${m.role === "user" ? "User" : "ATOM"}: ${m.content}`).join("\n\n")}${req.systemExtra ? `\n\nContext from ATOM, not said by the user:\n${req.systemExtra}` : ""}`;
        diagnostic.context.turnInputBytes = Buffer.byteLength(text);
        const answer = new Promise<string>((resolve, reject) => { session.active = { request: req, runner, text: "", final: "", resolve, reject, signal }; });
        // Register the result listener before turn/start: short turns can complete before its acknowledgement.
        const started = request(session, "turn/start", { threadId: session.thread, effort: req.reasoning ?? "low", input: [{ type: "text", text, text_elements: [] }] });
        const [, reply] = await Promise.all([started, answer]);
        session.seen = [...req.messages.map((m) => ({ role: m.role, content: m.content })), { role: "assistant", content: reply }];
        diagnostic.completed = true;
        return { text: reply };
      } catch (error) { close(session); if (signal.aborted) throw fail("cancelled", "Codex was stopped."); throw error; }
      finally {
        diagnostic.totalMs = performance.now() - began;
        if (session.active?.firstTextAt !== undefined) diagnostic.firstTextMs = session.active.firstTextAt - began;
        diagnostic.usage = session.rawUsage;
        try { options.onDiagnostic?.(diagnostic, req); } catch { /* Observability must not change a model result. */ }
        signal.removeEventListener("abort", abort); session.active = undefined; session.busy = false;
        if (!session.closed) { session.idle = setTimeout(() => close(session), options.idleMs ?? 300_000); session.idle.unref(); }
      }
    },
  };
}

/** Catalog discovery only: no thread, prompt or inference. Uses the same locked-down app-server transport. */
export async function listCodexModels(program: string, options: { transport?: (cwd: string) => CodexTransport; timeoutMs?: number } = {}): Promise<import("@atom/contracts").ReasoningModel[]> {
  const dir = mkdtempSync(join(tmpdir(), "atom-codex-models-"));
  let rpc: CodexTransport | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, { resolve(v: any): void; reject(e: Error): void }>();
  let seq = 0;
  const failure = () => { for (const p of pending.values()) p.reject(new Error("Codex model discovery ended.")); pending.clear(); };
  try {
    rpc = (options.transport ?? ((cwd) => transport(program, cwd)))(dir);
    rpc.listen((m) => {
      if (m.id !== undefined && !m.method) {
        const p = pending.get(String(m.id)); pending.delete(String(m.id));
        if (m.error) p?.reject(new Error("Codex refused model discovery.")); else p?.resolve(m.result);
      } else if (m.id !== undefined) rpc?.send({ id: m.id, error: { code: -32601, message: "Catalog discovery cannot execute tools." } });
    }, failure);
    const call = (method: string, params: unknown) => new Promise<any>((resolve, reject) => {
      const id = `catalog-${++seq}`; pending.set(id, { resolve, reject }); rpc!.send({ id, method, params });
    });
    timer = setTimeout(() => { failure(); rpc?.close(); }, options.timeoutMs ?? 15_000);
    await call("initialize", { clientInfo: { name: "atom", title: "ATOM", version: "0.5.0" }, capabilities: { experimentalApi: true } });
    rpc.send({ method: "initialized" });
    const models: import("@atom/contracts").ReasoningModel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await call("model/list", { limit: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result?.data)) throw new Error("Invalid Codex model catalog.");
      for (const m of result.data) {
        if (!m || m.hidden || typeof m.model !== "string" || typeof m.displayName !== "string") continue;
        const levels: string[] = [...new Set<string>((Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : [])
          .map((x: any) => x?.reasoningEffort).filter((x: unknown) => typeof x === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(x)))];
        models.push({ id: m.model, name: m.displayName, reasoningLevels: levels,
          defaultReasoning: levels.includes("low") ? "low" : levels.includes(m.defaultReasoningEffort) ? m.defaultReasoningEffort : undefined });
      }
      if (!result.nextCursor) return models;
      if (result.nextCursor === cursor) throw new Error("Repeated Codex model cursor.");
      cursor = result.nextCursor;
    }
    throw new Error("Codex model catalog is too large.");
  } finally { clearTimeout(timer); failure(); rpc?.close(); rmSync(dir, { recursive: true, force: true }); }
}
