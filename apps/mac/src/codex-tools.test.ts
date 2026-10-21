import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openHelperStore } from "@atom/helpers";
import { openMemoryStore } from "@atom/memory";
import type { ModelRequest } from "@atom/contracts";
import { fakeCodex } from "../../../tests/codex-harness.ts";
import { createCodexToolRouter } from "./codex-tools.ts";
import { chatHistoryTools } from "./chat-history.ts";

const request = (id = "chat"): ModelRequest => ({ system: "ATOM", messages: [{ role: "user", content: "rewrite the file" }], context: { sessionId: id, requestId: "r", source: "text", receivedAt: new Date() } });

test("a real host file edit uses the approval gate, writes a Board report, and reuses only an explicit chat grant", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-codex-host-")));
  const helpers = openHelperStore({ path: ":memory:", home });
  const memory = openMemoryStore({ path: ":memory:" });
  const path = join(home, "page.html"); writeFileSync(path, "old");
  const anotherPath = join(home, "another.html"); writeFileSync(anotherPath, "another old file");
  let target = path;
  helpers.setSkills("kame", ["unloaded-skill"]);
  let runs = 0, approvals = 0;
  const fake = fakeCodex(async ({ call, start }) => {
    assert.ok(!start.dynamicTools.some((s: { name: string }) => /chat_history/.test(s.name)), "workers must not inherit the main chat's archive tools");
    const out = await call("atom_Write", { file_path: target, content: `draft ${++runs}` });
    assert.equal(out.success, true);
    return "Saved the revised page.";
  });
  const router = createCodexToolRouter({ program: "fake", model: "codex-default", home, tools: { specs: () => [], run: async (c) => ({ callId: c.id, content: "ok" }) }, session: { transport: fake.factory }, team: { helpers, worktrees: join(home, "worktrees"), filePermissions: memory.filePermissions, approve: async () => false, approveFile: async () => { approvals++; return "chat"; } } });
  try {
    for (let i = 0; i < 2; i++) {
      const runner = router.forRequest({ ...request(), historyTools: chatHistoryTools(() => [{ role: "user", content: "Main chat only" }]) });
      assert.ok(runner.specs().some((s) => s.name === "atom_read_chat_history"));
      const out = await runner.run({ id: `delegate-${i}`, name: "atom_delegate", input: { subagent_type: "kame", description: "Rewrite", prompt: "Rewrite the page" } });
      assert.equal(out.isError, undefined, out.content);
      assert.match(out.content, /Saved the revised page/);
      assert.equal(readFileSync(path, "utf8"), `draft ${i + 1}`);
    }
    assert.equal(approvals, 1);
    const jobs = helpers.list().find((h) => h.id === "kame")!.jobs;
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((j) => j.state === "done"));
    assert.ok(jobs.every((j) => helpers.skillsUsed(j.id).length === 0), "Codex must not claim it loaded assigned Claude skills");
    assert.match(helpers.report(jobs[0]!.id)!.body, /Saved the revised page/);
    target = anotherPath;
    await router.forRequest(request()).run({ id: "another-file", name: "atom_delegate", input: { subagent_type: "kame", description: "Rewrite another file", prompt: "Rewrite another file" } });
    assert.equal(approvals, 2, "another file asks even when a new worker process reuses its RPC call ids");
    assert.equal(readFileSync(anotherPath, "utf8"), "draft 3");
    await router.forRequest(request("other-chat")).run({ id: "other", name: "atom_delegate", input: { subagent_type: "kame", description: "Rewrite", prompt: "Rewrite" } });
    assert.equal(approvals, 3, "another chat asks again");
  } finally { router.close(); helpers.close(); memory.close(); rmSync(home, { recursive: true, force: true }); }
});

