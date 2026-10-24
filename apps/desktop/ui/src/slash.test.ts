// Ports of SlashMenuTests.swift (ADR-117).

import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_INS, SLASH_LIMIT, allItems, builtInIn, completion, isPicking, itemsFor, title, unavailable } from "./slash.ts";

const skills = [
  { name: "pdf", description: "Read and write PDFs." },
  { name: "review", description: "A skill that reviews." },
];
const commands = [
  { name: "build-fix", description: "Fix build errors with minimal changes.", hint: "" },
  { name: "review", description: "Review a file.", hint: "[file]" },
  { name: "new", description: "A command called new.", hint: "" },
  { name: "checkpoint", description: "Create or verify a checkpoint.", hint: "" },
];
const names = (draft: string) => itemsFor(draft, skills, commands).map((i) => i.name);

test("it opens on a slash and narrows with letters", () => {
  assert.ok(isPicking("/") && isPicking("/bui"));
  assert.ok(!isPicking("") && !isPicking("hello") && !isPicking("/review a.ts") && !isPicking("a /b") && !isPicking("/a\nb"));
  assert.deepEqual(names("hello"), []);
  assert.deepEqual(names("/").slice(0, 5), ["help", "memory", "model", "new", "skills"], "ATOM's own commands lead, by name");
  assert.deepEqual(names("/bui"), ["build-fix"]);
});

test("a name match beats a description match", () => {
  assert.deepEqual(names("/check"), ["checkpoint"]);
  assert.deepEqual(names("/errors"), ["build-fix"]);
  assert.deepEqual(names("/view"), ["review"]);
  assert.deepEqual(names("/zzz"), []);
  assert.deepEqual(names("/PDF"), ["pdf"], "case does not matter");
});

test("each name is listed once and the right source owns it", () => {
  const all = allItems(skills, commands);
  assert.equal(new Set(all.map((i) => i.name)).size, all.length);
  assert.equal(all.find((i) => i.name === "new")?.source, "atom");
  assert.equal(all.find((i) => i.name === "review")?.source, "skill");
  assert.equal(all.find((i) => i.name === "build-fix")?.source, "command");
});

test("picking a skill or a command fills its name and a space", () => {
  const [first] = itemsFor("/build", skills, commands);
  assert.equal(completion(first!), "/build-fix ");
  assert.equal(title(first!), "/build-fix");
  assert.equal(allItems([], commands).find((i) => i.name === "review")?.hint, "[file]");
});

test("the picker lists at most eight rows", () => {
  const many = Array.from({ length: 20 }, (_, n) => ({ name: `skill-${String(n).padStart(2, "0")}`, description: "" }));
  assert.equal(itemsFor("/", many, []).length, SLASH_LIMIT);
  assert.equal(itemsFor("/skill-1", many, []).length, 8);
});

test("a full ATOM command is recognised with its words", () => {
  assert.equal(builtInIn("/new")?.action, "newChat");
  assert.equal(builtInIn("  /Memory  ")?.action, "memory");
  assert.equal(builtInIn("/model gpt")?.rest, "gpt");
  assert.equal(builtInIn("/review a.ts"), undefined, "not an ATOM command: it goes to ATOM as a message");
  for (const text of ["new", "", "/", "/ new", "//new"]) assert.equal(builtInIn(text), undefined, JSON.stringify(text));
  assert.equal(new Set(BUILT_INS.map((b) => b.action)).size, BUILT_INS.length, "each ATOM command has its own action");
});

test("commands whose pages are not in the window say so", () => {
  assert.equal(unavailable("newChat"), undefined);
  assert.equal(unavailable("help"), undefined);
  for (const action of ["model", "skills", "memory"] as const) assert.ok(unavailable(action));
});
