import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePrivate } from "./private-files.ts";

const root = mkdtempSync(join(tmpdir(), "atom-private-"));
after(() => rmSync(root, { recursive: true, force: true }));
const mode = (p: string) => statSync(p).mode & 0o777;

test("the data folder, a database with its WAL files and a log become owner-only; missing paths are skipped", () => {
  const dir = join(root, "data");
  mkdirSync(dir, { mode: 0o755 });
  const db = join(dir, "helpers.db");
  const log = join(root, "atom.log");
  for (const f of [db, `${db}-wal`, `${db}-shm`, log]) writeFileSync(f, "x", { mode: 0o644 });
  const failed = makePrivate({ dirs: [dir, join(root, "nope")], databases: [db, join(dir, "gone.db")], files: [log] });
  assert.deepEqual(failed, []);
  assert.equal(mode(dir), 0o700);
  for (const f of [db, `${db}-wal`, `${db}-shm`, log]) assert.equal(mode(f), 0o600, f);
});

// 2026-10-16 (review of the fixes): runtime.ts resolved ":memory:" into <cwd>/:memory: before filtering it, so the working folder was
// made 0700; a custom ATOM_LOG_FILE or ATOM_MEMORY_FILE in a shared folder (such as $HOME) would have had its folder changed too.
test("only ATOM's own data and logs folders are made private, never a folder the user pointed a file into", async () => {
  const { ownFolders } = await import("./private-files.ts");
  assert.deepEqual(ownFolders(["/p/data/helpers.db", "/p/data/memory.db", "/p/logs/atom.log"]), ["/p/data", "/p/logs"], "default places, once each");
  assert.deepEqual(ownFolders(["/Users/k/memory.db", "/var/log/atom.log", "/p/cwd/:memory:"]), [], "a home folder, /var/log and the working folder are not ours");
  assert.deepEqual(ownFolders([":memory:"]), [], "the in-memory database has no folder");
});
