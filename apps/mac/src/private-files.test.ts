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
