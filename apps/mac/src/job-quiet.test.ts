import { test } from "node:test";
import assert from "node:assert/strict";
import { openHelperStore } from "@ark/helpers";
import { QUIET_AFTER_MS, quietWatch } from "./job-quiet.ts";
import { islandHelpers } from "./island-helpers.ts";

test("a running native job with no output for 8 minutes is marked quiet once, and its next step clears its mark and its manager's", () => {
  const store = openHelperStore({ path: ":memory:" });
  let clock = 1_000_000;
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  let changes = 0;
  const watch = quietWatch(store, { now: () => clock, sweepMs: 0, log: (event, fields) => void logs.push({ event, fields }) });
  watch.onChange(() => void changes++);
  const parent = store.addNativeJob("kame", "Lead the fictional review", { chatId: "cedar" });
  const child = store.addNativeJob("sid", "Check the fictional notes", { chatId: "cedar", parentId: parent.id });
  assert.equal(store.get(child.id)!.state, "running");

  watch.sweep(); // first sight starts the count
  clock += QUIET_AFTER_MS - 1;
  watch.sweep();
  assert.equal(watch.since(child.id), undefined);

  clock += 1;
  watch.sweep();
  assert.equal(watch.since(child.id)?.getTime(), 1_000_000);
  assert.equal(watch.since(parent.id)?.getTime(), 1_000_000);
  assert.deepEqual(logs.map((l) => l.event), ["job.quiet", "job.quiet"]);
  assert.deepEqual(logs.find((l) => l.fields.job === child.id)!.fields, { job: child.id, parent: parent.id });
  assert.equal(changes, 1);

  clock += QUIET_AFTER_MS; // still quiet: no second log, no second change
  watch.sweep();
  assert.equal(logs.length, 2);
  assert.equal(changes, 1);

  store.step(child.id, "Reading 2 of 5 notes"); // a worker's move is also its manager's move
  assert.equal(watch.since(child.id), undefined);
  assert.equal(watch.since(parent.id), undefined);
  assert.equal(changes, 2);
  clock += QUIET_AFTER_MS - 1;
  watch.sweep();
  assert.equal(watch.since(child.id), undefined);
  assert.equal(watch.since(parent.id), undefined);
  watch.stop();
  store.close();
});

test("a manager whose worker's worker moves is never quiet, but a worker is quiet when only its manager moves", () => {
  const store = openHelperStore({ path: ":memory:" });
  let clock = 0;
  const watch = quietWatch(store, { now: () => clock, sweepMs: 0 });
  const lead = store.addNativeJob("kame", "Lead the fictional launch", { chatId: "cedar" });
  const mid = store.addNativeJob("sid", "Plan the fictional pages", { chatId: "cedar", parentId: lead.id });
  const leaf = store.addNativeJob("kame", "Write the fictional copy", { chatId: "cedar", parentId: mid.id });
  watch.sweep();
  for (let minute = 1; minute <= 20; minute++) {
    clock += 60_000;
    store.step(leaf.id, `Writing part ${minute}`);
    watch.sweep();
  }
  assert.deepEqual([lead, mid, leaf].map((j) => watch.since(j.id)), [undefined, undefined, undefined]);
  clock += QUIET_AFTER_MS;
  store.step(lead.id, "Waiting for the pages");
  watch.sweep();
  assert.equal(watch.since(lead.id), undefined);
  assert.ok(watch.since(mid.id));
  assert.ok(watch.since(leaf.id));
  watch.stop();
  store.close();
});

test("a job that ends loses its quiet mark", () => {
  const store = openHelperStore({ path: ":memory:" });
  let clock = 0;
  const watch = quietWatch(store, { now: () => clock, sweepMs: 0 });
  const job = store.addNativeJob("kame", "Draft the fictional plan", { chatId: "cedar" });
  watch.sweep();
  clock += QUIET_AFTER_MS;
  watch.sweep();
  assert.ok(watch.since(job.id));
  store.stop(job.id);
  watch.sweep();
  assert.equal(watch.since(job.id), undefined);
  watch.stop();
  store.close();
});

test("the island's job item carries quietSince while the job is quiet, and its listeners hear the mark", () => {
  const store = openHelperStore({ path: ":memory:" });
  let clock = Date.parse("2026-11-06T10:00:00Z");
  const watch = quietWatch(store, { now: () => clock, sweepMs: 0 });
  const helpers = islandHelpers(store, async () => [], undefined, undefined, undefined, undefined, undefined, watch);
  let heard = 0;
  const stop = helpers.onChange(() => void heard++);
  const job = store.addNativeJob("kame", "Sort the fictional inbox", { chatId: "cedar" });
  const item = () => helpers.list().flatMap((h) => h.jobs).find((j) => j.id === job.id)!;
  watch.sweep();
  assert.equal(item().quietSince, undefined);
  heard = 0;
  clock += QUIET_AFTER_MS;
  watch.sweep();
  assert.equal(item().quietSince, "2026-11-06T10:00:00.000Z");
  assert.equal(heard, 1);
  store.step(job.id, "Reading 1 of 3 mails");
  assert.equal(item().quietSince, undefined);
  stop();
  watch.stop();
  store.close();
});
