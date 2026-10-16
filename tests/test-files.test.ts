import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 2026-10-16: a helper script emptied services/helpers/src/grants.test.ts and the suite still passed (an empty test file runs zero tests and fails nothing).
// Every test file must hold at least one test.
const root = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", ".git", ".build", "build", "graphify-out", "dist"]);

function* testFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) yield* testFiles(path);
    else if (name.endsWith(".test.ts")) yield path;
  }
}

test("every test file holds at least one test", () => {
  const empty: string[] = [];
  let count = 0;
  for (const file of testFiles(root)) {
    count++;
    if (!/^\s*test\(/m.test(readFileSync(file, "utf8"))) empty.push(file.slice(root.length));
  }
  assert.ok(count > 50, `only ${count} test files were found`);
  assert.deepEqual(empty, [], "these test files hold no test");
});
