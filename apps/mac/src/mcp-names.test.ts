import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BROWSER_SERVER } from "./browser.ts";

// ADR-105: the server names ATOM registers. A tool name `mcp__<server>__<tool>` in a run's flags must name one of them.
const REGISTERED_SERVERS = new Set(["atom", BROWSER_SERVER]);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".build", "island"].includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

test("the names are the new ones", () => {
  assert.equal(BROWSER_SERVER, "atom-browser");
});

test("every mcp__<server>__ in the sources names a server ATOM registers", () => {
  const root = join(import.meta.dirname, "../../..");
  const bad: string[] = [];
  for (const top of ["apps", "services", "packages"]) {
    for (const file of sources(join(root, top))) {
      for (const m of readFileSync(file, "utf8").matchAll(/mcp__([A-Za-z0-9-]+)__/g)) {
        if (!REGISTERED_SERVERS.has(m[1]!)) bad.push(`${file.slice(root.length + 1)}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
