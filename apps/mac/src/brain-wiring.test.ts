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
