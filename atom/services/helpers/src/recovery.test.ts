import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { CLOSED_WHILE_RUNNING, openHelperStore } from "./store.ts";

test("an abrupt process exit preserves the last step and actual file changes, then recovers once without replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-recovery-"));
  const path = join(dir, "helpers.db"), file = join(dir, "fictional.txt");
  try {
    const script = `import {openHelperStore} from ${JSON.stringify(resolve("services/helpers/src/store.ts"))}; import {writeFileSync} from 'node:fs'; const s=openHelperStore({path:${JSON.stringify(path)}}); const j=s.addNativeJob('kame','Finish the fictional draft',{chatId:'cedar'}); writeFileSync(${JSON.stringify(file)},'saved before interruption'); s.step(j.id,'Saved the draft; report not confirmed'); process.exit(17);`;
    assert.equal(spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).status, 17);
    let store = openHelperStore({ path });
    const recovered = store.get(1)!;
    assert.equal(recovered.state, "failed"); assert.equal(recovered.recoveryNeeded, true);
    assert.equal(recovered.step, "Saved the draft; report not confirmed");
    assert.equal(recovered.error, CLOSED_WHILE_RUNNING);
    assert.equal(store.queued().length, 0);
    assert.equal(readFileSync(file, "utf8"), "saved before interruption");
    store.close(); store = openHelperStore({ path });
    assert.equal(store.get(1)!.endedAt!.getTime(), recovered.endedAt!.getTime());
    assert.equal(store.get(1)!.step, recovered.step);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an old schema migrates additively and preserves completed reports", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-recovery-schema-"));
  const path = join(dir, "old.db");
  try {
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,helper TEXT NOT NULL,task TEXT NOT NULL,state TEXT NOT NULL,step TEXT,partial INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL,ended_at TEXT); CREATE TABLE reports(job_id INTEGER PRIMARY KEY,title TEXT NOT NULL,summary TEXT NOT NULL,body TEXT NOT NULL,sources TEXT NOT NULL); INSERT INTO jobs VALUES(1,'sid','done','done',NULL,0,NULL,'2026-10-01T01:00:00Z','2026-10-01T01:01:00Z'); INSERT INTO reports VALUES(1,'Saved report','Finished','Original report body','[]');");
    db.close();
    const store = openHelperStore({ path });
    assert.equal(store.get(1)!.state, "done");
    assert.equal(store.get(1)!.recoveryNeeded, undefined);
    assert.equal(store.report(1)!.body, "Original report body");
    const job = store.addNativeJob("kame", "new task", { chatId: "new" });
    store.fail(job.id, "Review needed");
    const retry = store.queueNativeRetry(job.id);
    assert.equal(retry.created, true);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("retry identity survives reopening, duplicate requests do not dispatch again, and only its worker can claim once", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-retry-"));
  const path = join(dir, "helpers.db");
  let store = openHelperStore({ path });
  try {
    const old = store.addNativeJob("kame", "Original saved task", { chatId: "original" });
    store.fail(old.id, "Could not run the provider");
    assert.equal(store.get(old.id)!.state, "failed", "native tasks never enter legacy automatic replay");
    const attempt = store.queueNativeRetry(old.id);
    assert.equal(store.queueNativeRetry(old.id).created, false);
    assert.equal(store.get(old.id)!.retriedAs, attempt.job.id);
    store.close(); store = openHelperStore({ path });
    assert.equal(store.get(attempt.job.id)!.recoveryNeeded, true, "an unstarted retry waits for review after restart");
    assert.equal(store.queueNativeRetry(old.id).created, false, "reopening does not re-dispatch an old retry request");
    const next = store.queueNativeRetry(attempt.job.id).job;
    assert.throws(() => store.addNativeJob("sid", "different task", { chatId: next.chatId! }), /original worker/);
    const claimed = store.addNativeJob("kame", "model-rewritten task", { chatId: next.chatId! });
    assert.equal(claimed.id, next.id); assert.equal(claimed.task, "Original saved task");
    assert.throws(() => store.addNativeJob("kame", "again", { chatId: next.chatId! }), /already dispatched/);
    store.finish(next.id, { title: "Finished", summary: "Done", body: "Saved once", sources: [] });
    assert.throws(() => store.addNativeJob("kame", "again", { chatId: next.chatId! }), /already dispatched/);
    assert.equal(store.get(old.id)!.state, "failed", "original attempt remains an accurate record");
    store.remove(attempt.job.id);
    assert.throws(() => store.addNativeJob("kame", "a delayed delegation", { chatId: attempt.job.chatId! }), /no longer exists/);
    assert.equal(store.get(old.id)!.retriedAs, attempt.job.id, "deleting an attempt cannot erase its durable dispatch identity");
    assert.throws(() => store.queueNativeRetry(old.id), /was removed/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("notes and legacy retry paths cannot reuse a native attempt, and queued failures retain their retry link", () => {
  const store = openHelperStore({ path: ":memory:" });
  try {
    const old = store.addNativeJob("kame", "draft", { chatId: "original" });
    store.fail(old.id, "unavailable");
    store.addComment(old.id, "A note, not an automatic replay");
    assert.equal(store.get(old.id)!.state, "failed");
    assert.throws(() => store.retry(old.id), /explicit retry dispatcher/);
    assert.throws(() => store.startFresh(old.id), /original attempt is kept/);
    const attempt = store.queueNativeRetry(old.id).job;
    store.failQueuedRetry(attempt.id, "The account is limited; no worker started.");
    assert.equal(store.get(attempt.id)!.state, "failed");
    assert.equal(store.get(attempt.id)!.recoveryNeeded, undefined);
    assert.equal(store.get(attempt.id)!.retryOf, old.id);
    assert.equal(store.queueNativeRetry(old.id).created, false);
    assert.equal(store.queueNativeRetry(attempt.id).created, true);
    assert.throws(() => store.queueNativeRetry(999), /no job/);
  } finally { store.close(); }
});
