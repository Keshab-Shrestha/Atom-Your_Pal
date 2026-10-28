import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireInstanceLock } from "./instance-lock.ts";

const tmp = () => join(mkdtempSync(join(tmpdir(), "atom-lock-")), ".atom.lock");

test("a second acquire is refused while the first owner lives", () => {
  const file = tmp();
  const first = acquireInstanceLock(file);
  assert.equal(first.ok, true);
  assert.match(readFileSync(file, "utf8"), new RegExp(`"pid":${process.pid}`));
  const second = acquireInstanceLock(file);
  assert.deepEqual(second.ok ? null : { pid: second.pid }, { pid: process.pid });
  if (first.ok) first.release();
});

test("a lock of a dead process is taken over", () => {
  const file = tmp();
  writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: "x" }));
  const lock = acquireInstanceLock(file);
  assert.equal(lock.ok, true);
  assert.match(readFileSync(file, "utf8"), new RegExp(`"pid":${process.pid}`));
});

test("an unreadable lock file counts as stale", () => {
  const file = tmp();
  writeFileSync(file, "garbage");
  assert.equal(acquireInstanceLock(file).ok, true);
});

test("release removes the file, and only our own", () => {
  const file = tmp();
  const lock = acquireInstanceLock(file);
  assert.ok(lock.ok);
  lock.release();
  assert.equal(existsSync(file), false);
  writeFileSync(file, JSON.stringify({ pid: 1 }));
  lock.release(); // not ours any more: stays
  assert.equal(existsSync(file), true);
});
