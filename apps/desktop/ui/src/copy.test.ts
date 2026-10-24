import { test } from "node:test";
import assert from "node:assert/strict";
import { collapsed, htmlOfReply, plainInline, quoteAppending, replyContent, stripHidden, tableContent } from "./copy.ts";

test("the clipboard HTML has a real table with escaped cells (MarkdownBlocksTests.swift)", () => {
  assert.equal(
    htmlOfReply("Done.\n\n| Name | Note |\n|---|---|\n| **Ann** | a < b |"),
    '<p>Done.</p><table border="1" cellspacing="0" cellpadding="4"><tr><th>Name</th><th>Note</th></tr><tr><td><strong>Ann</strong></td><td>a &lt; b</td></tr></table>',
  );
});

test("reply formats: markdown keeps the source, plain removes the marks, rich adds HTML with a plain fallback", () => {
  const src = "# Plan\n\nBook **two** nights, see [guide](https://e.co) and `code`.\n\n- [x] done\n- item\n  - child\n\n1. a\n2. b\n\n> quoted\n\n---\n\n```ts\nconst *x* = 1;\n```";
  assert.deepEqual(replyContent(src), { text: src });
  const plain = replyContent(src, "plain");
  assert.equal(plain.html, undefined);
  assert.equal(
    plain.text,
    "Plan\n\nBook two nights, see guide and code.\n\n[x] done\n• item\n  • child\n\n1. a\n2. b\n\nquoted\n\n────────\n\nconst *x* = 1;",
  );
  const rich = replyContent(src, "rich");
  assert.equal(rich.text, plain.text);
  assert.match(rich.html!, /<h1>Plan<\/h1><p>Book <strong>two<\/strong> nights/);
  assert.match(rich.html!, /<pre><code>const \*x\* = 1;<\/code><\/pre>/);
});

test("plain text of a table uses tabs and newlines", () => {
  assert.equal(replyContent("| A | B |\n|---|---|\n| **1** | 2 |", "plain").text, "A\tB\n1\t2");
});

test("html never carries raw markup from the reply", () => {
  const html = htmlOfReply("<script>alert(1)</script> & **ok**");
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; <strong>ok<\/strong>/);
});

test("table copy: markdown keeps alignment and escapes pipes; TSV and CSV quote what they must", () => {
  const header = ["Name", "Note"];
  const rows = [["Ann", "a | b"], ['Bob "B"', "line\nbreak, comma"]];
  const md = tableContent(header, rows, ["left", "right"], "markdown");
  assert.equal(md.text, "| Name | Note |\n| :--- | ---: |\n| Ann | a \\| b |\n| Bob \"B\" | line break, comma |");
  assert.match(md.html!, /<th style="text-align:left">Name<\/th><th style="text-align:right">Note<\/th>/);
  const csv = tableContent(header, rows, [], "csv");
  assert.equal(csv.text, 'Name,Note\r\nAnn,a | b\r\n"Bob ""B""","line\nbreak, comma"');
  const tsv = tableContent(header, rows, [], "tsv");
  assert.equal(tsv.tabular, tsv.text);
  assert.equal(tsv.text.split("\r\n")[1], "Ann\ta | b");
});

test("table copy pads short rows and cuts long ones to the header width; a trailing backslash cannot escape the closing bar", () => {
  assert.equal(tableContent(["A", "B"], [["1"], ["1", "2", "3"]], [], "csv").text, "A,B\r\n1,\r\n1,2");
  assert.equal(tableContent(["A"], [["x\\"]], [], "markdown").text.split("\n")[2], "| x\\\\ |");
});

test("plainInline keeps the words of links, code and emphasis", () => {
  assert.equal(plainInline("a **b** [c](https://x.co) `d` ~~e~~"), "a b c d e");
});

test("hidden display controls are removed and counted; joiners, variation selectors and flag emoji stay", () => {
  const result = stripHidden("a​b‮c\u0000d﻿e");
  assert.deepEqual(result, { text: "abcde", removed: 4 });
  const keep = "👨‍👩 ❤️ 🏴󠁧󠁢󠁥󠁮󠁧󠁿";
  assert.deepEqual(stripHidden(keep), { text: keep, removed: 0 });
});

test("a reply of 8 lines or 600 characters is quoted whole; longer ones end in an ellipsis", () => {
  assert.equal(collapsed("short"), undefined);
  assert.equal(collapsed(Array.from({ length: 8 }, (_, i) => `l${i}`).join("\n")), undefined);
  assert.equal(collapsed(Array.from({ length: 9 }, (_, i) => `l${i}`).join("\n")), `${Array.from({ length: 8 }, (_, i) => `l${i}`).join("\n")}…`);
  assert.equal(collapsed("x".repeat(601)), `${"x".repeat(600)}…`);
});

test("quoting appends to the draft exactly as typed, with a blank line between", () => {
  assert.equal(quoteAppending("Hello\nthere", ""), "> Hello\n> there\n\n");
  assert.equal(quoteAppending("Hi", "My note"), "My note\n\n> Hi\n\n");
  assert.equal(quoteAppending("Hi", "My note\n"), "My note\n\n> Hi\n\n");
  assert.equal(quoteAppending("Hi", "My note\n\n"), "My note\n\n> Hi\n\n");
  assert.equal(quoteAppending("  \n ", "x"), undefined, "nothing to quote");
  assert.equal(quoteAppending("a​b", ""), "> ab\n\n", "hidden controls are cleaned");
});
