import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IMAGE_TYPES, LONG_PASTE, MAX_BYTES, MAX_FILES, TEXT_TYPES, kindOf, pasteDecision, refuseFile, sizeLabel, splitAttachments } from "./attachments.ts";

// The runtime is the authority. These limits and lists are read out of its source, so a change there fails here.
const runtime = readFileSync(fileURLToPath(new URL("../../../mac/src/attachments.ts", import.meta.url)), "utf8");
const listOf = (name: string) => new Set([...runtime.slice(runtime.indexOf(`const ${name} = new Set([`)).split("]);")[0]!.matchAll(/"(\.[a-z0-9]+)"/g)].map((m) => m[1]!));

test("the limits and type lists equal the runtime's own", () => {
  assert.equal(MAX_BYTES, Number(/MAX_ATTACH_BYTES = (\d+) \* 1024 \* 1024/.exec(runtime)![1]) * 1024 * 1024);
  assert.equal(MAX_FILES, Number(/MAX_ATTACH_FILES = (\d+)/.exec(runtime)![1]));
  assert.deepEqual([...IMAGE_TYPES].sort(), [...listOf("IMAGE")].sort());
  assert.deepEqual([...TEXT_TYPES].sort(), [...listOf("TEXT")].sort());
  assert.ok(TEXT_TYPES.size > 20, "the list was really read");
});

test("kinds by name; no extension is let through for the runtime to look inside", () => {
  assert.deepEqual(["a.PNG", "b.pdf", "c.ts", "Makefile", "d.exe", ".env", "archive.tar.gz"].map(kindOf), ["image", "pdf", "text", "unknown", undefined, "unknown", undefined]);
});

test("refusals say what is wrong, in the runtime's words", () => {
  assert.equal(refuseFile("a.txt", 10, 0), undefined);
  assert.equal(refuseFile("a.txt", 10, MAX_FILES), "Attach at most 5 files to one message.");
  assert.equal(refuseFile("a.txt", 0, 0), "a.txt is empty.");
  assert.equal(refuseFile("a.txt", MAX_BYTES + 1, 0), "a.txt is over 10 MB, too big to attach.");
  assert.match(refuseFile("a.exe", 10, 0)!, /reads text, code, PDFs and images/);
});

const noSlots = 0;
test("paste: ordinary text is left to the browser; hidden controls are removed and counted", () => {
  assert.deepEqual(pasteDecision("hello", "", [0, 0], 5, undefined), { kind: "normal" });
  assert.deepEqual(pasteDecision("a​b‮c", "", [0, 0], 5, undefined), { kind: "clean", text: "abc", removed: 2 });
  assert.deepEqual(pasteDecision("​‎", "keep", [0, 0], 5, undefined), { kind: "nothing", removed: 2 });
});

test("paste: 4,000 characters, or a draft that would pass 4,000, becomes a file and leaves the draft alone", () => {
  const long = "x".repeat(LONG_PASTE);
  assert.deepEqual(pasteDecision(long, "", [0, 0], 5, undefined), { kind: "attach", text: long, removed: 0 });
  assert.equal(pasteDecision("x".repeat(LONG_PASTE - 1), "", [0, 0], 5, undefined).kind, "normal");
  assert.equal(pasteDecision("x".repeat(100), "y".repeat(LONG_PASTE - 99), [LONG_PASTE - 99, LONG_PASTE - 99], 5, undefined).kind, "attach");
  // replacing a selection counts what it removes
  assert.equal(pasteDecision("x".repeat(100), "y".repeat(LONG_PASTE), [0, 200], 5, undefined).kind, "normal");
});

test("paste: a long paste is refused, not dropped silently, when no file can be made", () => {
  const long = "x".repeat(LONG_PASTE);
  const full = pasteDecision(long, "", [0, 0], noSlots, undefined);
  assert.equal(full.kind, "refuse");
  assert.match((full as { why: string }).why, /already has 5 attachments/);
  const project = pasteDecision(long, "", [0, 0], 5, "Project chats take no attachments.");
  assert.equal(project.kind, "refuse");
  assert.match((project as { why: string }).why, /Project chats take no attachments\. Save the text/);
});

test("paste: characters are counted as characters, not UTF-16 units", () => {
  assert.equal(pasteDecision("😀".repeat(LONG_PASTE - 1), "", [0, 0], 5, undefined).kind, "normal");
  assert.equal(pasteDecision("😀".repeat(LONG_PASTE), "", [0, 0], 5, undefined).kind, "attach");
});

test("a sent message's attachment markers become names and the local path never shows", () => {
  const pieces = splitAttachments("Please read these.\n[Attached: report.pdf — /Users/k/ATOM/chat/report.pdf]\n[Attached: Pasted text 1.txt — /tmp/x/Pasted text 1.txt]");
  assert.deepEqual(pieces, [{ text: "Please read these.\n" }, { attached: "report.pdf" }, { text: "\n" }, { attached: "Pasted text 1.txt" }]);
  assert.ok(!JSON.stringify(pieces).includes("/Users"));
  assert.deepEqual(splitAttachments("no files"), [{ text: "no files" }]);
});

test("sizes read naturally", () => {
  assert.deepEqual([512, 2048, 5 * 1024 * 1024].map(sizeLabel), ["512 B", "2 KB", "5.0 MB"]);
});
