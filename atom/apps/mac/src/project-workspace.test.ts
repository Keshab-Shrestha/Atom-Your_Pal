import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { createProjectWorkspace, type WorkspaceRequest } from "./project-workspace.ts";
import { parseCommand } from "./island-protocol.ts";

function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-workspace-")));
  const root = join(home, "プロジェクト🌲"); mkdirSync(root);
  const storePath = join(home, "helpers.db"), cp = join(home, "copies");
  let store = openHelperStore({ path: storePath, home, checkpointsDir: cp });
  let available = true;
  const host = () => createProjectWorkspace({ home, helpers: store, project: (id) => id === "p" && available ? { folder: root, archived: false } : undefined });
  const run = (action: WorkspaceRequest["action"], path = "", job?: number, token?: string) => host().handle({ type: "workspace", request: randomUUID(), chat: "c", project: "p", action, path, ...(job ? { job } : {}), ...(token ? { token } : {}) });
  const edit = (name: string, text: string) => writeFileSync(join(root, name), text);
  return { home, root, get store() { return store; }, run, edit, revoke: () => { available = false; },
    reopen: () => { store.close(); store = openHelperStore({ path: storePath, home, checkpointsDir: cp }); },
    close: () => { store.close(); rmSync(home, { recursive: true, force: true }); } };
}

test("workspace browses one folder, previews literal UTF-8 and isolates protected/link/generated paths", () => {
  const f = fixture();
  try {
    f.edit("readme.md", "# Fictional project\n日本語");
    f.edit("id_ed25519", "fictional private key"); f.edit(".env", "fictional secret"); f.edit("key.pem", "fictional private key");
    f.edit("large.txt", "a".repeat(32 * 1024 + 1)); f.edit("binary.txt", "a\0b"); f.edit("hidden.txt", "a\u202eb");
    f.edit("invalid.txt", "x"); writeFileSync(join(f.root, "invalid.txt"), Buffer.from([0xff]));
    mkdirSync(join(f.root, "src")); f.edit("src/main.ts", "export const answer = 42;\n");
    mkdirSync(join(f.root, "node_modules")); f.edit("node_modules/index.js", "excluded");
    symlinkSync(join(f.root, "src"), join(f.root, "linked"));
    const outside = join(f.home, "outside.txt"); writeFileSync(outside, "outside");
    symlinkSync(outside, join(f.root, "escape.txt")); linkSync(outside, join(f.root, "hardlink.txt"));
    const list = f.run("list"); assert.equal(list.ok, true);
    assert.deepEqual(list.entries?.map((e) => e.name), ["src", "binary.txt", "hidden.txt", "invalid.txt", "large.txt", "readme.md"]);
    assert.equal(f.run("read", "readme.md").text, "# Fictional project\n日本語");
    assert.equal(f.run("list", "src").entries?.[0]?.path, "src/main.ts");
    for (const path of ["../outside.txt", outside, ".env", "id_ed25519", "key.pem", "escape.txt", "hardlink.txt", "linked/main.ts", "node_modules/index.js", "src/../readme.md", "src//main.ts", "src\\main.ts", "$(whoami)", "binary.txt", "hidden.txt", "invalid.txt", "large.txt"]) {
      const response = f.run("read", path);
      assert.equal(response.ok, false, path); assert.equal(response.text, undefined, path);
    }
    f.revoke(); assert.equal(f.run("read", "readme.md").ok, false);
  } finally { f.close(); }
});

test("workspace directory limits are explicit and do not load descendants", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 301; i++) f.edit(`file-${i}.txt`, "x");
    const result = f.run("list");
    assert.equal(result.ok, true); assert.equal(result.entries?.length, 300); assert.equal(result.limited, true);
  } finally { f.close(); }
});

test("workspace exact checkpoint provenance and confirmed Undo survive a store reopen", () => {
  const f = fixture();
  try {
    const a = join(f.root, "note.txt"); f.edit("note.txt", "Original fictional note\n");
    const { id } = f.store.addJob("kame", "Rewrite the fictional note");
    f.store.checkpoint(id, [f.root], a); f.edit("note.txt", "Rewritten fictional note\n"); f.store.finishCheckpoints(id); f.store.stop(id);
    f.reopen();
    const changes = f.run("changes");
    assert.equal(changes.changes?.length, 1); assert.equal(changes.changes?.[0]?.job, id);
    assert.equal(changes.changes?.[0]?.task, "Rewrite the fictional note"); assert.equal(changes.changes?.[0]?.absolute, a);
    const review = f.run("review", "note.txt", id);
    assert.equal(review.review?.before, "Original fictional note\n"); assert.equal(review.review?.after, "Rewritten fictional note\n"); assert.ok(review.review?.token);
    assert.equal(f.run("undo", "note.txt", id, review.review!.token).ok, true);
    assert.equal(readFileSync(a, "utf8"), "Original fictional note\n");
    assert.equal(f.run("changes").changes?.[0]?.state, "undone");
    assert.equal(f.run("undo", "note.txt", id, review.review!.token).ok, false);
  } finally { f.close(); }
});

