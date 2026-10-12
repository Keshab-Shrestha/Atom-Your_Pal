import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CHECKPOINT_FILE_BYTES, checkpointTable, CHECKPOINT_JOB_FILES, isSecretLike, openHelperStore, touchesSecretFile, type HelperChange } from "./index.ts";

// B3.4, ADR-101: checkpoint and undo of a run's file edits.

function setup() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "zeno-cp-")));
  const dir = join(home, "data", "checkpoints");
  const folder = join(home, "work");
  mkdirSync(folder);
  const store = openHelperStore({ path: ":memory:", home, checkpointsDir: dir });
  store.addGrant("kame", folder);
  const { id } = store.addJob("kame", "edit files");
  const changes: HelperChange[] = [];
  store.onChange((c) => changes.push(c));
  const edit = (name: string, text: string) => writeFileSync(join(folder, name), text);
  return { home, dir, folder, store, id, changes, edit, done: () => rmSync(home, { recursive: true, force: true }) };
}

test("the first edit of a file is kept once per run: a later edit does not replace the original", () => {
  const t = setup();
  try {
    t.edit("a.txt", "one");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    t.edit("a.txt", "two");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    t.edit("a.txt", "three");
    t.store.finishCheckpoints(t.id);
    assert.deepEqual(t.store.checkpoints(t.id), [{ path: "a.txt", kind: "modified", state: "ready" }]);
    assert.deepEqual(t.store.undoCheckpoints(t.id), [{ path: "a.txt", result: "restored" }]);
    assert.equal(readFileSync(join(t.folder, "a.txt"), "utf8"), "one");
    assert.equal(t.changes.filter((c) => c.action === "checkpoint" && c.change === "kept").length, 1);
  } finally {
    t.done();
  }
});

test("a file that does not exist is 'created'; undo deletes it", () => {
  const t = setup();
  try {
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "sub", "new.txt"));
    mkdirSync(join(t.folder, "sub"));
    t.edit("sub/new.txt", "hi");
    t.store.finishCheckpoints(t.id);
    assert.deepEqual(t.store.checkpoints(t.id), [{ path: join("sub", "new.txt"), kind: "created", state: "ready" }]);
    assert.deepEqual(t.store.undoCheckpoints(t.id), [{ path: join("sub", "new.txt"), result: "restored" }]);
    assert.equal(existsSync(join(t.folder, "sub", "new.txt")), false);
  } finally {
    t.done();
  }
});

test("copies are flat numbered files in a private folder, never named after the path", () => {
  const t = setup();
  try {
    t.edit("secret-plan.txt", "x");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "secret-plan.txt"));
    const jobDir = join(t.dir, String(t.id));
    const names = readdirSync(jobDir);
    assert.equal(names.length, 1);
    assert.match(names[0]!, /^\d+$/);
    assert.equal(statSync(jobDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(jobDir, names[0]!)).mode & 0o777, 0o600);
  } finally {
    t.done();
  }
});

test("secret-like, oversize, symlink-escape, directory and outside paths are skipped rows; none is copied", () => {
  const t = setup();
  try {
    const outside = join(t.home, "outside.txt");
    writeFileSync(outside, "outside");
    for (const name of [".env", ".env.local", "key.pem", "id_rsa", "id_rsa.pub"]) t.edit(name, "secret");
    mkdirSync(join(t.folder, "data"));
    writeFileSync(join(t.folder, "data", "api-token"), "token");
    t.edit("big.bin", "x".repeat(CHECKPOINT_FILE_BYTES + 1));
    symlinkSync(outside, join(t.folder, "link.txt"));
    mkdirSync(join(t.folder, "adir"));
    for (const name of [".env", ".env.local", "key.pem", "id_rsa", "id_rsa.pub", "data/api-token", "big.bin", "link.txt", "adir"]) t.store.checkpoint(t.id, [t.folder], join(t.folder, name));
    t.store.checkpoint(t.id, [t.folder], outside);
    const items = t.store.checkpoints(t.id);
    assert.equal(items.length, 10);
    assert.ok(items.every((i) => i.state === "skipped"), JSON.stringify(items));
    assert.deepEqual(items.find((i) => i.path === "big.bin")?.reason, "too large");
    assert.equal(items.find((i) => i.path === ".env")?.reason, "secret file");
    assert.equal(items.find((i) => i.path === "link.txt")?.reason, "outside the folders");
    assert.equal(items.find((i) => i.path === "adir")?.reason, "not a regular file");
    assert.equal(existsSync(join(t.dir, String(t.id))), false, "nothing copied");
    // a skipped file has nothing to undo
    assert.deepEqual(t.store.undoCheckpoints(t.id, { path: "big.bin" }), [{ path: "big.bin", result: "skipped", reason: "too large" }]);
  } finally {
    t.done();
  }
});

