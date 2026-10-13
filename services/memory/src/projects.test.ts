import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CHAT_TITLE_LENGTH, MAX_CHATS, MAX_PROJECT_CHATS, MAX_PROJECTS, cleanChatTitle, openMemoryStore, ProjectError } from "./index.ts";

// ADR-107: projects (a named folder and its chats) and the chat's project link.

const turns = (text: string) => [{ role: "user" as const, content: text }, { role: "assistant" as const, content: "ok" }];

test("a project has a unique name (case-insensitive), one line, 1 to 60 characters", () => {
  const { projects } = openMemoryStore({ path: ":memory:" });
  const p = projects.add({ name: "  Haat  ", folder: "/Users/k/Developer/haat" });
  assert.equal(p.name, "Haat");
  assert.equal(p.kit, "folders");
  assert.equal(p.web, false, "web is off by default");
  assert.deepEqual(p.folders, ["/Users/k/Developer/haat"]);
  assert.throws(() => projects.add({ name: "HAAT", folder: "/Users/k/x" }), ProjectError);
  assert.throws(() => projects.add({ name: "   ", folder: "/x" }), /name/i);
  assert.throws(() => projects.add({ name: "a\nb", folder: "/x" }), /one line/i);
  assert.throws(() => projects.add({ name: "x".repeat(61), folder: "/x" }), /60/);
  projects.add({ name: "x".repeat(60), folder: "/x" });
  assert.throws(() => projects.rename(p.id, "x".repeat(60)), ProjectError, "rename keeps names unique");
  assert.equal(projects.rename(p.id, "haat"), true, "the same name in another case is the same project");
  assert.equal(projects.get(p.id)!.name, "haat");
});

test("at most 20 projects are open; archived ones do not count", () => {
  const { projects } = openMemoryStore({ path: ":memory:" });
  const ids = Array.from({ length: MAX_PROJECTS }, (_, i) => projects.add({ name: `P${String.fromCharCode(97 + i)}`, folder: `/f/${i}` }).id);
  assert.throws(() => projects.add({ name: "Extra", folder: "/f/x" }), /20/);
  projects.archive(ids[0]!, true);
  const extra = projects.add({ name: "Extra", folder: "/f/x" });
  assert.throws(() => projects.archive(ids[0]!, false), /20/, "opening an archived project needs a free place");
  projects.archive(extra.id, true);
  assert.equal(projects.archive(ids[0]!, false), true);
  assert.equal(projects.list().length, MAX_PROJECTS + 1);
});

test("a project's model, web switch and agent are kept; an empty model clears it", () => {
  const { projects } = openMemoryStore({ path: ":memory:" });
  const p = projects.add({ name: "A", folder: "/a" });
  projects.setModel(p.id, { provider: "claude-plan", model: "opus" });
  projects.setWeb(p.id, true);
  projects.setHelper(p.id, "a-coder");
  assert.deepEqual(projects.get(p.id), { ...p, provider: "claude-plan", model: "opus", web: true, helper: "a-coder", updatedAt: projects.get(p.id)!.updatedAt });
  projects.setModel(p.id, undefined);
  assert.equal(projects.get(p.id)!.provider, undefined);
  assert.equal(projects.setWeb("nope", true), false);
});

test("a chat has a project; list filters by it; setProject needs a saved chat", () => {
  const { chats, projects } = openMemoryStore({ path: ":memory:" });
  const p = projects.add({ name: "A", folder: "/a" });
  chats.save("plain", turns("hello"));
  chats.save("inside", turns("in project"));
  assert.equal(chats.setProject("inside", p.id), true);
  assert.equal(chats.setProject("unsaved", p.id), false);
  assert.equal(chats.project("inside"), p.id);
  assert.equal(chats.project("plain"), undefined);
  assert.deepEqual(chats.list({ projectId: p.id }).map((c) => c.id), ["inside"]);
  assert.deepEqual(chats.list().map((c) => [c.id, c.projectId]), [["inside", p.id], ["plain", undefined]], "the plain list keeps project chats, with their project");
  chats.save("inside", turns("again"));
  assert.equal(chats.project("inside"), p.id, "saving again keeps the project");
  assert.equal(projects.chatCount(p.id), 1);
});

