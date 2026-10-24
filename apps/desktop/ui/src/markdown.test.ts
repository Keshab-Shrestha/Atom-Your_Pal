import { test } from "node:test";
import assert from "node:assert/strict";
import { isRich, parseBlocks, parseInline, MAX_NESTING, type Block } from "./markdown.ts";

// The first six cases are MarkdownBlocksTests.swift, case for case (the clipboard-HTML case belongs to the later "copy" step).

test("plain sentences stay one paragraph and are not rich", () => {
  assert.deepEqual(parseBlocks("It is sunny.\nTake a hat."), [{ kind: "paragraph", text: "It is sunny.\nTake a hat." }]);
  assert.equal(isRich("It is sunny."), false);
});

test("a table has a header and padded rows", () => {
  const text = "Here it is.\n\n| Name | Age |\n|:--|--:|\n| Ann | 30 |\n| Bob |\n";
  assert.deepEqual(parseBlocks(text), [
    { kind: "paragraph", text: "Here it is." },
    { kind: "table", header: ["Name", "Age"], rows: [["Ann", "30"], ["Bob", ""]], alignment: ["left", "right"] },
  ]);
  assert.equal(isRich(text), true);
});

test("a pipe line without a divider is text", () => {
  assert.deepEqual(parseBlocks("| not | a table |"), [{ kind: "paragraph", text: "| not | a table |" }]);
});

test("lists, headings and code become blocks", () => {
  const text = "# Plan\n- one\n- two\n1. first\n2. second\n```swift\nlet x = 1\n```";
  assert.deepEqual(parseBlocks(text), [
    { kind: "heading", level: 1, text: "Plan" },
    { kind: "list", items: [{ text: "one", children: [] }, { text: "two", children: [] }] },
    { kind: "list", items: [{ text: "first", children: [] }, { text: "second", children: [] }], number: 1 },
    { kind: "code", text: "let x = 1", language: "swift" },
  ]);
});

test("an unfinished code block keeps what has arrived", () => {
  assert.deepEqual(parseBlocks("```\nlet x"), [{ kind: "code", text: "let x" }]);
});

test("a table cell keeps an escaped pipe", () => {
  const [table] = parseBlocks("| a | b |\n|---|---|\n| x \\| y | z |") as Extract<Block, { kind: "table" }>[];
  assert.deepEqual(table!.rows, [["x \\| y", "z"]]);
});

test("nested lists, task items and wrapped lines", () => {
  const text = "- [x] done\n- [ ] todo\n  - child a\n  - child b\n- wrapped\nline two";
  const [list] = parseBlocks(text) as Extract<Block, { kind: "list" }>[];
  assert.deepEqual(list!.items.map((i) => [i.text, i.checked]), [["done", true], ["todo", false], ["wrapped\nline two", undefined]]);
  assert.deepEqual(list!.items[1]!.children, [{ kind: "list", items: [{ text: "child a", children: [] }, { text: "child b", children: [] }] }]);
});

test("a numbered list keeps its first number; a bullet list does not join it", () => {
  const blocks = parseBlocks("3. three\n4. four\n- bullet");
  assert.deepEqual(blocks.map((b) => (b.kind === "list" ? b.number : "x")), [3, undefined]);
});

test("quotes nest, rules split, tilde fences work, CRLF is normalised", () => {
  assert.deepEqual(parseBlocks("> a\n> > b\n\n---\n~~~\ncode\n~~~"), [
    { kind: "quote", children: [{ kind: "paragraph", text: "a" }, { kind: "quote", children: [{ kind: "paragraph", text: "b" }] }] },
    { kind: "rule" },
    { kind: "code", text: "code" },
  ]);
  assert.deepEqual(parseBlocks("a\r\nb"), [{ kind: "paragraph", text: "a\nb" }]);
});

test("a fence's language must look like one", () => {
  assert.deepEqual(parseBlocks("```ts extra\nx\n```"), [{ kind: "code", text: "x", language: "ts" }]);
  assert.deepEqual(parseBlocks("```<script>\nx\n```"), [{ kind: "code", text: "x" }]);
});

test("nesting beyond the limit stays visible as a paragraph, with no content dropped", () => {
  const text = `${"> ".repeat(MAX_NESTING + 3)}deep`;
  let block: Block = parseBlocks(text)[0]!;
  let depth = 0;
  while (block.kind === "quote") {
    block = block.children[0]!;
    depth += 1;
  }
  assert.equal(depth, MAX_NESTING);
  assert.equal(block.kind, "paragraph");
  assert.match((block as { text: string }).text, /deep/);
});

test("a very long unbroken document parses in linear-ish time", () => {
  const started = Date.now();
  parseBlocks("- a\n".repeat(20_000));
  parseBlocks("> ".repeat(5_000) + "x");
  assert.ok(Date.now() - started < 3000, "parsing took too long");
});

// ---------- inline ----------

const text = (s: string) => ({ kind: "text", text: s });

test("inline: code, bold, italic, strike", () => {
  assert.deepEqual(parseInline("a `b *c*` **d** *e* _f_ ~~g~~"), [
    text("a "), { kind: "code", text: "b *c*" }, text(" "), { kind: "strong", children: [text("d")] }, text(" "),
    { kind: "em", children: [text("e")] }, text(" "), { kind: "em", children: [text("f")] }, text(" "), { kind: "del", children: [text("g")] },
  ]);
});

test("inline: unclosed marks, spaced stars and snake_case stay as typed", () => {
  for (const s of ["**not closed", "a * b * c", "snake_case_name", "2 * 3 = 6", "`open", "~~x"]) {
    assert.deepEqual(parseInline(s), [text(s)], s);
  }
});

test("inline: nested emphasis and escapes", () => {
  assert.deepEqual(parseInline("***both***"), [{ kind: "strong", children: [{ kind: "em", children: [text("both")] }] }]);
  assert.deepEqual(parseInline("\\*literal\\*"), [text("*literal*")]);
});

test("inline: only http, https and mailto become links; anything else stays visible text", () => {
  assert.deepEqual(parseInline("[site](https://example.com/a?b=1)"), [{ kind: "link", href: "https://example.com/a?b=1", children: [text("site")] }]);
  assert.deepEqual(parseInline("[mail](mailto:a@b.co)"), [{ kind: "link", href: "mailto:a@b.co", children: [text("mail")] }]);
  for (const bad of ["[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](file:///etc/passwd)", "[x](//evil.example)", "[x]( https://a b )"]) {
    assert.ok(!JSON.stringify(parseInline(bad)).includes('"link"'), bad);
    assert.equal(parseInline(bad).map((n) => (n.kind === "text" ? n.text : "")).join(""), bad);
  }
});

test("inline: HTML in a reply is only ever text", () => {
  const nodes = parseInline('<img src=x onerror=alert(1)> **b**');
  assert.deepEqual(nodes[0], text("<img src=x onerror=alert(1)> "));
});

test("inline: pathological input is bounded", () => {
  const started = Date.now();
  parseInline("*a ".repeat(6000));
  parseInline("[".repeat(15_000));
  parseInline("`".repeat(15_000));
  parseInline("x".repeat(100_000));
  assert.ok(Date.now() - started < 3000, "inline scan took too long");
  assert.deepEqual(parseInline("*".repeat(30_000)).length, 1);
});
