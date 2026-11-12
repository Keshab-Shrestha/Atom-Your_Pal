import { createInterface } from "node:readline";
import { loadSdk, planGuard, scrubbedEnv, tokensOf, type ClaudeSdk } from "./plan-support.ts";

/**
 * `claude-bridge` (ADR-278, docs/rust-migration-plan.md section 5(a)): the thin Node helper the Rust runtime starts.
 * It reads line-delimited JSON on stdin and writes line-delimited JSON on stdout. It runs one prompt at a time per id
 * through the Agent SDK, which starts the user's own signed-in `claude` program. It never reads a login.
 * The same safe options as every ARK chat: no tools, no settings, no claude.ai connectors (strictMcpConfig), and
 * `planGuard` stops the run if Claude Code reports an API key (a run never falls back to per-token billing).
 *
 * In:  {"type":"run","id","prompt","model"?,"system"?,"claudePath"?,"resume"?}   {"type":"cancel","id"}
 * Out: {"type":"ready"}   {"id","type":"text"|"thinking","text"}   {"id","type":"done","stopReason","usage","sessionId"?}
 *      {"id","type":"error","message"}
 */

export interface RunLine {
  id: string;
  prompt: string;
  model?: string;
  system?: string;
  claudePath?: string;
  resume?: string;
}

type Send = (line: Record<string, unknown>) => void;

/** One run. Exported so a test can use a fake SDK. */
export async function runOne(sdk: ClaudeSdk, run: RunLine, send: Send, controller: AbortController, env: Record<string, string | undefined> = process.env): Promise<void> {
  const out = (line: Record<string, unknown>) => send({ id: run.id, ...line });
  try {
    const query = sdk.query({
      prompt: run.prompt,
      options: {
        ...(run.model ? { model: run.model } : {}),
        ...(run.claudePath ? { pathToClaudeCodeExecutable: run.claudePath } : {}),
        ...(run.system ? { systemPrompt: run.system } : {}),
        ...(run.resume ? { resume: run.resume } : {}),
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        permissionMode: "default",
        persistSession: true,
        maxTurns: 1,
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
      void runOne(sdk, line as RunLine, send, controller).finally(() => active.delete(line.id));
    } else if (line.type === "cancel") {
      active.get(String(line.id))?.abort();
    }
  }
}

if (import.meta.main) await main();
