import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { openMemoryStore } from "./store.ts";
import { continuityHash, continuityItems } from "./chat-continuity.ts";
import { analysisHash, defaultAnalysisSettings } from "./source-analysis.ts";
import { checkedBriefPreparation } from "./brief-preparation.ts";

const file = (path = "cedar.md", body = "  # Cedar\n\nLaunch Wednesday. [[Birch]] #launch\n\n") => ({ path, title: "Cedar", body, hash: createHash("sha256").update(body).digest("hex") });
const folder = { path: "/fictional/notes", identity: "1:2" };
const profile = { provider: "codex", model: "fictional-local-test", effort: "low" };

test("source publication is atomic and preserves authored notes, ghost links and whitespace", () => {
  const m = openMemoryStore({ path: ":memory:" });
  try {
    const authored = m.brain.save({ title: "Cedar", body: "Authored original [[Birch]]" });
    const f = file(); m.brainSources!.apply(folder, [f], 0);
    const imported = m.brain.get(m.brainSources!.ids!()[0]!)!;
    assert.equal(imported.title, "Cedar (2)"); assert.equal(imported.body, f.body);
    assert.equal(m.brain.get(authored.id)!.body, authored.body);
    assert.equal(m.brain.byTitle("Birch")!.ghost, true);
    assert.equal(m.brain.search("Wednesday")[0]!.id, imported.id);
    const before = m.brainSources!.summary();
    assert.throws(() => m.brainSources!.apply(folder, [file("second.md", "First change"), { ...file("bad.md"), title: "" }], 0));
    assert.deepEqual(m.brainSources!.summary(), before);
    assert.equal(m.brainSources!.ids!().length, 1);
    assert.equal(m.brain.get(imported.id)!.body, f.body);
  } finally { m.close(); }
});

test("source corrections, conflicts, explicit restore, missing copies and exclusions survive refresh", () => {
  const m = openMemoryStore({ path: ":memory:" });
  try {
    const s = m.brainSources!; s.apply(folder, [file()], 0);
    const id = s.ids!()[0]!;
    s.apply(folder, [file()], 0); assert.equal(s.ids!()[0], id);
    m.brain.save({ id, title: "My correction", body: "Actually Thursday." });
    assert.equal(s.note(id)!.state, "corrected");
    s.apply(folder, [file("cedar.md", "Now Friday")], 0);
    assert.equal(s.note(id)!.state, "conflict"); assert.equal(m.brain.get(id)!.body, "Actually Thursday.");
    s.apply(folder, [], 0); assert.equal(s.note(id)!.state, "missing");
    assert.throws(() => s.apply(folder, [], 0, id), /missing/);
    s.apply(folder, [file("cedar.md", "Now Friday")], 0, id);
    assert.equal(m.brain.get(id)!.body, "Now Friday"); assert.equal(s.note(id)!.state, "current");
    assert.throws(() => s.apply({ ...folder, identity: "other" }, [], 0), /changed/);
    assert.equal(s.exclude(id), true); s.apply(folder, [file()], 0);
    assert.equal(s.summary().notes, 0); assert.equal(s.summary().excluded, 1);
  } finally { m.close(); }
});

