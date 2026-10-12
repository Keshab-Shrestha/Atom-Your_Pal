import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore, SUB_AGENTS_LISTED, type HelperChange } from "./index.ts";

// ADR-095: the sub-agents a task's runs started, listed on the task (and so in the `helpers` event).

test("a sub-agent's start and end are kept on its task, cut short; the change carries ids, names and states only", () => {
  const store = openHelperStore({ path: ":memory:", home: mkdtempSync(join(tmpdir(), "atom-home-")) });
  const changes: HelperChange[] = [];
  store.onChange((c) => changes.push(c));
  const { id } = store.addJob("sid", "Compare laptops");
  store.start(id);
  store.recordSubAgent(id, { id: "s1", name: "searcher", state: "started", description: `Find reviews ${"x".repeat(200)}` });
  store.recordSubAgent(id, { id: "r1", name: "reader", state: "started", description: "Read  them" });
  store.recordSubAgent(id, { id: "s1", name: "searcher", state: "done", result: "Three\npages." });
  store.recordSubAgent(id, { id: "r1", name: "reader", state: "failed" });
  store.recordSubAgent(id, { id: "r1", name: "reader", state: "done", result: "late" }); // already ended: ignored
  store.recordSubAgent(id, { id: "z", name: "Bad Name", state: "started" });
  store.recordSubAgent(999, { id: "q", name: "reader", state: "started" });
  const job = store.get(id)!;
  assert.equal(job.subAgents?.length, 2);
  assert.deepEqual(job.subAgents![0], { name: "searcher", state: "done", description: job.subAgents![0]!.description, result: "Three pages." });
  assert.equal(job.subAgents![0]!.description.length, 120);
  assert.deepEqual(job.subAgents![1], { name: "reader", state: "failed", description: "Read them" });
  const logged = changes.filter((c) => c.action === "subAgent");
  assert.deepEqual(logged, [
    { action: "subAgent", helper: "sid", job: id, name: "searcher", state: "started" },
    { action: "subAgent", helper: "sid", job: id, name: "reader", state: "started" },
    { action: "subAgent", helper: "sid", job: id, name: "searcher", state: "done" },
    { action: "subAgent", helper: "sid", job: id, name: "reader", state: "failed" },
  ]);
  assert.equal(store.list().find((h) => h.id === "sid")!.jobs[0]!.subAgents?.length, 2);
  assert.equal(store.get(store.addJob("sid", "Other").id)!.subAgents, undefined, "none: no field");
  store.remove(id);
  assert.equal(store.get(id), undefined);
});

test("the newest twelve are listed; one still working when ATOM closed has failed", () => {
  const path = join(mkdtempSync(join(tmpdir(), "atom-subagents-")), "helpers.db");
  const home = mkdtempSync(join(tmpdir(), "atom-home-"));
  const store = openHelperStore({ path, home });
  const { id } = store.addJob("sid", "Compare laptops");
  for (let i = 1; i <= SUB_AGENTS_LISTED + 2; i++) store.recordSubAgent(id, { id: `a${i}`, name: "reader", state: "started", description: `#${i}` });
  const listed = store.get(id)!.subAgents!;
  assert.equal(listed.length, SUB_AGENTS_LISTED);
  assert.deepEqual([listed[0]!.description, listed.at(-1)!.description], ["#3", `#${SUB_AGENTS_LISTED + 2}`]);
  const reopened = openHelperStore({ path, home });
  assert.ok(reopened.get(id)!.subAgents!.every((s) => s.state === "failed"));
});

test("only the newest twelve are kept on disk: older ones are dropped as new ones start", () => {
  const path = join(mkdtempSync(join(tmpdir(), "atom-subagents-")), "helpers.db");
  const store = openHelperStore({ path, home: mkdtempSync(join(tmpdir(), "atom-home-")) });
  const { id } = store.addJob("sid", "Compare laptops");
  for (let i = 1; i <= 20; i++) store.recordSubAgent(id, { id: `a${i}`, name: "reader", state: "started", description: `#${i}` });
  const db = new DatabaseSync(path);
  const rows = db.prepare("SELECT run_key FROM sub_agents WHERE job_id = ? ORDER BY rowid").all(id) as { run_key: string }[];
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sub_agents").get() as { n: number }).n, SUB_AGENTS_LISTED);
  assert.deepEqual([rows[0]!.run_key, rows.at(-1)!.run_key], ["a9", "a20"]);
  db.close();
});
