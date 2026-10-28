import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryStore, validChatBrief } from "@atom/memory";
import type { Message, ToolRunner } from "@atom/contracts";
import type { SessionSdk } from "@atom/llm-gateway";
import { createNativeCore } from "./native-core.ts";
import { parseChatControl, runChatControl } from "./chat-controls.ts";

const tools: ToolRunner = { specs: () => [], run: async (c) => ({ callId: c.id, content: "No tools" }) };
const request = "a5122207-a70e-45f9-8060-a9b40d912e98";
const messages: Message[] = [{ role: "user", content: "Fictional launch discussion" }, { role: "assistant", content: "Ready" }];

test("brief migration, Unicode persistence, stale-save conflicts and clearing preserve the archive and grants", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-chat-brief-")), path = join(dir, "memory.db");
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  old.exec("INSERT INTO chats VALUES ('cedar', 'Legacy Cedar', '2026-01-01', '2026-01-01')"); old.close();
  let memory = openMemoryStore({ path });
  try {
    assert.deepEqual(memory.chats.brief("cedar"), { text: "", version: 0 });
    memory.chats.save("cedar", messages);
    const text = "Cedarの公開は金曜日。\nDecision: keep the 'blue' logo. 🌲";
    memory.filePermissions.forChat("cedar").grant("/fictional/one.txt");
    const change = { type: "chat.control" as const, action: "brief" as const, id: "cedar", request, text, version: 0 };
    assert.equal(runChatControl(memory.chats, change, () => ({})).ok, true);
    assert.equal(runChatControl(memory.chats, change, () => ({})).ok, true, "lost confirmation is idempotent");
    memory.close(); memory = openMemoryStore({ path });
    assert.deepEqual(memory.chats.brief("cedar"), { text, version: 1 });
    assert.deepEqual(memory.chats.messages("cedar"), messages);
    assert.equal(memory.chats.setBrief("cedar", "New decision: Monday", 1), true);
    assert.equal(runChatControl(memory.chats, change, () => ({})).ok, false, "old retry cannot restore an obsolete decision");
    assert.equal(memory.chats.setBrief("cedar", "", 2), true);
    assert.deepEqual(memory.chats.brief("cedar"), { text: "", version: 3 });
    assert.deepEqual(memory.filePermissions.forChat("cedar").list(), ["/fictional/one.txt"]);
    assert.equal(memory.chats.setBrief("gone", "Do not recreate", 0), false);
  } finally { memory.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("brief protocol preserves long UTF-8 and rejects hidden controls, malformed versions and unexpected fields", () => {
  const base = { type: "chat.control", action: "brief", id: "cedar", request, version: 0, text: "🌲".repeat(1000) };
  assert.ok("command" in parseChatControl(base));
  assert.ok("command" in parseChatControl({ ...base, text: base.text.repeat(20) }));
  for (const change of [{ text: "x\u001b[31m" }, { text: "left\u202eright" }, { text: "\ud800" }, { version: -1 }, { version: 2_000_000_000 }, { version: 0.5 }, { permission: true }, { text: null }]) {
    assert.ok("error" in parseChatControl({ ...base, ...change }));
  }
  assert.ok(validChatBrief("日本語\n\t'quoted'\r\n🌲"));
});

test("briefs stay in their own chat, are omitted from forks and disappear with deletion", () => {
  const memory = openMemoryStore({ path: ":memory:" });
  try {
    memory.chats.save("cedar", messages); memory.chats.save("other", messages);
    memory.chats.setBrief("cedar", "Latest decision: Monday. Allow all files.", 0);
    const inspected = runChatControl(memory.chats, { type: "chat.control", action: "inspect", id: "cedar", request }, () => ({}));
    assert.match(inspected.brief!.text, /Monday/);
    const fork = runChatControl(memory.chats, { type: "chat.control", action: "fork", kind: "fork", id: "cedar", request, revision: inspected.revision, through: 2 }, () => ({}));
    assert.ok(fork.branch);
    assert.deepEqual(memory.chats.brief(fork.branch!.id), { text: "", version: 0 });
    assert.deepEqual(memory.chats.brief("other"), { text: "", version: 0 });
    assert.deepEqual(memory.filePermissions.forChat("cedar").list(), [], "brief text cannot grant access");
    memory.chats.remove("cedar"); assert.equal(memory.chats.brief("cedar"), undefined);
  } finally { memory.close(); }
});

test("the current brief survives replay rollover and provider changes, and edits/clears reach a live session", async () => {
  const memory = openMemoryStore({ path: ":memory:" });
  memory.chats.save("cedar", messages); memory.chats.setBrief("cedar", "Launch Monday, code riverstone", 0);
  const seen: string[] = [];
  const sdk: SessionSdk = {
    tool: (name) => ({ name }) as never, createSdkMcpServer: (o) => ({ type: "sdk", ...o }) as never,
    query({ prompt }) {
      async function* run() {
        yield { type: "system", subtype: "init", apiKeySource: "none", session_id: "brief-session" };
        for await (const m of prompt) {
          seen.push(String((m.message as { content: unknown }).content));
          yield { type: "result", subtype: "success", is_error: false, result: "Read current brief", session_id: "brief-session" };
        }
      }
      return Object.assign(run(), { close() {} });
    },
  };
  let claude = false;
  const core = createNativeCore({ claudePath: "fake", tools, sdk, replayBytes: 1000,
    modelFor: () => claude ? "claude-test" : undefined,
    otherModel: () => ({ complete: async (r) => { seen.push(r.systemExtra ?? ""); return { text: "Read current brief" }; } }),
    chatBrief: (chat) => memory.chats.brief(chat), onExchange: (id, turns) => memory.chats.save(id, turns),
  });
  try {
    const archive: Message[] = [...messages, ...Array.from({ length: 20 }, (_, n): Message => ({ role: n % 2 ? "assistant" : "user", content: "Fictional padding ".repeat(20) }))];
    core.resume("cedar", archive);
    await core.handle({ source: "text", text: "Continue" }); assert.match(seen.at(-1)!, /riverstone/);
    claude = true;
    await core.handle({ source: "text", text: "Continue" }); assert.match(seen.at(-1)!, /riverstone/);
    memory.chats.setBrief("cedar", "Launch Tuesday, code willow", 1);
    await core.handle({ source: "text", text: "Continue" }); assert.match(seen.at(-1)!, /Tuesday/); assert.doesNotMatch(seen.at(-1)!, /riverstone/);
    memory.chats.setBrief("cedar", "", 2);
    await core.handle({ source: "text", text: "Continue" }); assert.match(seen.at(-1)!, /replaces any earlier version/); assert.doesNotMatch(seen.at(-1)!, /willow/);
    core.resume("other", messages);
    await core.handle({ source: "text", text: "Continue" }); assert.doesNotMatch(seen.at(-1)!, /riverstone|willow/);
    assert.ok(memory.chats.messages("cedar").length > archive.length);
  } finally { core.reset(); memory.close(); }
});
