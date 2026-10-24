import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_MATCHES, countLabel, findInMessages, selectedMatch, stepSelection } from "./find.ts";

const msg = (id: number, role: "user" | "assistant", text: string) => ({ id, role, text });
const text = "Gion for evenings, or near Kyoto Station. Gion is calm; GION is loud.";
const messages = [msg(1, "user", "Which neighbourhood should I stay in?"), msg(2, "assistant", text)];

test("an empty query finds nothing", () => {
  assert.deepEqual(findInMessages(messages, ""), { matches: [], more: false });
});

test("the search is literal and ignores case, in order, with where each match is", () => {
  const { matches } = findInMessages(messages, "gion");
  assert.deepEqual(matches.map((m) => [m.messageId, m.offset, m.found]), [[2, 0, "Gion"], [2, text.indexOf("Gion is"), "Gion"], [2, text.indexOf("GION"), "GION"]]);
  assert.equal(matches[0]!.user, false);
  assert.equal(findInMessages(messages, "which").matches[0]!.user, true);
});

test("characters that mean something in a pattern are plain text", () => {
  const found = findInMessages([msg(1, "assistant", "a.b a+b (x) [y] a\\b a?b")], ".");
  assert.equal(found.matches.length, 1);
  for (const q of ["a+b", "(x)", "[y]", "a\\b", "a?b", "^", "$", "*"]) assert.ok(findInMessages([msg(1, "assistant", "a+b (x) [y] a\\b a?b ^ $ *")], q).matches.length >= 1, q);
  assert.equal(findInMessages(messages, ".*").matches.length, 0);
});

test("context is 40 characters before and 60 after, and matches do not overlap", () => {
  const text = `${"a".repeat(100)}NEEDLE${"b".repeat(100)}`;
  const [m] = findInMessages([msg(1, "assistant", text)], "needle").matches;
  assert.equal(m!.before, "a".repeat(40));
  assert.equal(m!.after, "b".repeat(60));
  assert.equal(findInMessages([msg(1, "assistant", "aaaa")], "aa").matches.length, 2);
});

test("context never splits an emoji", () => {
  const text = `${"😀".repeat(30)}x${"😀".repeat(40)}`;
  const [m] = findInMessages([msg(1, "assistant", text)], "x").matches;
  for (const part of [m!.before, m!.after]) assert.doesNotMatch(part, /^[\udc00-\udfff]|[\ud800-\udbff]$/u);
});

test("it stops at 500 matches and says there are more", () => {
  const found = findInMessages([msg(1, "assistant", "ab ".repeat(MAX_MATCHES + 5))], "ab");
  assert.equal(found.matches.length, MAX_MATCHES);
  assert.equal(found.more, true);
  assert.equal(countLabel(found, 0), "1 of 500+");
  assert.equal(findInMessages([msg(1, "assistant", "ab ".repeat(MAX_MATCHES))], "ab").more, false, "exactly 500 is not more");
});

test("selection wraps at both ends and is clamped", () => {
  assert.equal(stepSelection(0, 3, -1), 2);
  assert.equal(stepSelection(2, 3, 1), 0);
  assert.equal(stepSelection(1, 3, 1), 2);
  assert.equal(stepSelection(7, 3, 1), 0, "a stale selection is clamped first");
  assert.equal(stepSelection(0, 0, 1), 0);
  const r = findInMessages(messages, "gion");
  assert.equal(selectedMatch(r, 99)?.offset, text.indexOf("GION"));
  assert.equal(selectedMatch(r, -4)?.offset, 0);
  assert.equal(selectedMatch({ matches: [], more: false }, 0), undefined);
  assert.equal(countLabel(r, 1), "2 of 3");
  assert.equal(countLabel({ matches: [], more: false }, 0), "0 matches");
});
