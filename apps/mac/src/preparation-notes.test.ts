import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryStore } from "@atom/memory";
import { capturePreparationNotes } from "./preparation-notes.ts";
import { preparationInput } from "./prepared-brief.ts";
import { createBriefRunner } from "./brief.ts";

const at = new Date("2026-10-23T01:00:00Z");
function fixture() {
  const memory = openMemoryStore({ path: ":memory:" });
  const note = memory.brain.save({ title: "Cedar plan", body: "FICTIONAL_NOTE_ONLY: Cedar review Thursday. Prepare a venue checklist." });
  memory.brain.save({ title: "Other note", body: "UNSELECTED_PRIVATE_NOTE" });
  memory.chats.save("private", [{ role: "user", content: "PRIVATE_CHAT_NOT_PREPARATION" }]);
  memory.briefs!.update({ preparation: true, preparationNoteIds: [note.id], events: false, reminders: false, weather: false, tasks: false, needsYou: false, telegram: false, spoken: false, notify: false });
  return { memory, note, briefs: memory.briefs! };
}

test("preparation selections default empty and reject invalid ids without sharing a mutable default", () => {
  const memory = openMemoryStore({ path: ":memory:" });
  try {
    assert.deepEqual(memory.briefs!.settings().preparationNoteIds, []);
    memory.briefs!.settings().preparationNoteIds!.push(77);
    assert.deepEqual(memory.briefs!.settings().preparationNoteIds, []);
    for (const ids of [[0], [-1], [1, 1], Array.from({ length: 13 }, (_, n) => n + 1), [true]]) assert.throws(() => memory.briefs!.update({ preparationNoteIds: ids as number[] }));
    memory.briefs!.update({ preparationNoteIds: [7, 9] });
    assert.deepEqual(memory.briefs!.settings().preparationNoteIds, [7, 9]);
    memory.briefs!.update({ preparationNoteIds: [] });
    assert.deepEqual(memory.briefs!.settings().preparationNoteIds, []);
  } finally { memory.close(); }
});

test("only chosen saved notes enter bounded Unicode-safe preparation and revisions are rechecked", () => {
  const { memory, note } = fixture();
  try {
    memory.brain.save({ id: note.id, title: note.title, body: "日本語 🌲".repeat(600) });
    const selection = capturePreparationNotes(memory, [note.id], at);
    assert.equal(selection.sources.length, 1);
    assert.ok(Buffer.byteLength(selection.sources[0]!.text) < 1500);
    assert.doesNotMatch(selection.sources[0]!.text, /\uFFFD/);
    const task = preparationInput({ parts: [] }, at, selection.sources).task;
    assert.doesNotMatch(task, /UNSELECTED_PRIVATE_NOTE|PRIVATE_CHAT_NOT_PREPARATION/);
    assert.equal(selection.valid(), true);
    memory.brain.save({ id: note.id, title: note.title, body: "Updated saved note" });
    assert.equal(selection.valid(), false);
  } finally { memory.close(); }
});

test("missing or conflicting imported copies are excluded and disconnect invalidates captured context", () => {
  const { memory } = fixture();
  try {
    const folder = { path: "/fictional/notes", identity: "fixture" };
    const file = { path: "cedar.pdf", title: "Imported Cedar", body: "Cedar review Thursday", hash: "one" };
    memory.brainSources!.apply(folder, [file], 0);
    const imported = memory.brain.byTitle("Imported Cedar")!;
    const before = capturePreparationNotes(memory, [imported.id], at); assert.equal(before.sources.length, 1);
    memory.brainSources!.apply(folder, [], 1);
    assert.equal(capturePreparationNotes(memory, [imported.id], at).sources.length, 0); assert.equal(before.valid(), false);
    memory.brainSources!.apply(folder, [file], 0);
    memory.brain.save({ id: imported.id, title: imported.title, body: "Local correction" });
    memory.brainSources!.apply(folder, [{ ...file, body: "New source text", hash: "two" }], 0);
    assert.equal(capturePreparationNotes(memory, [imported.id], at).sources.length, 0);
    memory.brainSources!.disconnect(); assert.equal(before.valid(), false);
  } finally { memory.close(); }
});

