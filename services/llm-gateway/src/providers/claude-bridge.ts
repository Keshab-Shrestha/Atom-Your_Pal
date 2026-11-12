import { createInterface } from "node:readline";
import { loadSdk, planGuard, scrubbedEnv, shapeOf, tokensOf, type ClaudeSdk } from "./plan-support.ts";
import type { ToolSpec } from "@ark/contracts";

/**
 * `claude-bridge` (ADR-278, docs/rust-migration-plan.md section 5(a)): the thin Node helper the Rust runtime starts.
 * It reads line-delimited JSON on stdin and writes line-delimited JSON on stdout. It runs one prompt at a time per id
 * through the Agent SDK, which starts the user's own signed-in `claude` program. It never reads a login.
 * The same safe options as every ARK chat: no tools, no settings, no claude.ai connectors (strictMcpConfig), and
 * `planGuard` stops the run if Claude Code reports an API key (a run never falls back to per-token billing).
 *
 * In:  {"type":"run","id","prompt","model"?,"system"?,"claudePath"?,"resume"?,"tools"?}   {"type":"cancel","id"}
 *      {"type":"tool_result","callId","content","isError"?}
 * Out: {"type":"ready"}   {"id","type":"text"|"thinking","text"}   {"id","type":"done","stopReason","usage","sessionId"?}
 *      {"id","type":"error","message"}   {"id","type":"tool","callId","name","input"}
 *
 * Tools (ADR-278 step 2): `tools` are ToolSpecs. Each becomes an SDK tool that does not run anything here. It sends a
 * `tool` line to Rust and waits for the `tool_result` line with the same callId. Rust checks its policy and runs the tool.
 * Calls go out at once; Rust batches them. No tools: the run is one turn with no tools, as before.
 */

export interface RunLine {
  id: string;
  prompt: string;
  model?: string;
  system?: string;
  claudePath?: string;
  resume?: string;
  tools?: ToolSpec[];
}

/** Waits for the answer of a tool call. `deliver` is called by the stdin reader. */
export interface ToolBridge {
  call(name: string, input: Record<string, unknown>): Promise<{ content: string; isError: boolean }>;
  deliver(callId: string, content: string, isError: boolean): void;
}

export function toolBridge(send: (line: Record<string, unknown>) => void): ToolBridge {
  const waiting = new Map<string, (r: { content: string; isError: boolean }) => void>();
  let n = 0;
  return {
    // ADR-278: calls go out at once. Rust collects the ones that come close together and answers them as one batch.
    call(name, input) {
      const callId = `call-${++n}`;
      return new Promise<{ content: string; isError: boolean }>((resolve) => { waiting.set(callId, resolve); send({ type: "tool", callId, name, input }); });
    },
    deliver(callId, content, isError) { waiting.get(callId)?.({ content, isError }); waiting.delete(callId); },
  };
}

type Send = (line: Record<string, unknown>) => void;

/** One run. Exported so a test can use a fake SDK. */
export async function runOne(sdk: ClaudeSdk, run: RunLine, send: Send, controller: AbortController, env: Record<string, string | undefined> = process.env, bridge?: ToolBridge): Promise<void> {
  const out = (line: Record<string, unknown>) => send({ id: run.id, ...line });
  try {
    const specs = run.tools ?? [];
    const withTools = specs.length > 0 && bridge;
    const server = withTools
      ? sdk.createSdkMcpServer({ name: "ark", tools: specs.map((spec) => sdk.tool(spec.name, spec.description, shapeOf(spec), async (input) => { const r = await bridge.call(spec.name, input); return { content: [{ type: "text" as const, text: r.content }], ...(r.isError ? { isError: true } : {}) }; })) })
      : undefined;
    const query = sdk.query({
      prompt: run.prompt,
      options: {
        ...(run.model ? { model: run.model } : {}),
        ...(run.claudePath ? { pathToClaudeCodeExecutable: run.claudePath } : {}),
        ...(run.system ? { systemPrompt: run.system } : {}),
        ...(run.resume ? { resume: run.resume } : {}),
        tools: [],
        ...(server ? { mcpServers: { ark: server }, allowedTools: specs.map((t) => `mcp__ark__${t.name}`) } : {}),
        settingSources: [],
        strictMcpConfig: true,
        permissionMode: "default",
        persistSession: true,
        maxTurns: server ? 12 : 1,
        includePartialMessages: true,
        abortController: controller,
        env: scrubbedEnv(env),
      },
    });
    let sessionId: string | undefined;
    for await (const message of query) {
      if (message.type === "system" || message.type === "rate_limit_event") {
        planGuard(message);
        if (message.type === "system" && typeof message.session_id === "string") sessionId = message.session_id;
      } else if (message.type === "stream_event" && !message.parent_tool_use_id) {
        const delta = message.event?.type === "content_block_delta" ? message.event.delta : undefined;
        if (delta?.type === "text_delta") out({ type: "text", text: String(delta.text ?? "") });
        else if (delta?.type === "thinking_delta") out({ type: "thinking", text: String(delta.thinking ?? "") });
      } else if (message.type === "result") {
        if (message.is_error) throw new Error(String(message.result || message.subtype || "Claude Code failed"));
        const t = tokensOf(message);
        out({ type: "done", stopReason: String(message.stop_reason ?? "end_turn"), usage: { input: t?.input ?? 0, output: t?.output ?? 0 }, ...(sessionId ? { sessionId } : {}) });
        return;
      }
    }
    throw new Error("Claude Code ended without a result");
  } catch (error) {
    out({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

export async function main(): Promise<void> {
  const send: Send = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);
  const sdk = await loadSdk();
  const active = new Map<string, AbortController>();
  const bridge = toolBridge(send);
  send({ type: "ready" });
  for await (const raw of createInterface({ input: process.stdin })) {
    let line: Record<string, any>;
    try {
      line = JSON.parse(raw);
    } catch {
      send({ type: "error", message: "bad JSON line" });
      continue;
    }
    if (line.type === "run" && typeof line.id === "string" && typeof line.prompt === "string") {
      const controller = new AbortController();
      active.set(line.id, controller);
      void runOne(sdk, line as RunLine, send, controller, process.env, bridge).finally(() => active.delete(line.id));
    } else if (line.type === "tool_result" && typeof line.callId === "string") {
      bridge.deliver(line.callId, String(line.content ?? ""), line.isError === true);
    } else if (line.type === "cancel") {
      active.get(String(line.id))?.abort();
    }
  }
}

if (import.meta.main) await main();
