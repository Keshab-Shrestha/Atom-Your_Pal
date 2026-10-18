import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { createComputerBridge, type ApprovalAsk } from "./computer-bridge.ts";
import { reviewPreviewEdit } from "./preview-edit.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-reviewed-edit-")));
  const root = join(home, "project"), path = join(root, "launch.txt"), db = join(home, "helpers.db"), copies = join(home, "checkpoints");
  mkdirSync(root);
  const before = "Cedar launches Wednesday.\n".repeat(35);
  const after = before.replace("Wednesday", "Thursday");
  writeFileSync(path, before);
  let store = openHelperStore({ path: db, home, checkpointsDir: copies });
  store.addGrant("kame", root);
  const job = store.addNativeJob("kame", "Review the fictional launch", { chatId: "cedar" });
  const control = new AbortController(), bridge = createComputerBridge();
  bridge.attach(() => {});
  const asks: ApprovalAsk[] = [];
  bridge.onAsk((ask) => asks.push(ask));
  const options = {
    root, path, expected: sha(before), content: after, signal: control.signal,
    allowed: () => store.get(job.id)?.state === "running",
    read: async () => true, write: async () => true,
    approve: async () => { throw new Error("A native review must never fall back to the generic card"); },
    approveReview: (review: { path: string; before: string; after: string }, signal: AbortSignal) => bridge.approveFileEdit({ summary: "Review Cedar launch", ...review }, signal),
    checkpoint: (original: string, expectedBefore: string, expectedAfter: string) => store.guardPreviewEdit(job.id, [root], path, original, expectedBefore, expectedAfter),
  };
  return {
    before, after, path, root, job, bridge, control, asks, options,
    get store() { return store; },
    reopen() { store.close(); store = openHelperStore({ path: db, home, checkpointsDir: copies }); },
    done() { bridge.cancelAll(); store.close(); rmSync(home, { recursive: true, force: true }); },
  };
}

test("native review applies complete text beyond the old card limit and Undo restores it after reopening", async () => {
  const f = fixture();
  try {
    f.bridge.onAsk((ask) => f.bridge.answer(ask.id, true, false, ask.fileReview?.token));
    const answer = await reviewPreviewEdit(f.options);
    assert.equal(answer.isError, false, answer.text);
    assert.ok(f.before.length > 600);
    assert.deepEqual(f.asks[0]?.fileReview && { ...f.asks[0].fileReview, token: "checked" }, { path: f.path, before: f.before, after: f.after, token: "checked" });
    assert.equal(readFileSync(f.path, "utf8"), f.after);
    f.store.finishCheckpoints(f.job.id);
    f.store.finish(f.job.id, { title: "Saved", summary: "Saved", body: "Saved", sources: [] });
    f.reopen();
    assert.deepEqual(f.store.undoCheckpoints(f.job.id), [{ path: "launch.txt", result: "restored" }]);
    assert.equal(readFileSync(f.path, "utf8"), f.before);
  } finally { f.done(); }
});

test("a later human edit remains an Undo conflict through task completion and restart", async () => {
  const f = fixture();
  try {
    f.bridge.onAsk((ask) => f.bridge.answer(ask.id, true, false, ask.fileReview?.token));
    assert.equal((await reviewPreviewEdit(f.options)).isError, false);
    writeFileSync(f.path, "Human changes after the approved replacement.");
    f.store.finishCheckpoints(f.job.id);
    f.store.finish(f.job.id, { title: "Saved", summary: "Saved", body: "Saved", sources: [] });
    f.reopen();
    assert.equal(f.store.checkpoints(f.job.id)[0]?.state, "changed");
    assert.equal(f.store.undoCheckpoints(f.job.id)[0]?.result, "conflict");
    assert.equal(readFileSync(f.path, "utf8"), "Human changes after the approved replacement.");
  } finally { f.done(); }
});

test("a source changed while its review is open is preserved and never checkpointed as an approved edit", async () => {
  const f = fixture();
  try {
    f.bridge.onAsk((ask) => { writeFileSync(f.path, "New human source"); f.bridge.answer(ask.id, true, false, ask.fileReview?.token); });
    const answer = await reviewPreviewEdit(f.options);
    assert.equal(answer.isError, true); assert.match(answer.text, /source changed/i);
    assert.equal(readFileSync(f.path, "utf8"), "New human source");
    assert.deepEqual(f.store.checkpoints(f.job.id), []);
  } finally { f.done(); }
});

test("generic Allow cannot apply a native review or create its undo record", async () => {
  const f = fixture();
  try {
    f.bridge.onAsk((ask) => f.bridge.answer(ask.id, true));
    assert.equal((await reviewPreviewEdit(f.options)).isError, true);
    assert.equal(readFileSync(f.path, "utf8"), f.before);
    assert.deepEqual(f.store.checkpoints(f.job.id), []);
  } finally { f.done(); }
});

test("Stop closes an outstanding review and a late correct token cannot replace the file", async () => {
  const f = fixture();
  try {
    f.bridge.onAsk((ask) => { f.control.abort(); f.bridge.answer(ask.id, true, false, ask.fileReview?.token); });
    assert.equal((await reviewPreviewEdit(f.options)).isError, true);
    assert.deepEqual(f.bridge.pending(), []);
    assert.equal(readFileSync(f.path, "utf8"), f.before);
    assert.deepEqual(f.store.checkpoints(f.job.id), []);
  } finally { f.done(); }
});

test("an approved edit is refused when required undo storage is unavailable", async () => {
  const f = fixture();
  try {
    f.bridge.onAsk((ask) => f.bridge.answer(ask.id, true, false, ask.fileReview?.token));
    const answer = await reviewPreviewEdit({ ...f.options, checkpoint: () => false });
    assert.equal(answer.isError, true); assert.match(answer.text, /undo copy could not be secured/);
    assert.equal(readFileSync(f.path, "utf8"), f.before);
  } finally { f.done(); }
});

test("oversized native reviews refuse before write policy or a clipped/generic approval", async () => {
  const f = fixture();
  try {
    let writes = 0;
    const answer = await reviewPreviewEdit({ ...f.options, content: "x".repeat(33 * 1024), write: async () => { writes++; return true; } });
    assert.equal(answer.isError, true); assert.equal(writes, 0); assert.deepEqual(f.asks, []);
    assert.equal(readFileSync(f.path, "utf8"), f.before);
  } finally { f.done(); }
});
