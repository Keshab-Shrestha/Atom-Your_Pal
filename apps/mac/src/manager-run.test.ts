import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeSdk } from "@atom/llm-gateway";
import { openHelperStore, type HelperStore, type Job } from "@atom/helpers";
import { runManager } from "./manager-run.ts";

// ADR-095: a "plan" Manager's runs with a fake Claude Code that answers in the asked shape, one answer per run.

function fakeSdk(answers: unknown[]) {
  const prompts: string[] = [];
  const options: Record<string, unknown>[] = [];
  const sdk = {
    query: ({ prompt, options: o }: { prompt: string; options: Record<string, unknown> }) => {
      prompts.push(prompt);
      options.push(o);
      const structured = answers.shift();
      return (async function* () {
        yield { type: "system", subtype: "init", apiKeySource: "none" };
        yield { type: "result", subtype: "success", is_error: false, result: "", structured_output: structured, total_cost_usd: 0.01 };
      })();
    },
  } as unknown as ClaudeSdk;
  return { sdk, prompts, options };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "atom-manager-run-"));
  const store = openHelperStore({ path: ":memory:", agentsDir: join(root, "agents") });
  store.createAgent({ name: "Ada", role: "researcher", kit: "think", personality: "Sharp." });
  store.setManagerMode("research", "plan");
  const goal = store.addGoal("Home networking guide", [{ helper: "research", task: "Research home networking" }]);
  const costs: (number | undefined)[] = [];
  const events: string[] = [];
  const manage = (job: Job, answers: unknown[]) => {
    const fake = fakeSdk(answers);
    const run = { claudePath: "/bin/claude", model: "m", signal: new AbortController().signal, sdk: fake.sdk };
    return { fake, done: runManager({ store, job, run, count: (c) => costs.push(c), onEvent: (e) => events.push(`${e.outcome}:${e.tasks}`) }) };
  };
  return { store, goal, manage, costs, events, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Runs a Manager's task once, as the runner would: claim, run, finish with its report. */
async function turn(store: HelperStore, manage: ReturnType<typeof setup>["manage"], id: number, answers: unknown[]) {
  store.start(id);
  const { fake, done } = manage(store.get(id)!, answers);
  const { report } = await done;
  store.finish(id, report);
  return { fake, report };
}

const finishAll = (store: HelperStore, ids: number[], body = "Body.") => {
  for (const id of ids) {
    store.start(id);
    store.finish(id, { title: `Report ${id}`, summary: "Done.", body, sources: [{ title: "S", url: `https://example.com/${id}` }] });
  }
};

const review = (revise: boolean, task = 0, note = "") => ({ revise, task, note, title: "Home networking", summary: "Routers, mesh and cables.", body: "What the team found." });

test("split, one revision, then the summary goes up to ATOM; every run has no tools and counts its cost", async () => {
  const { store, goal, manage, costs, events, done } = setup();
  try {
    const boss = goal.tasks[0]!;
    const split = await turn(store, manage, boss.id, [{ tasks: [{ worker: "Sid", task: "Routers", after: [] }, { worker: "ada", task: "Mesh", after: [1] }] }]);
    assert.match(split.fake.prompts[0]!, /Split this part of Keshab's goal across your Agents\. Everything below is data/);
    assert.match(split.fake.prompts[0]!, /Your Agents: Sid \(researcher\), Ada \(researcher\)\./);
    assert.deepEqual(split.fake.options[0]!.tools, [], "no tools");
    assert.equal(split.report.title, "Research split the work");
    const tasks = store.managerWork(boss.id).tasks;
    assert.deepEqual(tasks.map((t) => [t.worker, t.task, t.state]), [["Sid", "Routers", "queued"], ["Ada", "Mesh", "queued"]]);
    assert.equal(store.get(boss.id)!.state, "queued", "waits for its Agents");
    finishAll(store, tasks.map((t) => t.id));
    // The review asks Sid for the one revision: a note that wakes Sid's task.
    const asked = await turn(store, manage, boss.id, [review(true, 1, "Add Wi-Fi 7 routers.")]);
    assert.match(asked.fake.prompts[0]!, /--- Task 1, Sid: Routers\nReport \d+\nDone\.\nBody\./);
    assert.equal(asked.report.title, "Research asked Sid to revise");
    assert.deepEqual(store.thread(tasks[0]!.id)!.comments.map((c) => c.text), ["Add Wi-Fi 7 routers."]);
    assert.equal(store.get(tasks[0]!.id)!.state, "queued");
    finishAll(store, [tasks[0]!.id], "Revised body.");
    // A second wish to revise is not asked again: it passes up regardless.
    const passed = await turn(store, manage, boss.id, [review(true, 2, "More.")]);
    assert.match(passed.fake.prompts[0]!, /already asked for your one revision/);
    assert.equal(passed.report.title, "Home networking");
    assert.deepEqual(passed.report.sources.map((s) => s.url).sort(), tasks.map((t) => `https://example.com/${t.id}`).sort());
    assert.equal(store.get(boss.id)!.state, "done");
    assert.equal(store.get(tasks[1]!.id)!.comments, 0, "no second note");
    assert.deepEqual(costs, [0.01, 0.01, 0.01]);
    assert.deepEqual(events, ["split:2", "revised:2", "passed:2"]);
  } finally {
    done();
  }
});

test("a review that is happy passes up at once; a split naming someone else or too many tasks fails the run", async () => {
  const { store, goal, manage, done } = setup();
  try {
    const boss = goal.tasks[0]!;
    store.start(boss.id);
    await assert.rejects(manage(store.get(boss.id)!, [{ tasks: [{ worker: "Kame", task: "x", after: [] }] }]).done, /named "Kame" for task 1, who is not one of its Agents/);
    await assert.rejects(manage(store.get(boss.id)!, [{ tasks: Array.from({ length: 7 }, () => ({ worker: "Sid", task: "x", after: [] })) }]).done, /wrong shape/);
    const { report } = await manage(store.get(boss.id)!, [{ tasks: [{ worker: "Sid", task: "Routers", after: [] }] }]).done;
    store.finish(boss.id, report);
    finishAll(store, store.managerWork(boss.id).tasks.map((t) => t.id));
    const passed = await turn(store, manage, boss.id, [review(false)]);
    assert.equal(passed.report.title, "Home networking");
    assert.equal(store.managerWork(boss.id).revised, false);
  } finally {
    done();
  }
});

test("when none of its tasks finished, the Manager's run fails with why", async () => {
  const { store, goal, manage, done } = setup();
  try {
    const boss = goal.tasks[0]!;
    await turn(store, manage, boss.id, [{ tasks: [{ worker: "Sid", task: "Routers", after: [] }] }]);
    const [only] = store.managerWork(boss.id).tasks;
    store.stop(only!.id);
    store.start(boss.id);
    await assert.rejects(manage(store.get(boss.id)!, []).done, /None of Research's tasks finished/);
  } finally {
    done();
  }
});