test("note-derived lines cannot enter ordinary delivered or spoken brief content", async () => {
  const { memory, note, briefs } = fixture(); let ordinaryCalls = 0, preparations = 0;
  const delivered: string[][] = [];
  try {
    const runner = createBriefRunner({ briefs, sources: { timers: () => ["Cedar timer: 5 minutes"] }, now: () => at,
      preparationSources: (settings, when) => capturePreparationNotes(memory, settings.preparationNoteIds ?? [], when),
      write: async () => { throw new Error("Never use the legacy provider for note preparation"); },
      writePreparationBrief: async (data) => { ordinaryCalls++; assert.doesNotMatch(JSON.stringify(data), /FICTIONAL_NOTE_ONLY|PRIVATE_CHAT|UNSELECTED/); return ["Cedar timer has five minutes left."]; },
      prepare: async (_, __, ___, notes) => { preparations++; assert.match(notes![0]!.text, /FICTIONAL_NOTE_ONLY/); return { lines: ["LEAK_FROM_NOTE_MODEL"], preparation: { status: "ready", cards: [{ title: "Review Cedar", body: "Prepare a venue checklist.", sources: [...notes!] }] } }; },
      canPrepare: () => true, deliver: (brief) => { delivered.push(brief.lines); } });
    const result = await runner.run("manual");
    assert.deepEqual(result.lines, ["Cedar timer has five minutes left."]);
    assert.equal(result.preparation?.cards.length, 1); assert.equal(ordinaryCalls, 1); assert.equal(preparations, 1);
    assert.doesNotMatch(JSON.stringify(delivered), /LEAK_FROM_NOTE_MODEL|FICTIONAL_NOTE_ONLY/);
    assert.deepEqual(briefs.settings().preparationNoteIds, [note.id]);
    assert.equal(memory.chats.messages("private").length, 1);
  } finally { memory.close(); }
});

test("notes-only discovery needs one preparation request and no ordinary request", async () => {
  const { memory, briefs } = fixture(); let ordinary = 0, prepared = 0;
  try {
    const runner = createBriefRunner({ briefs, sources: {}, now: () => at,
      preparationSources: (settings, when) => capturePreparationNotes(memory, settings.preparationNoteIds ?? [], when),
      write: async () => { ordinary++; return ["Unexpected"]; }, canPrepare: () => true,
      prepare: async (_, __, ___, notes) => { prepared++; return { lines: ["PRIVATE_NOTE_LINE"], preparation: { status: "ready", cards: [{ title: "Cedar checklist", body: "Review the venue.", sources: [...notes!] }] } }; } });
    const result = await runner.run("manual");
    assert.equal(ordinary, 0); assert.equal(prepared, 1); assert.equal(result.preparation?.status, "ready");
    assert.doesNotMatch(JSON.stringify(result.lines), /PRIVATE_NOTE/);
  } finally { memory.close(); }
});

test("a changed source discards generated cards while keeping ordinary delivery note-free", async () => {
  const { memory, note, briefs } = fixture();
  try {
    const runner = createBriefRunner({ briefs, sources: { timers: () => ["Cedar timer"] }, now: () => at,
      preparationSources: (settings, when) => capturePreparationNotes(memory, settings.preparationNoteIds ?? [], when),
      write: async () => { throw new Error("Legacy provider forbidden"); }, writePreparationBrief: async () => ["Safe ordinary brief"], canPrepare: () => true,
      prepare: async (_, __, ___, notes) => { memory.brain.save({ id: note.id, title: note.title, body: "Changed during generation" }); return { lines: ["PRIVATE_NOTE_LINE"], preparation: { status: "ready", cards: [{ title: "Stale card", body: "Old note", sources: [...notes!] }] } }; } });
    const result = await runner.run("manual");
    assert.equal(result.preparation?.status, "failed"); assert.deepEqual(result.preparation?.cards, []);
    assert.deepEqual(result.lines, ["Safe ordinary brief"]);
  } finally { memory.close(); }
});

test("paused preparation never reads selected notes", async () => {
  const { memory, briefs } = fixture(); briefs.update({ preparation: false }); let reads = 0;
  try {
    const runner = createBriefRunner({ briefs, sources: { timers: () => ["Cedar timer"] }, now: () => at,
      preparationSources: () => { reads++; throw new Error("Must not read"); },
      write: async () => ["Timer"], canPrepare: () => true });
    await runner.run("manual"); assert.equal(reads, 0);
  } finally { memory.close(); }
});
