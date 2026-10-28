import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TABS, openInApp, type OpenDeps } from "./open-in-app.ts";

// Task 3.14: a report opens in its worker's app, by code.

const sources = [
  { title: "Bad", url: "javascript:alert(1)" },
  ...Array.from({ length: 7 }, (_, i) => ({ title: `S${i}`, url: `https://example.org/${i}` })),
];
const report = { title: 'Mesh "Wi-Fi"', summary: "Mesh beats extenders.", body: "Body one.\n\nBody two.", sources };

function fake() {
  const calls: { app?: string; args?: string[]; script?: string }[] = [];
  const dir = mkdtempSync(join(tmpdir(), "atom-open-"));
  const deps: OpenDeps = {
    open: async (app, args) => void calls.push({ app, args }),
    osascript: async (script) => void calls.push({ script }),
    reportsDir: dir,
  };
  return { calls, deps, dir };
}

test("a browser opens the top web sources as tabs; nothing but http and https", async () => {
  const { calls, deps, dir } = fake();
  try {
    assert.equal(await openInApp("Brave Browser", 3, report, deps), `Opened ${MAX_TABS} sources in Brave Browser.`);
    assert.deepEqual(calls, [{ app: "Brave Browser", args: [0, 1, 2, 3, 4].map((i) => `https://example.org/${i}`) }]);
    await assert.rejects(openInApp("Safari", 3, { ...report, sources: [sources[0]!] }, deps), /no web sources/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Notes gets the report as a new note, safely quoted", async () => {
  const { calls, deps, dir } = fake();
  try {
    assert.equal(await openInApp("Notes", 3, report, deps), "Saved the report in Notes.");
    assert.match(calls[0]!.script!, /^tell application "Notes" to make new note with properties \{body:"<div><b>Mesh \\"Wi-Fi\\"<\/b><\/div><div>Mesh beats extenders\.<\/div>/);
    assert.ok(!calls[0]!.script!.includes("javascript:"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("any other app opens the report as a text file", async () => {
  const { calls, deps, dir } = fake();
  try {
    assert.equal(await openInApp("TextEdit", 3, report, deps), "Opened the report in TextEdit.");
    const file = join(dir, "task-3.txt");
    assert.deepEqual(calls, [{ app: "TextEdit", args: [file] }]);
    assert.match(readFileSync(file, "utf8"), /^Mesh "Wi-Fi"\n\nMesh beats extenders\.\n\nBody one\.\n\nBody two\.\n\nSources:\n- S0: https:\/\/example\.org\/0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
