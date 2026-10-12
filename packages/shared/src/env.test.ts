import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ENV_NAMES, readEnv, resetLegacyEnvWarnings } from "./env.ts";

const SECRET = "s3cret-value-123";

test("only the old name set: the old value is read and its name is logged once, never the value", () => {
  resetLegacyEnvWarnings();
  const lines: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => (lines.push(String(chunk)), true)) as typeof process.stderr.write;
  try {
    assert.equal(readEnv({ ZENO_TELEGRAM_BOT_TOKEN: SECRET }, "ATOM_TELEGRAM_BOT_TOKEN"), SECRET);
    assert.equal(readEnv({ ZENO_TELEGRAM_BOT_TOKEN: SECRET }, "ATOM_TELEGRAM_BOT_TOKEN"), SECRET);
  } finally {
    process.stderr.write = write;
  }
  assert.equal(lines.length, 1, "one warning per name");
  assert.match(lines[0], /ZENO_TELEGRAM_BOT_TOKEN/);
  assert.equal(lines[0].includes(SECRET), false, "the value is never logged");
});

test("only the new name set: the new value is read and nothing is warned", () => {
  const warned: string[] = [];
  assert.equal(readEnv({ ATOM_LOG_LEVEL: "debug" }, "ATOM_LOG_LEVEL", (n) => warned.push(n)), "debug");
  assert.deepEqual(warned, []);
});

test("both names set: the new name wins and nothing is warned", () => {
  const warned: string[] = [];
  assert.equal(readEnv({ ATOM_LOG_LEVEL: "debug", ZENO_LOG_LEVEL: "error" }, "ATOM_LOG_LEVEL", (n) => warned.push(n)), "debug");
  assert.deepEqual(warned, []);
});

test("neither name set: undefined", () => {
  assert.equal(readEnv({}, "ATOM_LOG_LEVEL"), undefined);
});

test("every ATOM_ name in the TypeScript sources is in ENV_NAMES", () => {
  const root = join(import.meta.dirname, "../../..");
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", ".build", ".git", "island", "data", "graphify-out"].includes(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && entry !== "env.ts") {
        for (const m of readFileSync(path, "utf8").matchAll(/\bATOM_[A-Z][A-Z0-9_]*\b/g)) found.add(m[0]);
      }
    }
  };
  for (const top of ["apps", "packages", "services"]) walk(join(root, top));
  const known = new Set<string>(ENV_NAMES);
  assert.deepEqual([...found].filter((n) => !known.has(n)), []);
});
