import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryable, openHelperStore } from "./index.ts";

// ADR-090: issues: Retry, and one automatic retry for a failure a second try may fix.

test("a time-limit failure runs again once by itself, and what waits for it waits on", () => {
  const store = openHelperStore({ path: ":memory:" });
  const a = store.addJob("sid", "a");
  const b = store.addJob("penny", "b", { blockedBy: [a.id] });
  store.start(a.id);
  store.fail(a.id, "Took longer than 15 minutes");
  assert.deepEqual([store.get(a.id)!.state, store.get(a.id)!.autoRetries, store.get(b.id)!.state], ["queued", 1, "queued"]);
  assert.ok(store.thread(a.id)!.activity.some((x) => x.kind === "retried"));
  store.start(a.id);
  store.fail(a.id, "Took longer than 15 minutes");
  assert.deepEqual([store.get(a.id)!.state, store.get(b.id)!.state], ["failed", "failed"], "only once");
});

test("setup problems and the plan's limits are never retried by themselves", () => {
  const store = openHelperStore({ path: ":memory:" });
  for (const error of ["Sid needs the Claude plan for research.", "Kame needs a folder to work in: grant one in the ZENO window.", "Your Claude plan limit is reached."]) {
    const { id } = store.addJob("sid", "x");
    store.start(id);
    store.fail(id, error);
    assert.equal(store.get(id)!.state, "failed", error);
  }
  assert.ok(isRetryable("Claude Code ended without a report.") && isRetryable("The report came back in the wrong shape (body)."));
});

test("Retry runs a failed or stopped task again; anything else is refused", () => {
  const store = openHelperStore({ path: ":memory:" });
  const { id } = store.addJob("sid", "x");
  assert.throws(() => store.retry(id), /Only a failed or stopped task/);
  store.start(id);
  store.fail(id, "The pages would not load");
  store.retry(id);
  assert.equal(store.get(id)!.state, "queued");
  store.stop(id);
  store.retry(id);
  assert.equal(store.get(id)!.state, "queued");
});
