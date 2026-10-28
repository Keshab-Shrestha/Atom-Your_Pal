import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryStore } from "./store.ts";

test("explicit file grants survive reopening, remain scoped to the chat and are removed with it", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "atom-file-permission-")));
  const path = join(dir, "memory.db");
  let memory = openMemoryStore({ path });
  try {
    memory.chats.save("one", [{ role: "user", content: "test" }]);
    memory.filePermissions.forChat("one").grant("/Users/test/Documents/page.html");
    memory.close();
    memory = openMemoryStore({ path });
    assert.deepEqual(memory.filePermissions.forChat("one").list(), ["/Users/test/Documents/page.html"]);
    assert.equal(memory.filePermissions.forChat("two").has("/Users/test/Documents/page.html"), false);
    assert.equal(memory.filePermissions.forChat("one").has("/Users/test/Documents/another.html"), false);
    memory.chats.remove("one");
    assert.deepEqual(memory.filePermissions.forChat("one").list(), []);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
