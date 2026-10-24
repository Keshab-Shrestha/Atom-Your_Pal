import assert from "node:assert/strict";
import { test } from "node:test";
import { openWhy, saveWhy, savedNote, validBrief } from "./brief.ts";

test("a brief may hold tabs, line breaks and any ordinary text, but no hidden controls", () => {
  for (const ok of ["", "Plan\n\tnext step\r\n", "日本語 and emoji 😀", "a b"]) assert.ok(validBrief(ok), JSON.stringify(ok));
  for (const bad of ["a\u0000b", "a\u0008b", "a\u001bb", "a\u007fb", "a\u0085b", "a​b", "a‮b", "a⁦b", "﻿a", "a\ud800b", "a\udc00"]) assert.ok(!validBrief(bad), JSON.stringify(bad));
});

test("the brief opens only for a saved chat that can be written, and not while something is in progress", () => {
  assert.match(openWhy(undefined, undefined)!, /no saved chat/);
  assert.match(openWhy({ messages: 2, readOnly: true }, undefined)!, /another surface/);
  assert.match(openWhy({ messages: 0 }, undefined)!, /not saved yet/);
  assert.equal(openWhy({ messages: 2 }, "Finish or stop the active turn first."), "Finish or stop the active turn first.");
  assert.equal(openWhy({ messages: 2 }, undefined), undefined);
});

test("Save explains the reasons the user can act on", () => {
  assert.match(saveWhy({ onOriginalChat: false, draft: "x", busy: undefined })!, /original chat/);
  assert.match(saveWhy({ onOriginalChat: true, draft: "x​", busy: undefined })!, /hidden control/);
  assert.equal(saveWhy({ onOriginalChat: true, draft: "x", busy: "Finish or stop the active turn first." }), "Finish or stop the active turn first.");
  assert.equal(saveWhy({ onOriginalChat: true, draft: "x", busy: undefined }), undefined);
});

test("a save that arrives after more typing says the newer words were not saved", () => {
  assert.equal(savedNote("a", "a"), "Saved for this chat.");
  assert.match(savedNote("ab", "a"), /newer draft has not been saved/);
});
