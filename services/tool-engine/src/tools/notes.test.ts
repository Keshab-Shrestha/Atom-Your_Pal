import { test } from "node:test";
import assert from "node:assert/strict";
import { appleScriptString, createNoteTools, noteHtml } from "./notes.ts";

test("note_add makes one note with an escaped body", async () => {
  const scripts: string[] = [];
  const [add] = createNoteTools({ osascript: async (s) => (scripts.push(s), "") });
  const out = await add!.run({ title: "Ideas", text: 'Buy "milk" & <eggs>' }, new AbortController().signal);
  assert.equal(out, 'Saved a note in Notes: "Ideas".');
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0]!.includes("&amp; &lt;eggs&gt;"));
  assert.ok(scripts[0]!.includes('\\"milk\\"'));
});

test("helpers", () => {
  assert.equal(appleScriptString('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(noteHtml("T", "x\n\ny"), "<div><b>T</b></div><div>x</div><div><br></div><div>y</div>");
});
