import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMBINE_PROMPT,
  HelperError,
  MAX_GOAL_TASKS,
  briefFor,
  createDelegateTool,
  createWorkerShortcut,
  matchWorkerCommand,
  openHelperStore,
  parseCombined,
  teamContext,
  watchGoals,
  type HelperStore,
} from "./index.ts";

// ADR-082/087, Task 3.5: Pal the manager.

const report = (title: string, url = "https://example.org/") => ({ title, summary: `${title} in one line.`, body: `All about ${title}.`, sources: [{ title: "Src", url }] });
const tick = () => new Promise((r) => setTimeout(r, 5));
const run = (store: HelperStore, id: number, title: string, url?: string) => {
  store.start(id);
  store.finish(id, report(title, url));
};

function watched(store: HelperStore, write: (system: string, input: string) => Promise<string>) {
  const ended: { goal: number; tasks: number; line?: string }[] = [];
  const fallbacks: string[] = [];
  const calls: { system: string; input: string }[] = [];
  const stop = watchGoals({
    store,
    write: (system, input) => {
      calls.push({ system, input });
      return write(system, input);
    },
    onEnded: (e) => ended.push(e),
    onFallback: (e) => fallbacks.push(e.reason),
  });
  return { ended, fallbacks, calls, stop };
}

test("a goal's tasks are created together, each waiting for the earlier ones it names", () => {
  const store = openHelperStore({ path: ":memory:" });
  const goal = store.addGoal("home networking guide", [
    { helper: "sid", task: "Research home networking" },
    { helper: "penny", task: "What does the kit cost?" },
    { helper: "quill", task: "Write it up as a guide", after: [1, 2] },
  ]);
  const [sid, penny, quill] = goal.tasks;
  assert.deepEqual(quill!.blockedBy, [sid!.id, penny!.id]);
  assert.deepEqual(goal.tasks.map((t) => [t.goal, t.goalId]), Array(3).fill(["home networking guide", goal.id]));
  assert.equal(goal.endedAt, undefined);
  assert.deepEqual(store.queued().map((j) => j.id), [sid!.id, penny!.id]);
});

test("a bad goal creates nothing", () => {
  const store = openHelperStore({ path: ":memory:" });
  const sid = { helper: "sid", task: "x" };
  for (const [text, parts, why] of [
    ["", [sid], /goal is empty/],
    ["g", [], /1 to 6 tasks/],
    ["g", Array(MAX_GOAL_TASKS + 1).fill(sid), /1 to 6 tasks/],
    ["g", [sid, { helper: "tinker", task: "improve" }], /Tinker only reviews tasks you rate as not good/],
    ["g", [sid, { helper: "bob", task: "x" }], /no helper called "bob"/],
    ["g", [{ ...sid, after: [1] }], /only wait for tasks before it, not 1/],
    ["g", [sid, { ...sid, after: [3] }], /not 3/],
    ["g", [sid, { helper: "sid", task: "  " }], /job is empty/],
  ] as const) {
    assert.throws(() => store.addGoal(text, parts), (e: unknown) => e instanceof HelperError && why.test(e.message), String(why));
  }
  assert.deepEqual(store.list().flatMap((h) => h.jobs), []);
});

test("when the last task ends, one model call writes the combined report and ZENO has one line", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const w = watched(store, async () => "# Home networking\nMesh beats extenders.\n\nThe long story.");
  const goal = store.addGoal("home networking guide.", [
    { helper: "sid", task: "Research" },
    { helper: "quill", task: "Write it up", after: [1] },
  ]);
  run(store, goal.tasks[0]!.id, "Networking", "https://a.org/");
  await tick();
  assert.equal(w.calls.length, 0, "not while Quill still has work");
  run(store, goal.tasks[1]!.id, "Guide", "https://b.org/");
  await tick();
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0]!.system, COMBINE_PROMPT);
  assert.match(w.calls[0]!.input, /^The goal: home networking guide\.\n\n--- Task 1, Sid: Research\nNetworking/);
  const ended = store.goal(goal.id)!;
  assert.deepEqual(ended.report, { title: "Home networking", summary: "Mesh beats extenders.", body: "The long story.", sources: [{ title: "Src", url: "https://a.org/" }, { title: "Src", url: "https://b.org/" }] });
  assert.ok(ended.endedAt);
  assert.ok(ended.tasks.every((t) => t.goalEnded));
  assert.deepEqual(w.ended, [{ goal: goal.id, tasks: 2, line: "Your home networking guide is ready. The ZENO window has the report." }]);
  w.stop();
});

test("a model that fails or answers badly leaves the reports joined", async () => {
  for (const [write, reason] of [
    [async () => Promise.reject(new Error("quota")), "failed"],
    [async () => "just one line", "unreadable"],
  ] as const) {
    const store = openHelperStore({ path: ":memory:" });
    const w = watched(store, write);
    const goal = store.addGoal("guide", [{ helper: "sid", task: "a" }, { helper: "penny", task: "b" }]);
    run(store, goal.tasks[0]!.id, "A");
    run(store, goal.tasks[1]!.id, "B");
    await tick();
    assert.deepEqual(w.fallbacks, [reason]);
    const saved = store.goal(goal.id)!.report!;
    assert.equal(saved.summary, "2 of 2 tasks finished.");
    assert.match(saved.body, /^Sid: A\n/);
  }
});