test("a file under a deny-read folder of the home folder is secret-like", () => {
  assert.equal(isSecretLike("/Users/k/.ssh/config", "/Users/k"), true);
  assert.equal(isSecretLike("/Users/k/.aws/credentials", "/Users/k"), true);
  assert.equal(isSecretLike("/Users/k/work/a.ts", "/Users/k"), false);
});

test("the job takes at most 200 files and 50 MB", () => {
  const t = setup();
  try {
    const table = checkpointTable(new DatabaseSync(":memory:"), join(t.home, "cp2"), t.home);
    for (let i = 0; i < CHECKPOINT_JOB_FILES; i += 1) assert.equal(table.capture(1, [t.folder], join(t.folder, `n${i}.txt`)), "ready"); // new files
    assert.equal(table.capture(1, [t.folder], join(t.folder, "one-more.txt")), "skipped");
    assert.equal(table.view(1).at(-1)?.reason, undefined, "the list shows the first 100");
    const sizes = checkpointTable(new DatabaseSync(":memory:"), join(t.home, "cp3"), t.home);
    for (let i = 0; i < 11; i += 1) {
      writeFileSync(join(t.folder, `b${i}`), "x".repeat(CHECKPOINT_FILE_BYTES));
      assert.equal(sizes.capture(1, [t.folder], join(t.folder, `b${i}`)), i < 10 ? "ready" : "skipped", `file ${i}`);
    }
    assert.equal(sizes.view(1).at(-1)?.reason, "too large");
    assert.equal(table.view(1).length, 100);
    const rest = table.undo(1, [t.folder], { path: "n150.txt" });
    assert.equal(rest[0]?.result, "missing"); // kept as a row, nothing on disk to undo
  } finally {
    t.done();
  }
});

test("a file the run changed back to the original is dropped at the run's end", () => {
  const t = setup();
  try {
    t.edit("a.txt", "one");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    t.store.finishCheckpoints(t.id);
    assert.deepEqual(t.store.checkpoints(t.id), []);
  } finally {
    t.done();
  }
});

test("undo: a file changed since the run is a conflict; force restores it; a second undo does nothing", () => {
  const t = setup();
  try {
    t.edit("a.txt", "one");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    t.edit("a.txt", "two");
    t.store.finishCheckpoints(t.id);
    t.edit("a.txt", "keshab edited this later");
    assert.deepEqual(t.store.checkpoints(t.id), [{ path: "a.txt", kind: "modified", state: "changed" }]);
    assert.deepEqual(t.store.undoCheckpoints(t.id), [{ path: "a.txt", result: "conflict", reason: "changed since the run" }]);
    assert.equal(readFileSync(join(t.folder, "a.txt"), "utf8"), "keshab edited this later");
    assert.deepEqual(t.store.undoCheckpoints(t.id, { path: "a.txt", force: true }), [{ path: "a.txt", result: "restored" }]);
    assert.equal(readFileSync(join(t.folder, "a.txt"), "utf8"), "one");
    assert.deepEqual(t.store.undoCheckpoints(t.id), []);
    assert.deepEqual(t.store.undoCheckpoints(t.id, { path: "a.txt" }), [{ path: "a.txt", result: "skipped", reason: "already undone" }]);
    assert.deepEqual(t.store.checkpoints(t.id), [{ path: "a.txt", kind: "modified", state: "undone" }]);
  } finally {
    t.done();
  }
});

test("undo keeps the file's mode and leaves no temp file", () => {
  const t = setup();
  try {
    t.edit("run.sh", "#!/bin/sh\necho 1\n");
    chmodSync(join(t.folder, "run.sh"), 0o750);
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "run.sh"));
    t.edit("run.sh", "#!/bin/sh\necho 2\n");
    t.store.finishCheckpoints(t.id);
    t.store.undoCheckpoints(t.id);
    assert.equal(statSync(join(t.folder, "run.sh")).mode & 0o777, 0o750);
    assert.deepEqual(readdirSync(t.folder), ["run.sh"]);
  } finally {
    t.done();
  }
});