test("additive stores reopen without altering history, briefs, Full access or exact-file grants", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-adaptation-store-")), path = join(dir, "memory.db");
  let m = openMemoryStore({ path });
  try {
    const turns = [{ role: "user" as const, content: "Cedar launches 水曜日 🌲" }, { role: "assistant" as const, content: "Saved claim; not proof." }];
    m.chats.save("cedar", turns); m.chats.setAccess("cedar", "full");
    m.filePermissions.forChat("cedar").grant("/fictional/one.md");
    m.brainSources!.apply(folder, [file()], 0); const note = m.brainSources!.ids!()[0]!;
    m.briefs.update({ preparation: true, preparationDailyLimit: 2 });
    const day = new Date().toISOString().slice(0, 10);
    assert.equal(m.briefs.reservePreparation!(day), true);
    assert.equal(m.sourceAnalysis!.reserve(day, 2), true);
    const summary = { through: 2, hash: continuityHash(turns, 2), items: [{ text: "The user requested a Wednesday launch.", refs: [1] }], ...profile, updatedAt: new Date().toISOString() };
    assert.equal(m.chatContinuity!.publish("cedar", summary, 0), true);
    m.close(); m = openMemoryStore({ path });
    assert.deepEqual(m.chats.messages("cedar"), turns);
    assert.equal(m.chats.access("cedar"), "full");
    assert.deepEqual(m.filePermissions.forChat("cedar").list(), ["/fictional/one.md"]);
    assert.equal(m.filePermissions.forChat("other").has("/fictional/one.md"), false);
    assert.equal(m.chatContinuity!.get("cedar").summary!.items[0]!.refs[0], 1);
    assert.equal(m.briefs.preparationBudget!(day).used, 1); assert.equal(m.sourceAnalysis!.budget(day), 1);
    assert.equal(m.brainSources!.note(note)!.state, "current");
    m.brainSources!.disconnect(); assert.equal(m.chatContinuity!.get("cedar").summary!.through, 2);
    assert.deepEqual(m.chats.messages("cedar"), turns);
    m.filePermissions.forChat("cedar").revokeAll();
    assert.equal(m.filePermissions.forChat("cedar").has("/fictional/one.md"), false);
  } finally { m.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("continuity rejects stale prefixes/versions, pauses idempotently and disappears with its chat", () => {
  const m = openMemoryStore({ path: ":memory:" });
  try {
    const turns = [{ role: "user" as const, content: "A\n水🌲" }, { role: "assistant" as const, content: "B" }];
    m.chats.save("one", turns); const s = m.chatContinuity!;
    const summary = { through: 1, hash: continuityHash(turns, 1), items: [{ text: "A", refs: [1] }], ...profile, updatedAt: new Date().toISOString() };
    assert.equal(s.publish("one", summary, 0), true);
    assert.equal(s.publish("one", { ...summary, through: 2, hash: continuityHash(turns, 2) }, 0), false);
    assert.equal(s.get("other").summary, undefined);
    assert.ok(s.get("one", [...turns, { role: "user", content: "append" }]).summary);
    assert.equal(s.get("one", [{ ...turns[0]!, content: "changed" }]).stale, true);
    assert.equal(s.configure("one", false, 1), true); assert.equal(s.configure("one", false, 1), true);
    assert.equal(s.get("one").summary, undefined); assert.equal(s.get("one").version, 2);
    assert.equal(s.publish("one", summary, 2), false);
    assert.deepEqual(m.chats.messages("one"), turns);
    m.chats.remove("one"); assert.equal(s.configure("one", true, 2), false);
    assert.equal(s.get("one").version, 0);
    for (const bad of [[{ text: "x", refs: [3] }], [{ text: "x", refs: [] }], [{ text: "x\u202E", refs: [1] }], [{ text: "x", refs: [1], permission: true }]])
      assert.throws(() => continuityItems(bad, 2));
  } finally { m.close(); }
});

test("source analysis atomically validates note hashes, checkpoints, cache profiles and Clear versions", () => {
  const m = openMemoryStore({ path: ":memory:" });
  try {
    m.brainSources!.apply(folder, [file()], 0);
    const source = m.brainSources!.folder!()!.id, note = m.brain.get(m.brainSources!.ids!()[0]!)!, s = m.sourceAnalysis!;
    const at = new Date().toISOString(), hash = analysisHash(note.title, note.body, "current");
    const initial = { source, version: 0, settings: defaultAnalysisSettings(at) };
    const record = s.put(initial);
    const part = { source, note: note.id, hash, offset: 0, end: note.body.length, title: note.title, checkedAt: at, text: "Wednesday launch, per source.", createdAt: at, profile };
    assert.throws(() => s.put(record, { ...part, hash: "0".repeat(64) }), /changed/);
    assert.equal(s.read()!.version, record.version); assert.equal(s.parts(source).rows.length, 0);
    const saved = s.put(record, part);
    assert.equal(s.cached(source, note.id, hash, 0, profile)!.text, part.text);
    assert.equal(s.cached(source, note.id, hash, 0, { ...profile, effort: "high" }), undefined);
    assert.throws(() => s.put(record, part), /changed/);
    m.brain.save({ id: note.id, title: note.title, body: "Correction" });
    assert.equal(s.parts(source).rows.length, 0);
    const day = at.slice(0, 10); assert.equal(s.reserve(day, 1), true); assert.equal(s.reserve(day, 1), false);
    s.clear(source); assert.ok(s.read()!.version > saved.version); assert.equal(s.budget(day), 1);
    assert.throws(() => s.put(initial), /changed/);
    m.brainSources!.disconnect(); assert.equal(s.read(), undefined);
  } finally { m.close(); }
});

test("legacy brief schema migrates and corrupt derived data cannot hide an original brief", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-brief-migration-")), path = join(dir, "memory.db");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE briefs(id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, created_at TEXT NOT NULL, lines TEXT NOT NULL, source TEXT NOT NULL)");
  db.prepare("INSERT INTO briefs(day,created_at,lines,source) VALUES(?,?,?,?)").run("2026-10-22", new Date().toISOString(), '["Original brief"]', "template"); db.close();
  const m = openMemoryStore({ path });
  try {
    assert.equal(m.briefs.latest()!.lines[0], "Original brief"); assert.equal(m.briefs.settings().preparation, false);
    m.briefs.update({ preparation: true }); const day = new Date().toISOString().slice(0, 10);
    assert.equal(m.briefs.reservePreparation!(day), true); assert.equal(m.briefs.reservePreparation!(day), true); assert.equal(m.briefs.reservePreparation!(day), false);
    m.briefs.update({ preparation: false }); m.briefs.update({ preparation: true }); assert.equal(m.briefs.reservePreparation!(day), false);
    for (const limit of [0, 1.5, 6]) assert.throws(() => m.briefs.update({ preparationDailyLimit: limit }));
    const edit = new DatabaseSync(path); edit.exec("UPDATE briefs SET preparation = '{bad'"); edit.close();
    assert.equal(m.briefs.latest()!.preparation!.status, "failed"); assert.equal(m.briefs.latest()!.lines[0], "Original brief");
    assert.throws(() => checkedBriefPreparation({ status: "ready", cards: [] }));
  } finally { m.close(); rmSync(dir, { recursive: true, force: true }); }
});
