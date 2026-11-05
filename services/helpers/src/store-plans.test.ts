import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore } from "./store.ts";

// 2026-11-06: Keshab dismisses an old plan so it leaves the Board's list. The row stays.

const ONE = { goal: "g", portions: [{ n: 1, agent: "sid", task: "a", after: [] }] };

function stuckPlan(store: ReturnType<typeof openHelperStore>, chat = "c") {
  const plan = store.addPlan(chat, ONE).id;
  const job = store.addNativeJob("sid", "a", { chatId: chat });
  store.linkPlanJob(plan, 1, job.id);
  store.fail(job.id, "ARK was closed.");
  return plan;
}

test("dismissPlan hides a stuck plan from plans; the chat can still read it", () => {
  const store = openHelperStore({ path: ":memory:" });
  const plan = stuckPlan(store);
  const other = stuckPlan(store);
  assert.equal(store.plan(plan)!.stuck, true);
  store.dismissPlan(plan);
  store.dismissPlan(plan); // a second dismiss changes nothing
  assert.deepEqual(store.plans(5).map((p) => p.id), [other]);
  assert.equal(store.plan(plan)!.id, plan, "the row stays");
  assert.deepEqual(store.planHistory("c").map((p) => p.id), [other, plan]);
});

test("dismissPlan refuses an active plan and an unknown plan", () => {
  const store = openHelperStore({ path: ":memory:" });
  const active = store.addPlan("c", ONE).id;
  assert.throws(() => store.dismissPlan(active), /still running/);
  assert.throws(() => store.dismissPlan(999), /There is no plan 999\./);
  assert.throws(() => store.dismissPlan(0), /positive plan id/);
  assert.deepEqual(store.plans(5).map((p) => p.id), [active]);
});

test("an old plans table gets dismissed_at once, and its rows keep working", () => {
  const dir = mkdtempSync(join(tmpdir(), "ark-plans-"));
  try {
    const path = join(dir, "helpers.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE work_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, goal TEXT NOT NULL, portions TEXT NOT NULL, created_at TEXT NOT NULL)");
    old.prepare("INSERT INTO work_plans (chat_id, goal, portions, created_at) VALUES (?, ?, ?, ?)").run("c", "old", JSON.stringify(ONE.portions), new Date(0).toISOString());
    old.close();
    openHelperStore({ path }).close();
    const store = openHelperStore({ path }); // the second open must not add the column again
    assert.deepEqual(store.plans(5).map((p) => p.goal), ["old"]);
    store.close();
    const db = new DatabaseSync(path);
    const columns = (db.prepare("PRAGMA table_info(work_plans)").all() as { name: string }[]).map((c) => c.name);
    db.close();
    assert.equal(columns.filter((c) => c === "dismissed_at").length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