test("undo of a created file that changed is a conflict; gone is 'missing'", () => {
  const t = setup();
  try {
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "n.txt"));
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "g.txt"));
    t.edit("n.txt", "made");
    t.edit("g.txt", "made");
    t.store.finishCheckpoints(t.id);
    t.edit("n.txt", "edited later");
    rmSync(join(t.folder, "g.txt"));
    assert.deepEqual(t.store.undoCheckpoints(t.id), [
      { path: "n.txt", result: "conflict", reason: "changed since the run" },
      { path: "g.txt", result: "missing", reason: "already gone" },
    ]);
    assert.deepEqual(t.store.undoCheckpoints(t.id, { path: "n.txt", force: true }), [{ path: "n.txt", result: "restored" }]);
    assert.equal(existsSync(join(t.folder, "n.txt")), false);
  } finally {
    t.done();
  }
});

test("undo is refused for a file whose grant was revoked", () => {
  const t = setup();
  try {
    t.edit("a.txt", "one");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    t.edit("a.txt", "two");
    t.store.finishCheckpoints(t.id);
    t.store.removeGrant("kame", t.folder);
    assert.deepEqual(t.store.undoCheckpoints(t.id), [{ path: "a.txt", result: "refused", reason: "grant revoked" }]);
    assert.equal(readFileSync(join(t.folder, "a.txt"), "utf8"), "two");
    assert.deepEqual(t.store.undoCheckpoints(t.id, { path: "a.txt", force: true }), [{ path: "a.txt", result: "refused", reason: "grant revoked" }], "force does not widen a grant");
  } finally {
    t.done();
  }
});

test("undo is refused while the task runs", () => {
  const t = setup();
  try {
    t.edit("a.txt", "one");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    t.store.start(t.id);
    assert.throws(() => t.store.undoCheckpoints(t.id), /still running/);
    assert.throws(() => t.store.undoCheckpoints(9999), /./);
  } finally {
    t.done();
  }
});

test("a damaged copy is refused and the file stays", () => {
  const t = setup();
  try {
    t.edit("a.txt", "one");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    t.edit("a.txt", "two");
    t.store.finishCheckpoints(t.id);
    const jobDir = join(t.dir, String(t.id));
    writeFileSync(join(jobDir, readdirSync(jobDir)[0]!), "tampered");
    assert.deepEqual(t.store.undoCheckpoints(t.id), [{ path: "a.txt", result: "refused", reason: "could not write" }]);
    assert.equal(readFileSync(join(t.folder, "a.txt"), "utf8"), "two");
  } finally {
    t.done();
  }
});

test("a file edited again after its undo is kept again", () => {
  const t = setup();
  try {
    t.edit("a.txt", "one");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    t.edit("a.txt", "two");
    t.store.finishCheckpoints(t.id);
    t.store.undoCheckpoints(t.id);
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    t.edit("a.txt", "three");
    t.store.finishCheckpoints(t.id);
    assert.deepEqual(t.store.checkpoints(t.id), [{ path: "a.txt", kind: "modified", state: "ready" }]);
    t.store.undoCheckpoints(t.id);
    assert.equal(readFileSync(join(t.folder, "a.txt"), "utf8"), "one");
  } finally {
    t.done();
  }
});

test("a crash before the run's end is closed at the next open: the file as it is becomes the 'after'", () => {
  const t = setup();
  try {
    // a file store on disk, so that it can be opened twice
    const path = join(t.home, "helpers.db");
    const first = openHelperStore({ path, home: t.home, checkpointsDir: t.dir });
    first.addGrant("kame", t.folder);
    const { id } = first.addJob("kame", "x");
    first.start(id);
    t.edit("a.txt", "one");
    first.checkpoint(id, [t.folder], join(t.folder, "a.txt"));
    t.edit("a.txt", "two");
    first.close();
    const second = openHelperStore({ path, home: t.home, checkpointsDir: t.dir });
    assert.deepEqual(second.checkpoints(id), [{ path: "a.txt", kind: "modified", state: "ready" }]);
    assert.deepEqual(second.undoCheckpoints(id), [{ path: "a.txt", result: "restored" }]);
    second.close();
  } finally {
    t.done();
  }
});

