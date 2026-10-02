// A stand-in for `cua-driver mcp` used by transport tests. Speaks JSON-RPC lines on stdio.
import { createInterface } from "node:readline";
let cancelled = 0;
const out = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "notifications/cancelled") { cancelled++; return; }
  if (m.id === undefined) return;
  if (m.method === "initialize") return out({ id: m.id, result: { protocolVersion: "2025-06-18", capabilities: {} } });
  if (m.method !== "tools/call") return out({ id: m.id, error: { code: -32601, message: "no such method" } });
  const { name, arguments: a } = m.params;
  const ok = (text, structuredContent = {}) => out({ id: m.id, result: { content: [{ type: "text", text }], structuredContent } });
  if (name === "echo") return ok(String(a.text), { args: a });
  if (name === "pid") return ok("pid", { pid: process.pid });
  if (name === "env") return ok("env", { mode: process.env.CUA_DRIVER_PERMISSION_MODE, bypass: process.env.CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS ?? null, telemetry: process.env.CUA_TELEMETRY_ENABLED, telemetryRs: process.env.CUA_DRIVER_RS_TELEMETRY_ENABLED });
  if (name === "cancelled") return ok("n", { cancelled });
  if (name === "refuse") return out({ id: m.id, result: { isError: true, content: [{ type: "text", text: "not allowed" }], structuredContent: { status: "refused", refusal: { code: "denied", message: "not allowed" } } } });
  // The real driver's shape (seen live): the code sits at the top level of the result, with no `refusal` object.
  if (name === "refuse_flat") return out({ id: m.id, result: { isError: true, content: [{ type: "text", text: "Background input refused (same_pid_keyboard_ambiguity): pid 9 owns 1 other window" }], structuredContent: { code: "same_pid_keyboard_ambiguity", effect: "refused", pid: 9, window_id: 3, reason: "pid 9 owns 1 other window", escalation: { reason: "pid 9 owns 1 other window", recommended: "accessibility" } } } });
  if (name === "error_plain") return out({ id: m.id, result: { isError: true, content: [{ type: "text", text: "something broke" }], structuredContent: {} } });
  if (name === "crash") process.exit(1);
  // "slow": never answers
});