test("workspace Undo refuses later edits, wrong task/path/root, and active jobs", () => {
  const f = fixture();
  try {
    const path = join(f.root, "note.txt"); f.edit("note.txt", "original");
    const { id } = f.store.addJob("kame", "Fixture edit");
    f.store.checkpoint(id, [f.root], path); f.edit("note.txt", "output"); f.store.finishCheckpoints(id); f.store.stop(id);
    const token = f.run("review", "note.txt", id).review!.token!;
    f.edit("note.txt", "later human edit");
    assert.equal(f.run("undo", "note.txt", id, token).ok, false);
    assert.equal(readFileSync(path, "utf8"), "later human edit");
    assert.equal(f.run("review", "note.txt", id).review?.token, undefined);
    assert.equal(f.run("review", "note.txt", id + 1).ok, false);
    f.edit("other.txt", "unrelated"); assert.equal(f.run("review", "other.txt", id).ok, false);
    f.edit("note.txt", "output");
    const active = f.store.addJob("kame", "Active fixture").id; f.store.start(active);
    f.store.checkpoint(active, [f.root], path); f.edit("note.txt", "live output");
    assert.equal(f.run("review", "note.txt", active).review?.token, undefined);
    assert.equal(f.run("undo", "note.txt", active, token).ok, false);
    f.store.stop(active); f.revoke(); assert.equal(f.run("undo", "note.txt", id, token).ok, false);
  } finally { f.close(); }
});

test("workspace Undo of a created file removes only the reviewed exact checkpoint, even with duplicate relative names", () => {
  const f = fixture();
  try {
    const other = join(f.home, "other"); mkdirSync(other);
    const { id } = f.store.addJob("kame", "Create two fixture files");
    f.store.checkpoint(id, [f.root], join(f.root, "note.txt")); f.store.checkpoint(id, [other], join(other, "note.txt"));
    f.edit("note.txt", "project output"); writeFileSync(join(other, "note.txt"), "other output"); f.store.finishCheckpoints(id); f.store.stop(id);
    const token = f.run("review", "note.txt", id).review!.token!;
    assert.equal(f.run("undo", "note.txt", id, token).ok, true);
    assert.equal(existsSync(join(f.root, "note.txt")), false);
    assert.equal(readFileSync(join(other, "note.txt"), "utf8"), "other output");
    assert.equal(f.run("changes").changes?.length, 1, "metadata retains removed file so the completed Undo stays visible");
  } finally { f.close(); }
});

test("workspace transport validates identifiers, actions, review task and Undo token", () => {
  const base = { type: "workspace", request: randomUUID(), chat: "c", project: "p", action: "list", path: "" };
  assert.deepEqual(parseCommand(JSON.stringify(base)), { command: base });
  for (const change of [{ request: "x" }, { chat: "" }, { project: "../p" }, { action: "execute" }, { path: 42 }, { action: "review" }, { action: "undo", job: 1 }, { action: "undo", job: 1, token: "x" }, { job: -1 }]) {
    assert.ok("error" in parseCommand(JSON.stringify({ ...base, ...change })));
  }
});


test("workspace refuses a replaced project root, a swapped file link, and a damaged original copy", () => {
  const f = fixture();
  try {
    const path = join(f.root, "note.txt"); f.edit("note.txt", "original");
    const id = f.store.addJob("kame", "Fixture edit").id;
    f.store.checkpoint(id, [f.root], path); f.edit("note.txt", "output"); f.store.finishCheckpoints(id); f.store.stop(id);
    const token = f.run("review", "note.txt", id).review!.token!;
    rmSync(path); symlinkSync(join(f.home, "outside.txt"), path);
    assert.equal(f.run("undo", "note.txt", id, token).ok, false);
    rmSync(path); f.edit("note.txt", "output");
    const copies = join(f.home, "copies", String(id));
    writeFileSync(join(copies, readdirSync(copies)[0]!), "damaged original");
    assert.equal(f.run("review", "note.txt", id).ok, false);
    assert.equal(f.run("undo", "note.txt", id, token).ok, false);
    assert.equal(readFileSync(path, "utf8"), "output");
    const moved = f.root + "-moved"; renameSync(f.root, moved); symlinkSync(moved, f.root);
    assert.equal(f.run("list").ok, false);
  } finally { f.close(); }
});