test("deleting the task removes its copies", () => {
  const t = setup();
  try {
    t.edit("a.txt", "one");
    t.store.checkpoint(t.id, [t.folder], join(t.folder, "a.txt"));
    assert.equal(existsSync(join(t.dir, String(t.id))), true);
    t.store.stop(t.id);
    t.store.remove(t.id);
    assert.equal(existsSync(join(t.dir, String(t.id))), false);
    assert.deepEqual(t.store.checkpoints(t.id), []);
  } finally {
    t.done();
  }
});

test("startup sweep: tasks done over 14 days ago, tasks that are gone, and folders with no row are removed; a recent task stays", () => {
  const t = setup();
  try {
    const path = join(t.home, "helpers.db");
    let clock = new Date("2026-10-01T00:00:00Z");
    const open = () => openHelperStore({ path, home: t.home, checkpointsDir: t.dir, now: () => clock });
    const first = open();
    first.addGrant("kame", t.folder);
    const old = first.addJob("kame", "old").id;
    const recent = first.addJob("kame", "recent").id;
    const running = first.addJob("kame", "running").id;
    for (const id of [old, recent, running]) {
      first.start(id);
      t.edit(`f${id}.txt`, "one");
      first.checkpoint(id, [t.folder], join(t.folder, `f${id}.txt`));
      t.edit(`f${id}.txt`, "two");
    }
    first.finish(old, { title: "T", summary: "S", body: "B", sources: [] });
    clock = new Date("2026-10-10T00:00:00Z");
    first.finish(recent, { title: "T", summary: "S", body: "B", sources: [] });
    mkdirSync(join(t.dir, "9999"));
    writeFileSync(join(t.dir, "9999", "1"), "orphan");
    mkdirSync(join(t.dir, "notes")); // not a task folder: left alone
    first.close();
    clock = new Date("2026-10-16T00:00:00Z"); // old: 15 days, recent: 6 days
    const second = open();
    assert.deepEqual(second.checkpoints(old), []);
    assert.equal(existsSync(join(t.dir, String(old))), false);
    assert.equal(existsSync(join(t.dir, "9999")), false);
    assert.equal(existsSync(join(t.dir, "notes")), true);
    assert.equal(second.checkpoints(recent).length, 1);
    assert.equal(existsSync(join(t.dir, String(recent))), true);
    assert.equal(second.checkpoints(running).length, 1, "a task that did not finish keeps its copies");
    second.close();
  } finally {
    t.done();
  }
});

test("bashRan: true only when Bash was called and the task had a folder or kept files", () => {
  const t = setup();
  try {
    assert.equal(t.store.bashRan(t.id), false);
    t.store.recordToolCall(t.id, { id: "c1", tool: "Bash", input: "ls", state: "started", at: "2026-10-13T10:00:00.000Z" });
    assert.equal(t.store.bashRan(t.id), true, "the agent has a folder");
    const other = t.store.addJob("sid", "no folder").id;
    t.store.start(other);
    t.store.recordToolCall(other, { id: "c1", tool: "Bash", input: "ls", state: "started", at: "2026-10-13T10:00:00.000Z" });
    assert.equal(t.store.bashRan(other), false);
  } finally {
    t.done();
  }
});

test("a store without a checkpoints folder keeps nothing and never fails", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "zeno-cp-")));
  try {
    const store = openHelperStore({ path: ":memory:", home });
    const { id } = store.addJob("kame", "x");
    store.checkpoint(id, [home], join(home, "a.txt"));
    store.finishCheckpoints(id);
    assert.deepEqual(store.checkpoints(id), []);
    assert.deepEqual(store.undoCheckpoints(id), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("touchesSecretFile: the copy in helpers matches the gateway's words", async () => {
  const gateway = await import("../../llm-gateway/src/providers/tool-summary.ts");
  for (const text of [".env", "cat .env.local", "/a/b/.env.production", "data/api-token", "/x/data/api-token", "environment.ts", "a.envelope", "x/.envrc", "dotenv"]) {
    assert.equal(touchesSecretFile(text), gateway.touchesSecretFile(text), text);
  }
  assert.equal(touchesSecretFile("/a/.env"), true);
  assert.equal(touchesSecretFile("/a/b.ts"), false);
});
