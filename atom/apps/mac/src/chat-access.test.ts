import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatAccessMode } from "@atom/contracts";
import { chatAccessPolicy, FULL_ACCESS_CONFIRMATION } from "./chat-access.ts";
import { nativeGate } from "./native-safety.ts";
import { parseCommand } from "./island-protocol.ts";

test("chat only refuses every tool, including read-only tools and unknown calls; saved permissions adds no approval", async () => {
  let asked = 0;
  for (const mode of ["checked", "chat-only"] as const) {
    const policy = chatAccessPolicy(mode, () => mode, async () => { asked++; return true; });
    for (const name of ["Read", "ToolSearch", "mcp__atom__open_app", "Agent", "unknown"]) {
      assert.equal(Boolean(await policy.check(name, {}, name)), mode === "chat-only");
    }
  }
  assert.equal(asked, 0);
});

test("strict mode asks once per captured call across hook/canUseTool, never trusts another payload, and asks on a new call/turn", async () => {
  let asked = 0;
  const policy = chatAccessPolicy("ask-changes", () => "ask-changes", async () => { asked++; return true; });
  const gate = nativeGate({ tools: [], access: policy });
  const name = "mcp__atom__open_app", input = { app: "TextEdit" };
  const hook = (gate.hooks.PreToolUse as any)[0].hooks[0];
  assert.equal((await hook({ tool_name: name, tool_input: input }, "same")).hookSpecificOutput.permissionDecision, "allow");
  assert.equal((await gate.canUseTool(name, input, { toolUseID: "same" })).behavior, "allow");
  assert.equal(asked, 1);
  assert.equal((await gate.canUseTool(name, { app: "Other" }, { toolUseID: "same" })).behavior, "deny");
  await gate.canUseTool(name, input, { toolUseID: "next" }); assert.equal(asked, 2);
  gate.newAnswer(); await gate.canUseTool(name, input, { toolUseID: "same" }); assert.equal(asked, 3);
  assert.equal((await gate.canUseTool("Bash", { command: "ls" })).behavior, "deny", "approval never overrides the native tool allowlist");
  assert.equal(asked, 4);
});

test("read-only is a closed list; unknown MCP/browser calls require fresh approval and oversized commands fail closed", async () => {
  const asked: string[] = [];
  const policy = chatAccessPolicy("ask-changes", () => "ask-changes", async (r) => { asked.push(r.summary); return false; });
  assert.equal(await policy.check("Read", { file_path: "/tmp/cedar" }, "read"), undefined);
  assert.equal(await policy.check("mcp__atom__current_time", {}, "time"), undefined);
  assert.ok(await policy.check("mcp__external__readAndChange", {}, "external"));
  assert.ok(await policy.check("mcp__browser__click", {}, "browser"));
  assert.ok(await policy.check("Bash", { command: "x".repeat(600) }, "large"));
  assert.equal(asked.length, 2);
});

test("late Allow cannot survive cancellation or a changed access mode", async () => {
  for (const change of ["cancel", "mode"] as const) {
    let mode: ChatAccessMode = "ask-changes", allow!: (v: boolean) => void;
    const controller = new AbortController();
    const policy = chatAccessPolicy(mode, () => mode, () => new Promise((resolve) => { allow = resolve; }));
    const pending = policy.check("mcp__atom__open_app", {}, "late", undefined, controller.signal);
    if (change === "cancel") controller.abort(); else mode = "checked";
    allow(true); assert.ok(await pending);
  }
});

test("access command accepts only named modes, exact fields and a captured previous mode", () => {
  const command = { type: "chat.access", id: "cedar", mode: "chat-only", expected: "checked" };
  assert.deepEqual(parseCommand(JSON.stringify(command)), { command });
  for (const bad of [{ ...command, mode: "unrestricted" }, { ...command, expected: undefined }, { ...command, permissions: "all" }, { ...command, id: "../chat" }]) assert.ok("error" in parseCommand(JSON.stringify(bad)));
});

test("Full access skips only extra routine approval, remains live/revocable and binds the confirmation command without extra grants", async () => {
  assert.ok(FULL_ACCESS_CONFIRMATION.length <= 600, "The entire activation scope must fit the review card");
  let current: ChatAccessMode = "full", asks = 0;
  const policy = chatAccessPolicy("full", () => current, async () => { asks++; return false; });
  assert.equal(policy.fullAccess(), true);
  assert.equal(await policy.check("Write", { file_path: "/tmp/fictional" }, "write"), undefined);
  assert.equal(asks, 0);
  const stopped = new AbortController(); stopped.abort(); assert.equal(policy.fullAccess(stopped.signal), false);
  current = "checked"; assert.equal(policy.fullAccess(), false);
  assert.ok(await policy.check("Write", {}, "stale"));
  const command = { type: "chat.access", id: "cedar", mode: "full", expected: "checked" };
  assert.deepEqual(parseCommand(JSON.stringify(command)), { command });
  assert.ok("error" in parseCommand(JSON.stringify({ ...command, confirmed: true })));
});