test("one task: its own report, no model call, and the worker's name in the line", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const w = watched(store, async () => assert.fail("no call"));
  const goal = store.addGoal("Research mesh Wi-Fi", [{ helper: "sid", task: "Research mesh Wi-Fi" }]);
  run(store, goal.tasks[0]!.id, "Mesh");
  await tick();
  assert.equal(store.goal(goal.id)!.report?.title, "Mesh");
  assert.equal(w.ended[0]!.line, "Sid is done. The ZENO window has the report.");
});

test("failures are said plainly; a goal Keshab stopped says nothing", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const w = watched(store, async () => assert.fail("no call when nothing was done"));
  const failed = store.addGoal("guide", [{ helper: "sid", task: "a" }, { helper: "quill", task: "b", after: [1] }]);
  store.start(failed.tasks[0]!.id);
  store.fail(failed.tasks[0]!.id, "boom"); // Quill fails with it
  const stopped = store.addGoal("other", [{ helper: "penny", task: "c" }]);
  store.stop(stopped.tasks[0]!.id);
  await tick();
  assert.equal(store.goal(failed.id)!.report, undefined);
  assert.deepEqual(w.ended, [
    { goal: failed.id, tasks: 2, line: "The team couldn't finish your guide. The ZENO window has the reasons." },
    { goal: stopped.id, tasks: 1 },
  ]);
  assert.throws(() => store.endGoal(failed.id, null), /already ended/);
});

test("some done, some failed: the report says so and the line counts the failures", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const w = watched(store, async () => "T\nS\n\nB");
  const goal = store.addGoal("guide", [{ helper: "sid", task: "a" }, { helper: "penny", task: "b" }]);
  run(store, goal.tasks[0]!.id, "A");
  store.start(goal.tasks[1]!.id);
  store.fail(goal.tasks[1]!.id, "The rate pages would not load");
  await tick();
  assert.match(w.calls[0]!.input, /--- Task 2, Penny: b\nIt did not finish: The rate pages would not load/);
  assert.equal(w.ended[0]!.line, "Your guide is ready, but 1 of 2 tasks failed. The ZENO window has the report.");
});

test("the delegate tool reads names as Keshab uses them and refuses what the store refuses", () => {
  const store = openHelperStore({ path: ":memory:" });
  store.saveSoul("quill", { ...store.soul("quill"), name: "Ink" });
  const delegated: unknown[] = [];
  const tool = createDelegateTool({ store, onDelegated: (e) => delegated.push(e) });
  const out = tool.run({ goal: "guide", tasks: [{ worker: "sid", task: "Research" }, { worker: "INK", task: "Write", after: [1] }] });
  assert.match(out, /^The team has it: Sid \(task 1\); Ink \(task 2, after Sid\)\./);
  assert.deepEqual(delegated, [{ goal: 1, tasks: 2 }]);
  assert.throws(() => tool.run({ goal: "g", tasks: [{ worker: "Bob", task: "x" }] }), /no worker called "Bob". The team: Sid, Kame, Puff, Ink, Penny, Hana, Tinker\./);
  assert.throws(() => tool.run({ goal: "g", tasks: "do it" }), /tasks must be 1 to 6 tasks/);
  assert.throws(() => tool.run({ goal: "g", tasks: [{ worker: "Sid" }] }), /Task 1 needs a worker and a task/);
  assert.throws(() => tool.run({ goal: "g", tasks: [{ worker: "Sid", task: "x", after: "1" }] }), /after must be a list/);
  assert.throws(() => tool.run({ goal: "g", tasks: [{ worker: "Tinker", task: "x" }] }), /Tinker only reviews tasks you rate as not good/);
  assert.equal(store.list().flatMap((h) => h.jobs).length, 2);
});

test("the team line names who is ready, by their current names", () => {
  const store = openHelperStore({ path: ":memory:" });
  assert.equal(
    teamContext(store.list()),
    "Your team: Sid (researcher), Kame (coder), Puff (designer), Quill (documenter), Penny (financial adviser), Hana (hr). Use the delegate tool to give them work that takes minutes. Not ready yet: Tinker.",
  );
});

test("a sentence to a worker by name is a command; other sentences are not", () => {
  const workers = openHelperStore({ path: ":memory:" }).list();
  const cases: [string, unknown][] = [
    ["Sid, research mesh Wi-Fi.", { helper: "sid", name: "Sid", task: "research mesh Wi-Fi." }],
    ["hey zeno, sid: find router prices", { helper: "sid", name: "Sid", task: "find router prices" }],
    ["Ask Penny to compare mortgage rates", { helper: "penny", name: "Penny", task: "compare mortgage rates" }],
    ["please tell Hana to draft a job ad", { helper: "hana", name: "Hana", task: "draft a job ad" }],
    ["Sid, stop.", { helper: "sid", name: "Sid", stop: true }],
    ["Sid, stop working please", { helper: "sid", name: "Sid", stop: true }],
    ["Penny for your thoughts", undefined],
    ["Sid is great", undefined],
    ["What is Sid doing?", undefined],
    ["Sid,", undefined],
  ];
  for (const [text, want] of cases) assert.deepEqual(matchWorkerCommand(text, workers), want, text);
});

