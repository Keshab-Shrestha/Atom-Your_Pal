import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMcpInput, openHelperStore } from "./index.ts";

// ADR-090: MCP servers: checked when added, saved off, turned on only after a test, per worker.

test("a server is checked when added and saved switched off, with its secrets kept here", () => {
  const store = openHelperStore({ path: ":memory:" });
  const s = store.addMcpServer({ name: "My Notes", kind: "command", command: "/usr/local/bin/notes-mcp", args: ["--stdio", " "], env: ["NOTES_TOKEN=abc123"] });
  assert.deepEqual([s.name, s.kind, s.args, s.env, s.enabled, s.trusted, s.workers], ["my-notes", "command", ["--stdio"], { NOTES_TOKEN: "abc123" }, false, false, []]);
  const u = store.addMcpServer({ name: "linear", kind: "url", url: "https://mcp.example.com/mcp", headers: ["Authorization: Bearer xyz"] });
  assert.deepEqual([u.transport, u.headers], ["http", { Authorization: "Bearer xyz" }]);
});

test("bad servers are refused in words", () => {
  for (const [input, why] of [
    [{ name: "Bad Name!", kind: "command", command: "x" }, /lower case/],
    [{ name: "zeno", kind: "command", command: "x" }, /ATOM's own/],
    [{ name: "a", kind: "command", command: "" }, /command to run/],
    [{ name: "a", kind: "command", command: "x", env: ["not a pair"] }, /KEY=value/],
    [{ name: "a", kind: "url", url: "ftp://x" }, /https/],
    [{ name: "a", kind: "url", url: "https://x.com/mcp?token=abc" }, /header/],
    [{ name: "a", kind: "url", url: "https://u:p@x.com" }, /header/],
    [{ name: "a", kind: "url", url: "https://x.com", headers: ["no colon"] }, /Name: value/],
  ] as const) {
    assert.throws(() => cleanMcpInput(input as never, []), why, JSON.stringify(input));
  }
  assert.throws(() => cleanMcpInput({ name: "a", kind: "command", command: "x" }, ["a"]), /already/);
});

test("a server turns on only after a test lists its tools; workers must exist", () => {
  const store = openHelperStore({ path: ":memory:" });
  const { id } = store.addMcpServer({ name: "notes", kind: "command", command: "notes-mcp" });
  assert.throws(() => store.setMcpServer(id, { enabled: true }), /Test the server first/);
  store.recordMcpTest(id, { problem: "no answer" });
  assert.throws(() => store.setMcpServer(id, { enabled: true }), /Test the server first/);
  store.recordMcpTest(id, { tools: ["search", "add"] });
  store.setMcpServer(id, { enabled: true, workers: ["sid", "sid"], trusted: true });
  const s = store.mcpServers()[0]!;
  assert.deepEqual([s.enabled, s.trusted, s.workers, s.tools, s.problem], [true, true, ["sid"], ["search", "add"], undefined]);
  assert.throws(() => store.setMcpServer(id, { workers: ["bob"] }), /no worker called "bob"/);
  assert.ok(store.removeMcpServer(id));
  assert.equal(store.mcpServers().length, 0);
});