test("protected files are refused and a cancelled approval cannot write afterwards", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-codex-stop-")));
  const helpers = openHelperStore({ path: ":memory:", home });
  const memory = openMemoryStore({ path: ":memory:" });
  const path = join(home, "page.html"); writeFileSync(path, "old");
  const secret = join(home, "credentials.txt"); writeFileSync(secret, "-----BEGIN PRIVATE KEY-----\nfictional test content");
  let allowed!: (answer: "chat") => void;
  let asked!: () => void; const waiting = new Promise<void>((r) => { asked = r; });
  const fake = fakeCodex(async ({ call }) => {
    assert.equal((await call("atom_Write", { file_path: join(home, ".ssh", "id_test"), content: "no" })).success, false);
    assert.equal((await call("atom_Grep", { path: secret, pattern: "PRIVATE" })).success, false, "Grep cannot expose secret-shaped file content");
    const out = await call("atom_Write", { file_path: path, content: "should not be saved" });
    return out.success ? "saved" : "not saved";
  });
  const router = createCodexToolRouter({ program: "fake", model: "codex-default", home, tools: { specs: () => [], run: async (c) => ({ callId: c.id, content: "ok" }) }, session: { transport: fake.factory }, team: { helpers, worktrees: join(home, "worktrees"), filePermissions: memory.filePermissions, approve: async () => false, approveFile: () => { asked(); return new Promise((r) => { allowed = r; }); } } });
  try {
    const pending = router.forRequest(request()).run({ id: "delegate", name: "atom_delegate", input: { subagent_type: "kame", description: "Rewrite", prompt: "Rewrite" } });
    await Promise.race([waiting, pending.then(() => { throw new Error(JSON.stringify(helpers.list().flatMap((h) => h.jobs).map((j) => j.error))); })]);
    const job = helpers.list().find((h) => h.id === "kame")!.jobs[0]!;
    assert.equal(router.stopJob(job.id), true);
    const outcome = await pending;
    assert.equal(outcome.isError, true);
    allowed("chat");
    // The tool coroutine completes after the approval returns, even though its Codex process has ended.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(readFileSync(path, "utf8"), "old");
    assert.deepEqual(memory.filePermissions.forChat("chat").list(), [], "a cancelled approval cannot create a continuing grant");
    assert.equal(helpers.get(job.id)!.state, "stopped");
  } finally { router.close(); helpers.close(); memory.close(); rmSync(home, { recursive: true, force: true }); }
});

test("access modes constrain Codex foreground and worker calls without losing continuing file grants", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-codex-access-")));
  const helpers = openHelperStore({ path: ":memory:", home });
  const memory = openMemoryStore({ path: ":memory:" });
  const path = join(home, "page.txt"); writeFileSync(path, "old");
  memory.filePermissions.forChat("chat").grant(path);
  let mode: import("@atom/contracts").ChatAccessMode = "ask-changes", writesAllowed = false, approvals = 0, hostCalls = 0;
  const fake = fakeCodex(async ({ call }) => {
    const answer = await call("atom_Write", { file_path: path, content: "new" });
    assert.equal(answer.success, writesAllowed);
    return answer.success ? "saved" : "declined";
  });
  const router = createCodexToolRouter({ program: "fake", model: "codex-test", home,
    accessFor: () => mode, approveAccess: async (r) => { approvals++; return r.summary.includes("Agent") || writesAllowed; },
    tools: { specs: () => [{ name: "open_app", description: "Open", inputSchema: { type: "object" } }], run: async (c) => { hostCalls++; return { callId: c.id, content: "opened" }; } },
    session: { transport: fake.factory }, team: { helpers, worktrees: join(home, "worktrees"), filePermissions: memory.filePermissions,
      approve: async () => false, approveFile: async () => { throw new Error("Saved grant should satisfy existing file policy"); } } });
  const delegate = { id: "reused-provider-id", name: "atom_delegate", input: { subagent_type: "kame", description: "Rewrite Cedar", prompt: "Rewrite the file" } };
  try {
    let runner = router.forRequest({ ...request(), access: mode });
    await runner.run(delegate); assert.equal(readFileSync(path, "utf8"), "old"); assert.equal(approvals, 2, "task starts, then edit asks despite continuing grant");
    writesAllowed = true; await router.forRequest({ ...request(), access: mode }).run(delegate);
    assert.equal(readFileSync(path, "utf8"), "new"); assert.equal(approvals, 4, "new worker/process ids never reuse approval");
    assert.equal(memory.filePermissions.forChat("chat").list().length, 1);
    mode = "chat-only";
    assert.equal((await runner.run({ id: "stale", name: "atom_open_app", input: {} })).isError, true, "old runners lose authority");
    runner = router.forRequest({ ...request(), access: mode });
    assert.deepEqual(runner.specs(), []); assert.equal((await runner.run(delegate)).isError, true); assert.equal(hostCalls, 0);
    mode = "checked";
    await router.forRequest({ ...request(), access: mode }).run({ id: "checked", name: "atom_open_app", input: {} });
    assert.equal(hostCalls, 1); assert.equal(approvals, 4);
  } finally { router.close(); helpers.close(); memory.close(); rmSync(home, { recursive: true, force: true }); }
});
