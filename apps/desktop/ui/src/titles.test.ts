import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTitle, MAX_TITLE } from "./titles.ts";

test("titles are trimmed, one line, and 1 to 60 characters", () => {
  assert.deepEqual(checkTitle("  Kyoto trip  "), { ok: true, title: "Kyoto trip" });
  assert.equal(checkTitle("   ").ok, false);
  assert.equal(checkTitle("a\nb").ok, false);
  assert.equal(checkTitle("x".repeat(MAX_TITLE)).ok, true);
  assert.equal(checkTitle("x".repeat(MAX_TITLE + 1)).ok, false);
});

test("length counts characters, not UTF-16 units", () => {
  assert.equal(checkTitle("京".repeat(MAX_TITLE)).ok, true);
  assert.equal(checkTitle("😀".repeat(MAX_TITLE)).ok, true);
});

test("every line-break character is refused", () => {
  for (const c of ["\n", "\r", "\u2028", "\u2029"]) assert.equal(checkTitle("a" + c + "b").ok, false);
});
