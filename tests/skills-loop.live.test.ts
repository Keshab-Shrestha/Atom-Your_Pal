import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { enableApi, startRuntime, until, type SmokeRuntime } from "./smoke-harness.ts";

// Live test of the self-improving skill loop (ADR-094 A, ADR-110): an agent uses one of ATOM's own skills in a task, Keshab rates the task "not good",
// Tinker (a real model call) proposes an edit to that skill, Keshab accepts it (the skill file changes) and undoes it (the file is back). It uses a
// little of the plan (a few minutes). Run it with `pnpm test:live`. Everything is in a temp folder; the one file the agent writes is in a folder under
// ~/Documents that the test removes.

const live = process.env.ATOM_LIVE_TESTS === "1";
const SKIP = live ? false : "set ATOM_LIVE_TESTS=1 (pnpm test:live) to run the live skill-loop test";
const SKILL = "smoke-greeting";
const ORIGINAL = `---\nname: ${SKILL}\ndescription: How to write the smoke-test greeting file.\n---\n\nWrite a file with exactly one line: Hello from the smoke test.\n`;

const skillFile = (dir: string) => join(dir, "data", "skills", SKILL, "SKILL.md");

async function goalEnded(runtime: SmokeRuntime, id: number) {
  return until(
    async () => (await runtime.api("GET", `/v1/goals/${id}`)).json?.data,
    (goal) => goal?.status === "ended",
    240_000,
    `goal ${id} to end`,
  );
}

test("live: a task that used one of ATOM's skills and was rated not good makes Tinker propose an edit; accepting changes the skill, undo restores it", { skip: SKIP, timeout: 1_200_000 }, async () => {
  const runtime = await startRuntime({
    readyMs: 90_000,
    prepare: (dir) => {
      mkdirSync(join(dir, "data", "skills", SKILL), { recursive: true });
      writeFileSync(skillFile(dir), ORIGINAL);
    },
  });
  const folder = join(homedir(), "Documents", `atom-skill-smoke-${randomBytes(4).toString("hex")}`);
  const file = join(folder, "greeting.txt");
  try {
    mkdirSync(folder, { recursive: true });
    await enableApi(runtime);

    // 1. Give Kame the skill, and wait until the runtime says so.
    runtime.send({ type: "helper.skills", helper: "kame", skills: [SKILL] });
    runtime.send({ type: "helpers.list" });
    await runtime.waitFor((e) => e.type === "helpers" && e.helpers?.find((h: any) => h.id === "kame")?.skills?.includes(SKILL), 30_000, `Kame to have the ${SKILL} skill`);

    // 2. Kame does a task with it.
    const made = await runtime.api("POST", "/v1/goals", { body: { goal: `Kame, use your ${SKILL} skill, then create the file ${file} the way the skill says. Do nothing else.` } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const goalId = made.json.data.goalId as number | null;
    assert.ok(goalId, `no task was made. ATOM said: ${String(made.json.data.answer).slice(0, 300)}`);
    const done = await goalEnded(runtime, goalId);
    const jobId = done.tasks?.[0]?.id as number | undefined;
    assert.ok(jobId, "the goal has a task");

    // 3. Keshab rates the task "not good", with why.
    runtime.send({ type: "job.rate", id: jobId, good: false, comment: "The greeting must say who it is for: it should start with 'Hello, Keshab'. The skill does not say that." });

    // 4. Tinker (a real model call, in its own runner) proposes an edit to the skill. It shows in the helpers event as a pending edit.
    const withEdit = await runtime.waitFor(
      (e) => e.type === "helpers" && Array.isArray(e.skillEdits) && e.skillEdits.some((x: any) => x.skill === SKILL && x.state === "pending"),
      300_000,
      "Tinker's proposed edit to the skill",
    );
    const edit = withEdit.skillEdits.find((x: any) => x.skill === SKILL && x.state === "pending");
    assert.notEqual(edit.before, edit.after, "the edit changes something");
    assert.equal(readFileSync(skillFile(runtime.dir), "utf8"), ORIGINAL, "nothing changes until Keshab accepts");

    // 5. Accept: the skill file changes. Undo: it is back.
    runtime.send({ type: "skill.edit.accept", id: edit.id });
    await runtime.waitFor((e) => e.type === "helpers" && e.skillEdits?.some((x: any) => x.id === edit.id && x.state === "accepted"), 30_000, "the edit to be accepted");
    const changed = readFileSync(skillFile(runtime.dir), "utf8");
    assert.notEqual(changed, ORIGINAL, "accepting the edit changed the skill");
    assert.match(changed, /name: smoke-greeting/, "the skill keeps its name");
    runtime.send({ type: "skill.edit.undo", id: edit.id });
    await runtime.waitFor((e) => e.type === "helpers" && e.skillEdits?.some((x: any) => x.id === edit.id && x.state === "undone"), 30_000, "the edit to be undone");
    assert.equal(readFileSync(skillFile(runtime.dir), "utf8"), ORIGINAL, "undo restores the skill exactly");
  } finally {
    try {
      rmSync(folder, { recursive: true, force: true });
    } finally {
      await runtime.stop();
    }
  }
});
