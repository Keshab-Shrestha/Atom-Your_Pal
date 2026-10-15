import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryStore } from "./store.ts";
import { BrainError, linkTitles, namesIn, tagsOf } from "./brain.ts";

// The second brain: notes, [[links]], #tags, ghosts, backlinks, the graph, search, mirrored notes and ATOM's own links.

const open = () => openMemoryStore({ path: ":memory:" }).brain;

test("[[links]] and #tags are read from a body, once each", () => {
  assert.deepEqual(linkTitles("See [[Mesh Wi-Fi]] and [[mesh wi-fi|the kits]] and [[Router#Setup]] but not [[]]."), ["Mesh Wi-Fi", "Router"]);
  assert.deepEqual(tagsOf("A #Plan for #home-network, #plan again. Not a#tag. Also #1"), ["plan", "home-network"]);
});

test("a note with a link makes a ghost for the unwritten title; writing it later fills the ghost and keeps the link", () => {
  const brain = open();
  const a = brain.save({ title: "Home network", body: "Use [[Mesh Wi-Fi]] #home" });
  assert.deepEqual(brain.links(a.id).map((l) => [l.title, l.ghost]), [["Mesh Wi-Fi", true]]);
  assert.equal(brain.count(), 1, "a ghost is not a note");
  const mesh = brain.save({ title: "mesh wi-fi", body: "Eero and Orbi." });
  assert.equal(mesh.ghost, false);
  assert.equal(mesh.title, "mesh wi-fi");
  assert.deepEqual(brain.backlinks(mesh.id).map((b) => b.title), ["Home network"]);
  assert.deepEqual(a.tags, ["home"]);
});

test("saving again changes the links, tags and search; a ghost nobody links to is dropped", () => {
  const brain = open();
  const a = brain.save({ title: "A", body: "[[B]] #xx" });
  brain.save({ title: "A", body: "[[C]] #yy" });
  assert.deepEqual(brain.links(a.id).map((l) => l.title), ["C"]);
  assert.deepEqual(brain.get(a.id)!.tags, ["yy"]);
  assert.equal(brain.byTitle("B"), undefined, "the ghost B is gone");
  assert.deepEqual(brain.search("C").map((h) => h.title), ["A"]);
  assert.deepEqual(brain.search("zzz"), []);
});

test("removing a note others link to leaves a ghost; removing one nobody links to deletes it", () => {
  const brain = open();
  const a = brain.save({ title: "A", body: "[[B]]" });
  const b = brain.save({ title: "B", body: "text" });
  assert.equal(brain.remove(b.id), true);
  assert.equal(brain.byTitle("B")!.ghost, true);
  assert.equal(brain.remove(a.id), true);
  assert.equal(brain.byTitle("B"), undefined, "no one links to the ghost now");
  assert.equal(brain.remove(999), false);
});

test("bad notes are refused with words", () => {
  const brain = open();
  assert.throws(() => brain.save({ title: "  ", body: "x" }), (e) => e instanceof BrainError && /needs a title/.test(e.message));
  assert.throws(() => brain.save({ title: "x".repeat(81), body: "x" }), /at most 80/);
  assert.throws(() => brain.save({ title: "Big", body: "x".repeat(20_001) }), /Split it into linked notes/);
});

test("the graph lists notes and links, with degrees, and drops nothing small", () => {
  const brain = open();
  brain.save({ title: "A", body: "[[B]] [[C]]" });
  brain.save({ title: "B", body: "[[C]]" });
  const g = brain.graph();
  assert.deepEqual(g.nodes.map((n) => [n.title, n.degree]).sort(), [["A", 2], ["B", 2], ["C", 2]]);
  assert.equal(g.edges.length, 3);
  assert.equal(g.omitted, 0);
  assert.equal(g.nodes.find((n) => n.title === "C")!.ghost, true);
});

test("sync mirrors memory into notes: adds, updates, drops, and keeps unique titles", () => {
  const brain = open();
  const items = [
    { ref: "memory:1", title: "Mira is my sister", body: "Mira is my sister", kind: "memory" as const },
    { ref: "memory:2", title: "Mira is my sister", body: "Mira lives in Oslo", kind: "memory" as const },
  ];
  assert.deepEqual(brain.sync(items, ["memory:"]), { added: 2, updated: 0, removed: 0 });
  assert.deepEqual(brain.graph().nodes.map((n) => n.title).sort(), ["Mira is my sister", "Mira is my sister (2)"]);
  assert.deepEqual(brain.sync(items, ["memory:"]), { added: 0, updated: 0, removed: 0 }, "nothing changed");
  assert.deepEqual(brain.sync([{ ...items[0]!, body: "Mira is my sister, older" }], ["memory:"]), { added: 0, updated: 1, removed: 1 });
  assert.equal(brain.count(), 1);
  // A note Keshab wrote is not touched by a sync of other prefixes.
  brain.save({ title: "Mine", body: "mine" });
  brain.sync([], ["memory:"]);
  assert.equal(brain.byTitle("Mine")!.body, "mine");
});

