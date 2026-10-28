import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryStore } from "@atom/memory";
import { createBrainWiring } from "./brain-wiring.ts";

// The second brain in the runtime: memory mirrored into notes, the agent's tools, and the window's view.

const log = { info: () => {}, warn: () => {} };
function setup() {
  const memory = openMemoryStore({ path: ":memory:" });
  const wiring = createBrainWiring({ memory, log });
  const tool = (name: string) => wiring.tools.find((t) => t.spec.name === name)!;
  return { memory, wiring, tool };
}

test("sync mirrors facts and conversation notes, links the names they share, and tells the window", () => {
  const { memory, wiring } = setup();
  memory.add("My sister Mira Haugen lives in Oslo", { source: "voice" });
  memory.saveEpisode("s1", "We planned a trip to see Mira Haugen.", 3);
  let told = 0;
  wiring.island.onChange(() => told++);
  wiring.sync();
  const graph = wiring.island.graph();
  assert.deepEqual(graph.nodes.map((n) => n.kind).sort(), ["entity", "episode", "memory"]);
  assert.equal(graph.edges.length, 2, "both notes link to the entity Mira Haugen");
  assert.equal(told, 1);
  // Forgetting the fact drops its note on the next sync.
  memory.clear();
  wiring.sync();
  assert.deepEqual(wiring.island.graph().nodes.map((n) => n.kind), ["episode"]);
});

test("brain_note writes a linked note; brain_open and brain_search read it back", async () => {
  const { tool, wiring } = setup();
  assert.match(await tool("brain_note").run({ title: "Mesh plan", body: "Use [[Eero]] #home" }), /Saved "Mesh plan" with 1 link\./);
  assert.match(await tool("brain_open").run({ title: "mesh plan" }), /^# Mesh plan \(note\)\nUse \[\[Eero\]\] #home\nLinks to: Eero/);
  assert.match(await tool("brain_open").run({ title: "Eero" }), /There is no note called "Eero"/, "a ghost is not a note");
  assert.match(await tool("brain_search").run({ query: "eero" }), /- Mesh plan \(note\): /);
  assert.equal(await tool("brain_search").run({ query: "zzz" }), "No note matches.");
  await assert.rejects(async () => tool("brain_note").run({ title: " ", body: "x" }), /needs a title/);
  const node = wiring.island.graph().nodes.find((n) => n.title === "Mesh plan")!;
  assert.deepEqual(wiring.island.note(node.id)!.links.map((l) => [l.title, l.ghost]), [["Eero", true]]);
});

test("the window saves, renames and deletes notes", () => {
  const { wiring } = setup();
  const a = wiring.island.save({ title: "A", body: "one" });
  const renamed = wiring.island.save({ id: a.id, title: "A2", body: "[[B]]" });
  assert.equal(renamed.title, "A2");
  assert.deepEqual(renamed.links.map((l) => l.title), ["B"]);
  assert.deepEqual(wiring.island.search("A2").map((h) => h.title), ["A2"]);
  assert.equal(wiring.island.remove(a.id), true);
  assert.equal(wiring.island.remove(a.id), false);
});

// 2026-10-16 (review): brain_note was an upsert by title, so a model call (also one steered by text from a web page or an attached file)
// replaced the whole body of any existing note. The tool now only adds to the end of a note, and cannot touch mirrored notes.
test("brain_note adds to the end of an existing note and says so; it never replaces the user's text", async () => {
  const { wiring, tool } = setup();
  wiring.island.save({ title: "Mortgage plan", body: "Rate 3.1%. Pay on the 25th. #money" });
  const said = await tool("brain_note").run({ title: "mortgage PLAN", body: "Add: ask about overpaying." });
  assert.match(said, /Added to your existing note "Mortgage plan"/);
  const text = await tool("brain_open").run({ title: "Mortgage plan" });
  assert.ok(text.includes("Rate 3.1%. Pay on the 25th."), "the earlier text is kept");
  assert.ok(text.includes("Add: ask about overpaying."), "the new text is added");
  assert.ok(text.indexOf("Rate 3.1%") < text.indexOf("Add: ask"), "at the end");
  // Even a body meant to wipe the note only adds to it.
  await tool("brain_note").run({ title: "Mortgage plan", body: "x" });
  assert.ok((await tool("brain_open").run({ title: "Mortgage plan" })).includes("Rate 3.1%. Pay on the 25th."));
});

test("brain_note cannot change a note that mirrors a memory or a chat summary, and still makes a new note", async () => {
  const { memory, wiring, tool } = setup();
  memory.add("My sister Mira Haugen lives in Oslo", { source: "voice" });
  wiring.sync();
  const mirrored = wiring.island.graph().nodes.find((n) => n.kind === "memory")!;
  const refused = await tool("brain_note").run({ title: mirrored.title, body: "overwritten" });
  assert.match(refused, /mirrors a memory/i);
  assert.ok(!(await tool("brain_open").run({ title: mirrored.title })).includes("overwritten"));
  assert.match(await tool("brain_note").run({ title: "A brand new note", body: "hello [[Mira Haugen]]" }), /Saved "A brand new note"/);
});

// 2026-10-16 (review): day() used the UTC date, so in Japan (UTC+9) a note made at 07:00 on 16 October was titled "2026-10-15".
test("a conversation note is titled with the local date", () => {
  const { memory, wiring } = setup();
  const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const before = local(new Date());
  memory.saveEpisode("s1", "We planned a trip.", 3);
  wiring.sync();
  const after = local(new Date()); // the note was made between the two: across midnight either date is right
  const title = wiring.island.graph().nodes.find((n) => n.kind === "episode")!.title;
  assert.ok(title.includes(before) || title.includes(after), `${title} should name ${before} or ${after}`);
});