test("the 200-chat prune never removes a project chat; a project keeps its newest 500", () => {
  let n = 0;
  const store = openMemoryStore({ path: ":memory:", now: () => new Date(Date.UTC(2026, 0, 1) + ++n * 1000) });
  const p = store.projects.add({ name: "A", folder: "/a" });
  store.chats.save("old-project-chat", turns("keep me"));
  store.chats.setProject("old-project-chat", p.id);
  for (let i = 0; i < MAX_CHATS + 5; i++) store.chats.save(`c${i}`, turns(`chat ${i}`));
  assert.equal(store.chats.messages("old-project-chat").length, 2, "the oldest chat is a project chat, so it stays");
  assert.equal(store.chats.list(1000).filter((c) => !c.projectId).length, MAX_CHATS);
  assert.equal(store.chats.messages("c0").length, 0, "plain chats still go, oldest first");
  assert.equal(MAX_PROJECT_CHATS, 500);
  for (let i = 0; i < MAX_PROJECT_CHATS + 3; i++) {
    store.chats.save(`p${i}`, turns(`p ${i}`));
    store.chats.setProject(`p${i}`, p.id);
  }
  store.chats.save("p-last", turns("last"));
  store.chats.setProject("p-last", p.id);
  store.chats.save("p-last", turns("last again"));
  assert.equal(store.projects.chatCount(p.id), MAX_PROJECT_CHATS);
  assert.equal(store.chats.messages("old-project-chat").length, 0, "oldest first");
  assert.equal(store.chats.messages("p-last").length, 2);
});

test("removing a project keeps its chats as plain chats, or deletes them when asked", () => {
  const { chats, projects } = openMemoryStore({ path: ":memory:" });
  const a = projects.add({ name: "A", folder: "/a" });
  const b = projects.add({ name: "B", folder: "/b" });
  for (const [id, p] of [["a1", a], ["b1", b]] as const) {
    chats.save(id, turns(id));
    chats.setProject(id, p.id);
  }
  assert.equal(projects.remove(a.id, { deleteChats: false }), true);
  assert.equal(chats.project("a1"), undefined);
  assert.equal(chats.messages("a1").length, 2);
  assert.equal(projects.remove(b.id, { deleteChats: true }), true);
  assert.equal(chats.messages("b1").length, 0);
  assert.equal(projects.remove(b.id, { deleteChats: true }), false);
  assert.deepEqual(chats.search("b1"), []);
});

test("a file made before projects is migrated: chats keep their rows and gain a project column", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-mem-"));
  const path = join(dir, "memory.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, provider TEXT, model TEXT, session TEXT);
    CREATE TABLE chat_messages (chat_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (chat_id, seq));
    INSERT INTO chats VALUES ('old', 'Old chat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, NULL, NULL);
    INSERT INTO chat_messages VALUES ('old', 0, 'user', 'hi');
  `);
  db.close();
  const store = openMemoryStore({ path });
  assert.deepEqual(store.chats.list().map((c) => [c.id, c.projectId]), [["old", undefined]]);
  const p = store.projects.add({ name: "A", folder: "/a" });
  assert.equal(store.chats.setProject("old", p.id), true);
  store.close();
  const again = openMemoryStore({ path }); // opening twice is safe
  assert.equal(again.chats.project("old"), p.id);
  assert.equal(again.projects.get(p.id)!.name, "A");
  again.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a chat can be renamed; the name stays when the chat is saved again; a title is one line, 1 to 60 characters", () => {
  const { chats } = openMemoryStore({ path: ":memory:" });
  chats.save("a", turns("first words"));
  assert.equal(chats.list()[0]!.title, "first words");
  assert.equal(chats.rename("a", "  Plan for Tokyo  "), true);
  chats.save("a", [...turns("first words"), ...turns("more")]);
  assert.equal(chats.list()[0]!.title, "Plan for Tokyo");
  assert.equal(chats.rename("nope", "x"), false, "a chat that is not saved yet");
  assert.throws(() => chats.rename("a", "   "), ProjectError);
  assert.throws(() => chats.rename("a", "one\ntwo"), /one line/);
  assert.throws(() => chats.rename("a", "x".repeat(CHAT_TITLE_LENGTH + 1)), /60/);
  assert.equal(cleanChatTitle(" ok "), "ok");
  chats.save("b", turns("untouched"));
  assert.equal(chats.list().find((c) => c.id === "b")!.title, "untouched", "other chats still take their first words");
});

test("an old file without the name flag is migrated", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-mem-"));
  const path = join(dir, "memory.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, provider TEXT, model TEXT, session TEXT, project_id TEXT);
    CREATE TABLE chat_messages (chat_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (chat_id, seq));
    INSERT INTO chats VALUES ('old', 'Old chat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, NULL, NULL, NULL);
    INSERT INTO chat_messages VALUES ('old', 0, 'user', 'hi');
  `);
  db.close();
  const store = openMemoryStore({ path });
  assert.equal(store.chats.rename("old", "Renamed"), true);
  assert.equal(store.chats.list()[0]!.title, "Renamed");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
