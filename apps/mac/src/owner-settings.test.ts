import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanOwnerName, ownerName, setOwnerName } from "@ark/shared";
import { classifyCommand, instructionsFor } from "@ark/helpers";
import { parseCommand } from "./island-protocol.ts";
import { createOwnerSettings, ownerPath, readSavedOwner } from "./owner-settings.ts";

const soul = { name: "Sid", personality: "Curious.", howItWorks: "", rules: "", lessons: "" };

test("ADR-271: the owner's name is cleaned, and prompts say \"the user\" until one is set", () => {
  setOwnerName(undefined);
  assert.equal(ownerName(), "the user");
  assert.equal(ownerName(true), "The user");
  assert.equal(cleanOwnerName("  Sam \n Lee\u0007 "), "Sam Lee");
  assert.equal(cleanOwnerName("   "), undefined);
  assert.equal(cleanOwnerName(42), undefined);
  assert.equal(cleanOwnerName("x".repeat(80))?.length, 60);
});

test("ADR-271: a worker's prompt and a refusal use the configured name, never a hard-coded one", () => {
  try {
    setOwnerName("Sam");
    const prompt = instructionsFor(soul, "researcher");
    assert.match(prompt, /Sam gives you a task/);
    assert.doesNotMatch(prompt, /Keshab/);
    const refused = classifyCommand("rm -rf build");
    assert.equal(refused.verdict, "refuse");
    assert.match("reason" in refused ? String(refused.reason) : "", /it asks Sam and moves the file to the Trash/);
  } finally {
    setOwnerName(undefined);
  }
  assert.match(instructionsFor(soul, "researcher"), /the user gives you a task/);
});

test("ADR-271: owner.set is parsed and refused without a name", () => {
  assert.deepEqual(parseCommand(JSON.stringify({ type: "owner.set", name: " Sam " })), { command: { type: "owner.set", name: "Sam" } });
  assert.ok("error" in parseCommand(JSON.stringify({ type: "owner.set", name: "  " })));
  assert.ok("error" in parseCommand(JSON.stringify({ type: "owner.set" })));
});

test("ADR-271: the runtime saves the name in owner.json next to the settings file and reads it at the next start", () => {
  const dir = mkdtempSync(join(tmpdir(), "ark-owner-"));
  try {
    const path = ownerPath(join(dir, "config", "island.json"));
    assert.equal(path, join(dir, "config", "owner.json"));
    setOwnerName(undefined);
    const owner = createOwnerSettings(path);
    assert.equal(ownerName(), "the user", "nothing saved yet");
    assert.equal(owner.set("Sam"), "Sam");
    assert.equal(ownerName(), "Sam");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { name: "Sam" });
    assert.equal(owner.set(""), undefined, "an empty name is refused");
    assert.equal(ownerName(), "Sam");
    setOwnerName(undefined);
    createOwnerSettings(path); // the next start
    assert.equal(ownerName(), "Sam");
    assert.equal(readSavedOwner(join(dir, "missing.json")), undefined);
  } finally {
    setOwnerName(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});
