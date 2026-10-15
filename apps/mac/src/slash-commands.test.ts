import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_BODY_CHARS, expandCommand, listCommands, readCommand, useCommand } from "./slash-commands.ts";
import { useSkill } from "./skills.ts";

// 2026-10-15 (ADR-117): Claude Code's custom commands run in ATOM's chat as prompts.

function commandsDir() {
  const dir = mkdtempSync(join(tmpdir(), "atom-commands-"));
  writeFileSync(join(dir, "build-fix.md"), "---\ndescription: Fix build errors with minimal changes.\n---\n\n# Build and Fix\n\nRun the build, then fix what fails.\n");
  writeFileSync(join(dir, "review.md"), '---\ndescription: "Review a file."\nargument-hint: [file]\nallowed-tools: Read, Grep\n---\n\nReview $ARGUMENTS and list problems.\n');
  writeFileSync(join(dir, "compare.md"), "Compare $1 with $2, then say which is better.\n");
  writeFileSync(join(dir, "notes.txt"), "not a command");
  writeFileSync(join(dir, "Bad Name.md"), "a name with a space is not plain");
  writeFileSync(join(dir, "empty.md"), "---\ndescription: nothing inside\n---\n\n");
  mkdirSync(join(dir, "folder.md")); // a folder is not a command
  return dir;
}

test("the commands are the plain-named .md files, sorted, with their description and argument hint", () => {
  const dir = commandsDir();
  try {
    const list = listCommands(dir);
    assert.deepEqual(list.map((c) => c.name), ["build-fix", "compare", "empty", "review"]);
    assert.equal(list.find((c) => c.name === "build-fix")!.description, "Fix build errors with minimal changes.");
    assert.deepEqual(list.find((c) => c.name === "review"), { name: "review", description: "Review a file.", hint: "[file]" });
    assert.deepEqual(listCommands(join(dir, "nope")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a command's prompt has no front matter; an empty one, a missing one and a path are not commands", () => {
  const dir = commandsDir();
  try {
    assert.match(readCommand("build-fix", dir)!.body, /^# Build and Fix/);
    assert.equal(readCommand("empty", dir), undefined);
    assert.equal(readCommand("nope", dir), undefined);
    assert.equal(readCommand("../build-fix", dir), undefined, "a path never matches");
    assert.equal(readCommand("folder.md", dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("$ARGUMENTS and $1..$9 take the words; a command with no placeholder keeps them at the end", () => {
  assert.equal(expandCommand("Review $ARGUMENTS now.", "src/app.ts  carefully"), "Review src/app.ts  carefully now.".replace("  ", "  "));
  assert.equal(expandCommand("Compare $1 with $2.", "red blue green"), "Compare red with blue.");
  assert.equal(expandCommand("Compare $1 with $2.", "red"), "Compare red with .");
  assert.equal(expandCommand("Run the build.", "fast please"), "Run the build.\n\nArguments: fast please");
  assert.equal(expandCommand("Run the build.", ""), "Run the build.");
});

test("a line that starts with ! stays text and the model is told it was not run", () => {
  const out = expandCommand("Check the tree:\n!git status\nThen report.", "");
  assert.match(out, /^Lines that start with "!" are shell commands in Claude Code\. ATOM did not run them/);
  assert.match(out, /!git status/);
});

test("a message that starts with /command becomes the prompt; an unknown name, plain words and a long body are handled", () => {
  const dir = commandsDir();
  try {
    assert.deepEqual(useCommand("/review src/a.ts", dir), { text: "Review src/a.ts and list problems.", block: "" });
    assert.equal(useCommand("/build-fix", dir)!.text.startsWith("# Build and Fix"), true);
    assert.equal(useCommand("/nope", dir), undefined);
    assert.equal(useCommand("hello /review", dir), undefined, "only at the start");
    assert.equal(useCommand("/../review", dir), undefined);
    writeFileSync(join(dir, "long.md"), "x".repeat(COMMAND_BODY_CHARS + 500));
    assert.match(useCommand("/long", dir)!.text, /\[The rest of the command is cut\.\]$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a skill of the same name wins over a command", () => {
  const commands = commandsDir();
  const skills = mkdtempSync(join(tmpdir(), "atom-skills-"));
  try {
    mkdirSync(join(skills, "review"));
    writeFileSync(join(skills, "review", "SKILL.md"), "---\nname: review\ndescription: A skill.\n---\n\nThe skill's steps.\n");
    // The runtime asks the skill first, then the command (runtime.ts).
    const use = (text: string) => useSkill(text, skills) ?? useCommand(text, commands);
    assert.match(use("/review a.ts")!.block, /The skill's steps/);
    assert.equal(use("/compare a b")!.text, "Compare a with b, then say which is better.");
  } finally {
    rmSync(commands, { recursive: true, force: true });
    rmSync(skills, { recursive: true, force: true });
  }
});
