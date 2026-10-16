import { test } from "node:test";
import assert from "node:assert/strict";
import { cutText, redact, summarizeToolInput, summarizeToolResult, toolCallRecorder, type ToolCallEvent } from "./tool-summary.ts";

// B3.1: summaries and redaction of a run's tool calls, before anything is stored.

const AWS = `AKIA${"ABCDEFGHIJKLMNOP"}`;
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\ndef==\n-----END RSA PRIVATE KEY-----";
const fixtures: [string, string][] = [
  ["an sk- key", "use sk-ant-api03-abcdefghijklmnop1234 now"],
  ["a Bearer token", "curl -H 'Authorization: Bearer eyJhbGciOi.payload.sig' x"],
  ["a ghp_ token", "ghp_abcdefghijklmnopqrstuvwx"],
  ["an xoxb token", "xoxb-1234567890-abcdefghij"],
  ["an AWS key id", `id ${AWS} end`],
  ["a PEM block", `key ${PEM} done`],
  ["a password pair", "login password=hunter2 ok"],
  ["a colon secret", "SECRET: s3cr3tvalue here"],
  ["URL userinfo", "https://bob:pa55@example.com/x"],
  ["a token-like query value", "https://example.com/p?code=abcdefghijklmnopqrstuvwxyz0123"],
];

for (const [name, text] of fixtures) {
  test(`redact hides ${name}`, () => {
    const out = redact(text);
    assert.doesNotMatch(out, /abcdefghijklmnop|eyJhbGci|hunter2|s3cr3t|pa55|MIIEabc|1234567890-|ABCDEFGHIJKLMNOP|0123/);
    assert.notEqual(out, text);
  });
}

test("redact keeps ordinary text and is stable when repeated", () => {
  assert.equal(redact("list the files in src"), "list the files in src");
  assert.equal(redact(redact(fixtures[1]![1])), redact(fixtures[1]![1]));
});

test("cutText collapses white space and cuts with an ellipsis, the same way each time", () => {
  assert.equal(cutText("a  b\n c", 10), "a b c");
  const long = "x".repeat(300);
  assert.equal(cutText(long, 160), `${"x".repeat(159)}…`);
  assert.equal(cutText(long, 160), cutText(long, 160));
});

test("input summaries per tool", () => {
  const sum = (tool: string, input: unknown) => summarizeToolInput(tool, input).text;
  assert.equal(sum("Bash", { command: "ls -la\nrm -rf /" }), "ls -la");
  assert.equal(sum("Read", { file_path: "/a/b.ts" }), "/a/b.ts");
  assert.equal(sum("Write", { file_path: "/a/b.ts", content: "SECRET BODY" }), "/a/b.ts");
  assert.equal(sum("Edit", { file_path: "/a/b.ts", old_string: "x", new_string: "y" }), "/a/b.ts");
  assert.equal(sum("Glob", { pattern: "src/**/*.ts" }), "src/**/*.ts");
  assert.equal(sum("WebFetch", { url: "https://u:p@example.com/a/b?token=abc#h" }), "https://example.com/a/b");
  assert.equal(sum("WebSearch", { query: "tcp vs udp" }), "tcp vs udp");
  assert.equal(sum("Agent", { description: "Find reviews", prompt: "long prompt" }), "Find reviews");
  assert.equal(sum("Skill", { skill: "x" }), "");
  assert.equal(sum("Bash", undefined), "");
});

test("browser calls show the action and the site only; typed text is hidden", () => {
  const sum = (tool: string, input: unknown) => summarizeToolInput(tool, input).text;
  assert.equal(sum("mcp__atom-browser__browser_navigate", { url: "https://shop.example.com/cart?id=1" }), "navigate shop.example.com");
  assert.equal(sum("mcp__atom-browser__browser_type", { ref: "e3", text: "my-password" }), "type (text hidden)");
  assert.equal(sum("mcp__atom-browser__browser_fill_form", { fields: [{ value: "x" }] }), "fill_form (text hidden)");
  assert.equal(sum("mcp__atom-browser__browser_click", { ref: "e1" }), "click");
});

