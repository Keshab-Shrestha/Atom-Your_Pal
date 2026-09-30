import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("ZENO starts", () => {
  const output = execFileSync(process.execPath, ["apps/mac/src/main.ts"], { encoding: "utf8" });
  assert.match(output, /ZENO Phase 0: started/);
});
