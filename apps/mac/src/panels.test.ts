import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPanel, createPanelStore, createPanelTool, describePanel, MAX_BLOCKS } from "./panels.ts";

const blocks = [
  { kind: "stat", label: "Needs you", value: "{{live.needsYou}}", detail: "right now" },
  { kind: "checklist", label: "Reading", items: [{ text: "Dune", done: true }, "Hyperion"] },
  { kind: "counter", label: "Water", count: 3 },
  { kind: "chart", chart: { type: "bar", title: "Week", labels: ["Mon", "Tue"], series: [{ name: "Cups", values: [3, 5] }] } },
  { kind: "button", label: "Plan my day", action: { kind: "ask", prompt: "Plan my day from my calendar" } },
];

test("a panel is checked: blocks, limits, items as text or objects, defaults filled in", () => {
  const p = checkPanel({ name: "Day", home: true, blocks }, new Date("2026-11-02T00:00:00Z"));
  assert.equal(p.enabled, true); assert.equal(p.home, true); assert.equal(p.blocks.length, 5); assert.match(p.id, /^[a-z0-9-]+$/);
  assert.deepEqual(p.blocks[1]!.items, [{ text: "Dune", done: true }, { text: "Hyperion", done: false }]);
  assert.deepEqual([p.blocks[2]!.count, p.blocks[2]!.step], [3, 1]);
  assert.throws(() => checkPanel({ name: "", blocks }), /name is empty/);
  assert.throws(() => checkPanel({ name: "x", blocks: [] }), /1 to 30 blocks/);
  assert.throws(() => checkPanel({ name: "x", blocks: Array(MAX_BLOCKS + 1).fill(blocks[0]) }), /1 to 30 blocks/);
  assert.throws(() => checkPanel({ name: "x", blocks: [{ kind: "iframe" }] }), /one of: text/);
  assert.throws(() => checkPanel({ name: "x", blocks: [{ kind: "text", text: "a".repeat(2001) }] }), /longer than 2000/);
  assert.throws(() => checkPanel({ name: "x", blocks: [{ kind: "checklist", items: Array(51).fill("a") }] }), /at most 50 items/);
  assert.throws(() => checkPanel({ name: "x", blocks: [{ kind: "chart", chart: { type: "pie", labels: ["a", "b"], series: [{ name: "s", values: [1, -2] }] } }] }), /not negative/);
  assert.throws(() => checkPanel({ name: "x", blocks: [{ kind: "chart", chart: { type: "bar", labels: ["a", "a"], series: [{ name: "s", values: [1, 2] }] } }] }), /all different/);
});

test("a button only asks, opens a known page or runs a workflow by a safe id", () => {
  const button = (action: unknown) => checkPanel({ name: "x", blocks: [{ kind: "button", label: "Go", action }] });
  assert.equal(button({ kind: "open", page: "board" }).blocks[0]!.action!.kind, "open");
  assert.equal(button({ kind: "workflow", id: "w1" }).blocks[0]!.action!.kind, "workflow");
  for (const bad of [{ kind: "open", page: "file:///etc/passwd" }, { kind: "workflow", id: "../x" }, { kind: "shell", command: "rm -rf /" }, { kind: "ask", prompt: "" }, null, "ask"]) {
    assert.throws(() => button(bad), /button|prompt|action/, JSON.stringify(bad));
  }
  assert.throws(() => checkPanel({ name: "x", blocks: [{ kind: "button", action: { kind: "open", page: "board" } }] }), /needs a label/);
});

test("the approval card text lists the blocks and what each button does", () => {
  const text = describePanel(checkPanel({ name: "Day", home: true, blocks }));
  assert.match(text, /Blocks: stat "Needs you", checklist "Reading", counter "Water", chart, button "Plan my day"\./);
  assert.match(text, /Buttons: Plan my day → asks "Plan my day from my calendar"\./);
  assert.match(text, /Shown on Home\./);
});

test("the store keeps panels owner-only, replaces by id keeping createdAt, removes, and reads back", () => {
  const dir = mkdtempSync(join(tmpdir(), "ark-panels-"));
  const path = join(dir, "panels.json");
  try {
    const store = createPanelStore(path);
    const [saved] = store.save({ name: "Day", blocks });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    store.save({ ...saved, name: "Renamed", blocks: [{ kind: "text", text: "Hello" }] });
    assert.deepEqual(store.list().map((p) => [p.name, p.blocks.length, p.createdAt === saved!.createdAt]), [["Renamed", 1, true]]);
    assert.equal(createPanelStore(path).list()[0]!.name, "Renamed", "read back from the file");
    for (let i = 0; i < 19; i++) store.save({ name: `P${i}`, blocks: [{ kind: "text", text: "x" }] });
    assert.throws(() => store.save({ name: "one too many", blocks: [{ kind: "text", text: "x" }] }), /at most 20/);
    store.remove(saved!.id);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).panels.length, 19);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("create_panel asks first, saves only after approval, and returns a bad panel's reason to the model", async () => {
  const saved: unknown[] = []; const cards: { summary: string; reason: string }[] = []; let answer = false;
  const tool = createPanelTool({ store: { save: (p) => (saved.push(p), []) }, approve: async (request) => (cards.push(request), answer) });
  assert.match(await tool.run({ name: "Day", blocks }), /did not approve/);
  assert.deepEqual(saved, [], "declined: nothing saved");
  assert.equal(cards[0]!.summary, "Add a panel: Day");
  answer = true;
  assert.match(await tool.run({ name: "Day", home: true, blocks }), /is on the Panels page and on Home/);
  assert.equal(saved.length, 1);
  const bad = await tool.run({ name: "Day", blocks: [{ kind: "button", label: "Go", action: { kind: "shell" } }] });
  assert.match(bad, /not valid: .*button/); assert.equal(cards.length, 2, "an invalid panel never reaches the card");
});