test("the voice command gives the worker a task of its own, or stops it, or says why not", () => {
  const store = openHelperStore({ path: ":memory:" });
  const hits: unknown[] = [];
  const say = createWorkerShortcut(store, (e) => hits.push(e));
  assert.equal(say("Sid, research mesh Wi-Fi"), "Sid is on it.");
  const [job] = store.list()[0]!.jobs;
  assert.equal(job!.task, "research mesh Wi-Fi");
  assert.ok(job!.goalId);
  store.start(job!.id);
  assert.equal(say("Sid, check router prices"), "Sid is on it.", "ADR-095: a second task runs alongside the first");
  store.setMaxRunning(1);
  assert.equal(say("Sid, compare mesh kits"), "Sid will start on it when another task ends.", "every run slot taken");
  assert.equal(say("Sid, stop"), "Sid stopped.");
  assert.equal(store.get(job!.id)!.state, "stopped");
  assert.equal(say("Sid, stop"), "Sid isn't working on anything.");
  assert.equal(say("Tinker, improve Sid"), "Tinker only reviews tasks you rate as not good.");
  assert.equal(say("What time is it?"), undefined);
  assert.deepEqual(hits.at(-1), { helper: "tinker", action: "task" });
});

test("'Sid, open it' opens Sid's newest finished report in its app (Task 3.14)", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const opened: number[] = [];
  const say = createWorkerShortcut(store, undefined, async (id) => (opened.push(id), "Opened 3 sources in Brave Browser."));
  assert.equal(say("Sid, open it"), "Sid has no finished report yet.");
  const { id } = store.addJob("sid", "x");
  store.start(id);
  store.finish(id, { title: "T", summary: "S.", body: "B", sources: [] });
  assert.equal(await say("Sid, open the sources"), "Opened 3 sources in Brave Browser.");
  assert.deepEqual(opened, [id]);
  const failing = createWorkerShortcut(store, undefined, async () => Promise.reject(new Error("Choose where Sid opens things first.")));
  assert.equal(await failing("Sid, open that"), "Choose where Sid opens things first.");
  assert.equal(store.get(id)!.state, "done", "not taken as a follow-up");
});

test("the brief does not repeat a goal that is the task itself", () => {
  assert.equal(briefFor("Research mesh", { goal: "Research mesh", comments: [], earlier: [] }), "Research mesh");
});

test("the combined reply needs a title, a line and a body", () => {
  assert.deepEqual(parseCombined("**Title**\nLine.\n\nBody", []), { title: "Title", summary: "Line.", body: "Body", sources: [] });
  assert.equal(parseCombined("Title\nLine.", []), undefined);
});

// ADR-098: a goal keeps the chat that made it.
test("a goal keeps its source; the change event carries it; the delegate tool reads it at each call", () => {
  const store = openHelperStore({ path: ":memory:" });
  const events: unknown[] = [];
  store.onChange((c) => c.action === "goal" && events.push(c));
  let chat: string | undefined = "telegram";
  const tool = createDelegateTool({ store, source: () => chat });
  tool.run({ goal: "one", tasks: [{ worker: "sid", task: "Research" }] });
  chat = "api";
  tool.run({ goal: "two", tasks: [{ worker: "sid", task: "Research" }] });
  chat = undefined;
  tool.run({ goal: "three", tasks: [{ worker: "sid", task: "Research" }] });
  assert.deepEqual([1, 2, 3].map((id) => store.goal(id)!.source), ["telegram", "api", undefined]);
  assert.deepEqual(events, [
    { action: "goal", goal: 1, tasks: 1, ended: false, source: "telegram" },
    { action: "goal", goal: 2, tasks: 1, ended: false, source: "api" },
    { action: "goal", goal: 3, tasks: 1, ended: false },
  ]);
  assert.equal(store.addGoal("direct", [{ helper: "sid", task: "x" }], "win-1").source, "win-1");
});

test("a store file from before the source column still loads; its goals have no source", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "zeno-goals-"));
  try {
    const path = join(dir, "helpers.db");
    const first = openHelperStore({ path });
    first.addGoal("old goal", [{ helper: "sid", task: "x" }]);
    first.close?.();
    const raw = new DatabaseSync(path);
    raw.exec("ALTER TABLE goals DROP COLUMN source"); // the old shape
    raw.close();
    const store = openHelperStore({ path });
    assert.equal(store.goal(1)!.text, "old goal");
    assert.equal(store.goal(1)!.source, undefined);
    assert.equal(store.addGoal("new goal", [{ helper: "sid", task: "y" }], "api").source, "api");
    store.close?.();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
