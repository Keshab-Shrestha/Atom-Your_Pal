import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localFixture } from "../../../tests/local-backup-harness.ts";
import { createLocalBackup, parseLocalBackup, type LocalBackupCommand } from "./local-backup.ts";

test("explicit backup lifecycle retains only successful scratch context, never auto-connects/retries or persists transcript", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-local-backup-check-")), path = join(dir, "backup.json");
  let calls = 0, fail = false; const messages: any[] = [];
  const fixture = await localFixture((req, res, body) => {
    calls++; if (req.url === "/v1/models") { res.end(JSON.stringify({ data: [{ id: "cedar/fixture:tiny" }] })); return; }
    messages.push(body.messages); res.statusCode = fail ? 503 : 200;
    res.end(JSON.stringify({ model: "cedar/fixture:tiny", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Wednesday" } }] }));
  });
  const host = createLocalBackup({ path }), session = randomUUID(); let revision = "unloaded";
  const command = async (action: LocalBackupCommand["action"], more = {}) => {
    const response = await host.handle({ type: "local.backup", request: randomUUID(), session, revision, action, ...more }); revision = response.revision; return response;
  };
  try {
    await command("get"); assert.equal(calls, 0);
    assert.ok((await command("send", { text: "before configuration" })).error);
    await command("save", { config: fixture.config }); assert.equal(calls, 0); assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.ok((await command("send", { text: "before check" })).error); assert.equal(calls, 0);
    assert.equal((await command("probe")).readiness!.textVerified, false);
    const request = randomUUID(), first = await command("send", { request, text: "Cedar day?" });
    assert.equal(first.completed, true); assert.equal(first.turns.length, 2); assert.equal(first.readiness!.textVerified, true);
    await command("send", { request, text: "Cedar day?" }); assert.equal(calls, 2);
    for (let n = 0; n < 520; n++) await command("get");
    await command("send", { request, text: "Cedar day?" }); assert.equal(calls, 2, "send receipts outlive the general recent-request cache");
    fail = true; const failed = await command("send", { text: "Failed question" }); assert.equal(failed.turns.length, 2);
    fail = false; await command("send", { text: "Confirm it" });
    assert.equal(messages.at(-1).length, 4); assert.doesNotMatch(JSON.stringify(messages.at(-1)), /Failed question/);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), fixture.config);
    const before = calls; const reopened = createLocalBackup({ path }); reopened.close(); assert.equal(calls, before);
    assert.equal((await command("get")).turns.length, 4, "Reload reveals host state without inference");
    const stale = revision; await command("save", { config: fixture.config });
    assert.ok((await command("send", { revision: stale, text: "Stale" })).error);
    await command("forget"); assert.equal((await command("get")).config, undefined);
  } finally { host.close(); await fixture.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("closing or cancelling backup refuses late output and does not start another provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-local-backup-cancel-")); let started!: () => void;
  const admitted = new Promise<void>((resolve) => { started = resolve; });
  const fixture = await localFixture((req, res) => {
    if (req.url === "/v1/models") res.end(JSON.stringify({ data: [{ id: "cedar/fixture:tiny" }] })); else started();
  });
  const host = createLocalBackup({ path: join(dir, "backup.json") }), session = randomUUID();
  try {
    let view = await host.handle({ type: "local.backup", request: randomUUID(), session, action: "get" });
    view = await host.handle({ type: "local.backup", request: randomUUID(), session, action: "save", revision: view.revision, config: fixture.config });
    await host.handle({ type: "local.backup", request: randomUUID(), session, action: "probe", revision: view.revision });
    const request = randomUUID(), send = host.handle({ type: "local.backup", request, session, action: "send", revision: view.revision, text: "Cedar?" });
    await admitted;
    assert.ok((await host.handle({ type: "local.backup", request: randomUUID(), session, action: "send", revision: view.revision, text: "Concurrent" })).error);
    await host.handle({ type: "local.backup", request: randomUUID(), session, action: "cancel", target: request });
    assert.equal((await send).turns.length, 0);
    await host.handle({ type: "local.backup", request: randomUUID(), session, action: "close" });
    assert.ok((await host.handle({ type: "local.backup", request: randomUUID(), session, action: "clear", revision: view.revision })).error);
  } finally { host.close(); await fixture.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("invalid/symlink local configuration is not followed and malformed commands cannot invoke inference", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-local-backup-config-")), target = join(dir, "target.json"), path = join(dir, "backup.json");
  writeFileSync(target, JSON.stringify({ endpoint: "http://127.0.0.1:1234/v1", model: "Cedar" })); symlinkSync(target, path);
  const host = createLocalBackup({ path });
  try {
    const view = await host.handle({ type: "local.backup", request: randomUUID(), session: randomUUID(), action: "get" });
    assert.equal(view.config, undefined); assert.match(view.error!, /could not be read/);
    for (const extra of [{ action: "run" }, { session: "bad id" }, { tools: [] }, { action: "send", revision: "ok", text: 42 }])
      assert.throws(() => parseLocalBackup({ type: "local.backup", request: randomUUID(), session: randomUUID(), action: "get", ...extra }));
  } finally { host.close(); rmSync(dir, { recursive: true, force: true }); }
});
