import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWorkflow, createWorkflowStore, dueWorkflows, eventWorkflows, workflowNextAt, workflowPrompt, MAX_STEPS } from "./workflows.ts";

const agents = ["sid", "quill"];
const base = { name: "Morning digest", enabled: true, trigger: { kind: "manual" }, steps: [{ helper: "sid", task: "Collect the news" }, { helper: "quill", task: "Write a summary" }] };

test("a workflow is checked: name, trigger, 1 to 8 steps with known agents and tasks", () => {
  const w = checkWorkflow(base, agents, new Date("2026-11-02T00:00:00Z"));
  assert.equal(w.name, "Morning digest"); assert.equal(w.steps.length, 2); assert.equal(w.createdAt, "2026-11-02T00:00:00.000Z"); assert.match(w.id, /^[a-z0-9-]+$/);
  assert.throws(() => checkWorkflow({ ...base, name: " " }, agents), /name is empty/);
  assert.throws(() => checkWorkflow({ ...base, steps: [] }, agents), /1 to 8 steps/);
  assert.throws(() => checkWorkflow({ ...base, steps: Array(MAX_STEPS + 1).fill(base.steps[0]) }, agents), /1 to 8 steps/);
  assert.throws(() => checkWorkflow({ ...base, steps: [{ helper: "nobody", task: "x" }] }, agents), /one of your agents/);
  assert.throws(() => checkWorkflow({ ...base, trigger: { kind: "event", event: "file.changed" } }, agents), /trigger/);
  assert.throws(() => checkWorkflow({ ...base, trigger: { kind: "schedule", schedule: { kind: "hours", every: 0 } } }, agents), /routine/);
  assert.equal(checkWorkflow({ ...base, id: "../../etc" }, agents).id === "../../etc", false, "an unsafe id is replaced");
});

test("schedule and event triggers start only published workflows", () => {
  const daily = checkWorkflow({ ...base, id: "d", trigger: { kind: "schedule", schedule: { kind: "hours", every: 1 } }, createdAt: "2026-11-02T00:00:00.000Z" }, agents);
  const draft = { ...daily, id: "draft", enabled: false };
  const now = new Date("2026-11-02T02:30:00.000Z");
  assert.deepEqual(dueWorkflows([daily, draft], now).map((w) => w.id), ["d"]);
  assert.deepEqual(dueWorkflows([{ ...daily, lastRunAt: "2026-11-02T02:10:00.000Z" }], now), [], "already ran this hour");
  const failed = checkWorkflow({ ...base, id: "f", trigger: { kind: "event", event: "task.failed" } }, agents);
  assert.deepEqual(eventWorkflows([failed, { ...failed, id: "off", enabled: false }], "task.failed").map((w) => w.id), ["f"]);
  assert.deepEqual(eventWorkflows([failed], "task.done"), []);
});

test("the run prompt asks for one plan with the steps in order and names the agents", () => {
  const prompt = workflowPrompt(checkWorkflow(base, agents), (id) => ({ sid: "Sid", quill: "Quill" })[id], "a task failed");
  assert.match(prompt, /Run the workflow "Morning digest" \(a task failed\)\. Call plan_work once/);
  assert.match(prompt, /1\. Sid: Collect the news\n2\. Quill: Write a summary/);
  assert.match(prompt, /do not do the work yourself/);
});

test("the store keeps workflows owner-only, replaces by id, removes and marks runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "ark-workflows-"));
  const path = join(dir, "workflows.json");
  try {
    const store = createWorkflowStore(path, () => agents);
    const [saved] = store.save(base);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    store.save({ ...saved, name: "Renamed" });
    assert.deepEqual(store.list().map((w) => w.name), ["Renamed"]);
    store.markRun(saved!.id, new Date("2026-11-02T05:00:00Z"));
    assert.equal(createWorkflowStore(path, () => agents).list()[0]!.lastRunAt, "2026-11-02T05:00:00.000Z", "read back from the file");
    store.remove(saved!.id);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { version: 1, workflows: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("workflowNextAt gives the next run of a published schedule workflow only", () => {
  const base = { id: "w1", name: "n", steps: [{ helper: "a", task: "t" }], createdAt: "2026-11-01T00:00:00.000Z" };
  const now = new Date("2026-11-05T12:00:00.000Z");
  const hourly = { ...base, enabled: true, trigger: { kind: "schedule" as const, schedule: { kind: "hours" as const, every: 6 } } };
  assert.equal(workflowNextAt(hourly, now), "2026-11-05T12:00:00.000Z".replace("12", "18"), "every 6 hours from the creation time");
  assert.equal(workflowNextAt({ ...hourly, enabled: false }, now), undefined, "a draft does not wake the Mac");
  assert.equal(workflowNextAt({ ...base, enabled: true, trigger: { kind: "manual" as const } }, now), undefined);
  assert.equal(workflowNextAt({ ...base, enabled: true, trigger: { kind: "event" as const, event: "task.failed" as const } }, now), undefined);
});