test("a read of .env or data/api-token is a hidden secret file", () => {
  for (const [tool, input] of [
    ["Read", { file_path: "/p/.env" }],
    ["Read", { file_path: "/p/.env.local" }],
    ["Read", { file_path: "/z/data/api-token" }],
    ["Bash", { command: "cat .env" }],
  ] as const) {
    assert.deepEqual(summarizeToolInput(tool, input), { text: "(secret file, hidden)", secret: true });
  }
  assert.equal(summarizeToolInput("Read", { file_path: "/p/environment.ts" }).secret, false);
});

test("input and result summaries are redacted before they are cut", () => {
  const text = summarizeToolInput("Bash", { command: `${"x".repeat(140)} sk-abcdefghijklmnopqrstuvwxyz` }).text;
  assert.ok(text.length <= 160);
  assert.doesNotMatch(text, /sk-/);
  assert.ok(summarizeToolResult(`${"y ".repeat(400)}`).length <= 200);
  assert.doesNotMatch(summarizeToolResult("key=abc123"), /abc123/);
});

test("the recorder matches results by tool_use_id, names sub-agents, hides secret-file results, and survives a throwing listener", () => {
  const events: ToolCallEvent[] = [];
  const rec = toolCallRecorder((e) => events.push(e), (p) => (p === "agent1" ? "searcher" : undefined));
  rec.started({ id: "a", name: "Read", input: { file_path: "/p/.env" } });
  rec.started({ id: "b", name: "WebSearch", input: { query: "q" } }, "agent1");
  rec.ended({ tool_use_id: "b", content: [{ type: "text", text: "found" }] }, "agent1");
  rec.ended({ tool_use_id: "a", is_error: true, content: "API_KEY=zzz" });
  assert.deepEqual(
    events.map((e) => [e.id, e.agent, e.state, e.result]),
    [
      ["a", undefined, "started", undefined],
      ["b", "searcher", "started", undefined],
      ["b", "searcher", "ok", "found"],
      ["a", undefined, "error", "(secret file, hidden)"],
    ],
  );
  const bad = toolCallRecorder(() => {
    throw new Error("boom");
  });
  bad.started({ id: "x", name: "Read", input: {} });
  bad.ended({ tool_use_id: "x" });
});

test("a curl -u login is masked", () => {
  assert.equal(redact("curl -u admin:s3cret https://a.b"), "curl -u [hidden] https://a.b");
  assert.equal(redact("curl --user admin:s3cret https://a.b"), "curl --user [hidden] https://a.b");
});

test("the result of a browser typing call is hidden (Playwright echoes the typed text in its code line)", () => {
  const events: ToolCallEvent[] = [];
  const rec = toolCallRecorder((e) => events.push(e));
  rec.started({ id: "a", name: "mcp__atom-browser__browser_type", input: { target: "e7", text: "hunter2-pw" } });
  rec.ended({ tool_use_id: "a", content: "await page.getByRole('textbox').fill('hunter2-pw');" });
  rec.started({ id: "b", name: "mcp__atom-browser__browser_snapshot", input: {} });
  rec.ended({ tool_use_id: "b", content: "- Page URL: https://a.test" });
  assert.ok(!JSON.stringify(events).includes("hunter2"));
  assert.equal(events[1]!.result, "(text hidden)");
  assert.equal(events[3]!.result, "- Page URL: https://a.test");
});

// 2026-10-16 (code check): the URL-userinfo pattern was quadratic on a long dotted run.
test("redact is fast on long dotted and plus-joined runs, and still masks a URL login", () => {
  for (const text of ["a.".repeat(40_000), "a+".repeat(40_000), "a-b.".repeat(20_000), "x".repeat(80_000)]) {
    const t = Date.now();
    redact(text);
    assert.ok(Date.now() - t < 400, `${text.slice(0, 6)}… took ${Date.now() - t} ms`);
  }
  assert.equal(redact("see https://user:pass@example.com/x ok"), "see https://example.com/x ok");
  const t = Date.now();
  summarizeToolResult("a.".repeat(500_000));
  assert.ok(Date.now() - t < 400, "a huge answer is cut before it is read");
});
