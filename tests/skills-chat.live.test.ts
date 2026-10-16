import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enableApi, startRuntime } from "./smoke-harness.ts";

// Live test (2026-10-16): the user uses one of ATOM's skills in a plain chat (no task) and says it did not work well. The main agent calls improve_skill,
// and a pending edit (job 0, "from a chat") shows in the helpers event. Nothing changes until the user accepts; accepting writes the skill. Run it with
// `pnpm test:live` (about a minute, uses a little of the plan). Everything is in a temp folder.

const live = process.env.ATOM_LIVE_TESTS === "1";
const SKIP = live ? false : "set ATOM_LIVE_TESTS=1 (pnpm test:live) to run the live chat skill test";
const SKILL = "smoke-greeting";
const ORIGINAL = `---\nname: ${SKILL}\ndescription: How to write the smoke-test greeting.\n---\n\nWrite one line: Hello from the smoke test.\n`;
const skillFile = (dir: string) => join(dir, "data", "skills", SKILL, "SKILL.md");

test("live: a skill used in a plain chat and called not good makes the main agent propose an edit (job 0); accepting writes the skill", { skip: SKIP, timeout: 600_000 }, async () => {
  const runtime = await startRuntime({
    readyMs: 90_000,
    prepare: (dir) => {
      mkdirSync(join(dir, "data", "skills", SKILL), { recursive: true });
      writeFileSync(skillFile(dir), ORIGINAL);
    },
  });
  try {
    await enableApi(runtime);
    const asked = await runtime.api("POST", "/v1/chat", {
      body: {
        chatId: "skillchat",
        text: `/${SKILL} Greet me. That skill did not work well: the greeting never says who it is for. Use the improve_skill tool now to propose an improved version of the ${SKILL} skill that names the person. Write out the whole new steps.`,
      },
    });
    assert.equal(asked.status, 200, JSON.stringify(asked.json));
    runtime.send({ type: "helpers.list" });
    const withEdit = await runtime.waitFor(
      (e) => e.type === "helpers" && Array.isArray(e.skillEdits) && e.skillEdits.some((x: any) => x.skill === SKILL && x.state === "pending"),
      60_000,
      `a pending edit to ${SKILL} (ATOM said: ${String(asked.json?.data?.answer).slice(0, 200)})`,
    );
    const edit = withEdit.skillEdits.find((x: any) => x.skill === SKILL && x.state === "pending");
    assert.equal(edit.jobId, 0, "it comes from a chat: no task");
    assert.notEqual(edit.before, edit.after);
    assert.equal(readFileSync(skillFile(runtime.dir), "utf8"), ORIGINAL, "nothing changes until the user accepts");
    runtime.send({ type: "skill.edit.accept", id: edit.id });
    await runtime.waitFor((e) => e.type === "helpers" && e.skillEdits?.some((x: any) => x.id === edit.id && x.state === "accepted"), 30_000, "the edit to be accepted");
    assert.notEqual(readFileSync(skillFile(runtime.dir), "utf8"), ORIGINAL, "accepting changed the skill");
  } finally {
    await runtime.stop();
  }
});