test("autolink: a note that names another note's title links to it, and a name two notes share becomes an entity", () => {
  const brain = open();
  brain.save({ title: "Oslo trip", body: "Plan the flights." });
  brain.sync(
    [
      { ref: "memory:1", title: "Sister", body: "My sister Mira Haugen lives near the Oslo trip route.", kind: "memory" },
      { ref: "episode:1", title: "Chat note", body: "We talked. Mira Haugen asked about flights.", kind: "episode" },
    ],
    ["memory:", "episode:"],
  );
  assert.ok(brain.autolink() >= 3);
  const trip = brain.byTitle("Oslo trip")!;
  assert.deepEqual(brain.backlinks(trip.id).map((b) => [b.title, b.auto]), [["Sister", true]]);
  const mira = brain.byTitle("Mira Haugen")!;
  assert.equal(mira.kind, "entity");
  assert.deepEqual(brain.backlinks(mira.id).map((b) => b.title).sort(), ["Chat note", "Sister"]);
  // Running it again gives the same graph (ATOM's links are rebuilt, not piled up).
  const edges = brain.graph().edges.length;
  brain.autolink();
  assert.equal(brain.graph().edges.length, edges);
});

test("names: capitalised words that do not open a sentence, joined when they stand together", () => {
  assert.deepEqual(namesIn("Monday I met Mira Haugen in Oslo. The plan is good."), ["Mira Haugen", "Oslo"]);
  assert.deepEqual(namesIn("Eero is fast. Then Eero beats Orbi."), ["Eero", "Orbi"]);
  assert.deepEqual(namesIn("Eero is fast."), [], "a lone capitalised word that opens a sentence is just a sentence start");
});

test("saving by id renames a note, keeps its links in, refuses a title another note has, and merges into a ghost", () => {
  const brain = open();
  const a = brain.save({ title: "A", body: "text" });
  const b = brain.save({ title: "B", body: "[[Old name]]" });
  assert.throws(() => brain.save({ id: a.id, title: "b", body: "x" }), /Another note is called "B"/);
  assert.throws(() => brain.save({ id: 999, title: "Z", body: "x" }), /That note is gone/);
  const renamed = brain.save({ id: a.id, title: "Old name", body: "text" });
  assert.equal(renamed.id, a.id);
  assert.deepEqual(brain.backlinks(a.id).map((x) => x.title), ["B"], "the ghost's links now point to the renamed note");
  assert.equal(brain.count(), 2);
  void b;
});

// 2026-10-16 (review): renaming a mirrored note to a title that a ghost already holds broke the unique-title rule inside the sync transaction;
// the whole sync rolled back on every run and the mirror stayed stuck.
test("a mirrored note renamed to a title a ghost holds gets its own title instead of failing the sync", () => {
  const brain = open();
  brain.save({ title: "Plans", body: "See [[Project Foo]]" }); // makes the ghost "Project Foo"
  assert.deepEqual(brain.sync([{ ref: "memory:1", kind: "memory", title: "Project Bar", body: "bar" }], ["memory:"]), { added: 1, updated: 0, removed: 0 });
  // The project is renamed: the same ref now carries the title the ghost has.
  const result = brain.sync([{ ref: "memory:1", kind: "memory", title: "Project Foo", body: "bar renamed" }], ["memory:"]);
  assert.deepEqual(result, { added: 0, updated: 1, removed: 0 }, "the sync went through");
  assert.equal(brain.sync([{ ref: "memory:1", kind: "memory", title: "Project Foo", body: "bar renamed" }], ["memory:"]).updated, 0, "and it is stable");
});

test("a ghost still becomes a new mirrored note with its title, and the links to it stay", () => {
  const brain = open();
  const plans = brain.save({ title: "Plans", body: "See [[Project Foo]]" });
  assert.deepEqual(brain.sync([{ ref: "memory:2", kind: "memory", title: "Project Foo", body: "now written" }], ["memory:"]), { added: 1, updated: 0, removed: 0 });
  assert.deepEqual(brain.links(plans.id).map((l) => [l.title, l.ghost]), [["Project Foo", false]]);
});
