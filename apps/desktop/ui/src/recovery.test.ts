import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DRAFT_BYTES, dismissWhy, draftText, dropKnown, fileNames, needsReview, restoreWhy, restoredNote } from "./recovery.ts";

const record = (extra: object = {}) => ({ text: "Rename the files", answers: [] as { id: string; question: string; answer: string }[], state: "interrupted", ...extra });

test("clarification answers are appended as labelled history, never as instructions", () => {
  assert.equal(draftText(record()), "Rename the files");
  const text = draftText(record({ answers: [{ id: "q", question: "Which folder?", answer: "Invoices" }] }));
  assert.equal(text, "Rename the files\n\nEarlier clarifications (review before retry; not permissions):\nQuestion: Which folder?\nAnswer: Invoices");
});

test("a request that is still running cannot be restored or dismissed", () => {
  for (const state of ["prepared", "running"]) {
    assert.match(restoreWhy(record({ state }), undefined)!, /still running/);
    assert.match(dismissWhy(state)!, /still running/);
  }
  for (const state of ["completed", "failed", "stopped", "interrupted"]) {
    assert.equal(restoreWhy(record({ state }), undefined), undefined);
    assert.equal(dismissWhy(state), undefined);
  }
});

test("a prompt over 128 KiB is not restored; the composer's own reason comes through", () => {
  assert.match(restoreWhy(record({ text: "x".repeat(MAX_DRAFT_BYTES + 1) }), undefined)!, /too large/);
  assert.equal(restoreWhy(record(), "Use an empty composer."), "Use an empty composer.");
});

test("an attempt needs review unless it completed and its reply is in the saved chat", () => {
  assert.equal(needsReview({ state: "completed", archived: true, hasReply: false }), false);
  assert.equal(needsReview({ state: "completed", archived: false, hasReply: true }), true);
  for (const state of ["failed", "stopped", "interrupted", "running"]) assert.equal(needsReview({ state, archived: true, hasReply: false }), true);
});

test("file names are shown without their folders, from either kind of path", () => {
  assert.deepEqual(fileNames(["/tmp/atom-uploads-x/uuid/report.pdf", "C:\\Users\\k\\notes.txt"]), ["report.pdf", "notes.txt"]);
});

test("the restore note says the words are back and names the files that are not", () => {
  assert.match(restoredNote({ files: [], notes: [] }), /^Draft restored\./);
  const note = restoredNote({ files: ["/a/b/report.pdf"], notes: [4] });
  assert.match(note, /2 attached files or notes cannot be restored here \(report\.pdf, note #4\)/);
});

test("held copies the host already holds are dropped, ids compared without regard to case", () => {
  const held = [{ id: "AAAAAAAA-1111-4111-8111-111111111111" }, { id: "bbbbbbbb-2222-4222-8222-222222222222" }];
  assert.deepEqual(dropKnown(held, ["aaaaaaaa-1111-4111-8111-111111111111"]), [held[1]]);
  assert.equal(dropKnown(held, []).length, 2);
});
