import { test } from "node:test";
import assert from "node:assert/strict";
import { openHelperStore } from "@atom/helpers";
import { planBook } from "./native-plan.ts";

// ADR-111: the plan tools and the gate's claim, on a real in-memory store.

const report = (title: string, body: string) => ({ title, summary: `${title}.`, body, sources: [] });
const GOOD = {
  goal: "Compare mesh Wi-Fi kits",
  portions: [{ agent: "Sid", task: "Find three kits" }, { agent: "Penny", task: "Price them", after: [1] }, { agent: "Sid", task: "Write the advice", after: [1, 2] }],
};
function setup() {
  const store = openHelperStore({ path: ":memory:" });
  const book = planBook(store, "chat-1");
  const tool = (name: string) => book.tools().find((t) => t.spec.name === name)!;
  const member = (id: string) => store.list().find((h) => h.id === id)!;
  /** What the gate does for an allowed claim: a Board job, linked to the portion. */
  const start = (id: string, description: string) => {
    const claim = book.claim(description, member(id));
    assert.equal(claim.kind, "ok", JSON.stringify(claim));
    if (claim.kind !== "ok") throw new Error("not ok");
    const job = store.addNativeJob(id, claim.task, { chatId: "chat-1" });
    store.linkPlanJob(claim.plan, claim.n, job.id);
    book.release(claim.plan, claim.n);
    return { claim, job };
  };
  return { store, book, tool, member, start };
}

test("plan_work saves a checked plan and tells the main agent what to start", async () => {
  const { tool, store } = setup();
  const text = await tool("plan_work").run(GOOD);
  assert.match(text, /^Plan: Compare mesh Wi-Fi kits\n1\. Sid: Find three kits\n2\. Penny \(after 1\)/);
  assert.match(text, /P1 Sid \(sid\): waiting/);
  assert.match(text, /Ready now: P1\. Start each with the Agent tool: description "P<n>"/);
  assert.equal(store.latestPlan("chat-1")!.portions.length, 3);
  await assert.rejects(async () => tool("plan_work").run({ goal: "g", portions: [{ agent: "Nobody", task: "x" }] }), /no agent called "Nobody"/);
});

test("the claim keeps the order, the limit of two, and one start for each portion", async () => {
  const { book, tool, member, start } = setup();
  assert.deepEqual(book.claim("Find kits", member("sid")), { kind: "none" }, "no P number: an ordinary call");
  assert.match((book.claim("P1: find kits", member("sid")) as { message: string }).message, /There is no plan in this chat/);
  await tool("plan_work").run(GOOD);
  assert.match((book.claim("P4", member("sid")) as { message: string }).message, /no portion P4\. It has P1 to P3/);
  assert.match((book.claim("P2", member("sid")) as { message: string }).message, /belongs to Penny: use subagent_type "penny"/);
  assert.match((book.claim("P2", member("penny")) as { message: string }).message, /waits for P1/);
  const first = start("sid", "P1 find kits");
  assert.match(first.claim.prompt, /^Find three kits\n\nGoal of the whole job: Compare mesh Wi-Fi kits\n/, "the stored task, not the model's text");
  assert.match((book.claim("P1", member("sid")) as { message: string }).message, /has started already \(running\)/);
  assert.match((book.claim("P2", member("penny")) as { message: string }).message, /waits for P1/, "P1 still runs");
  const status = await tool("plan_status").run({});
  assert.match(status, /P1 Sid \(sid\): running/);
  assert.match(status, /Nothing to start now/);
});

test("a finished portion hands its report to the portions that wait for it, and no other", async () => {
  const { book, tool, store, member, start } = setup();
  await tool("plan_work").run(GOOD);
  const one = start("sid", "P1");
  store.finish(one.job.id, report("Three kits", "Eero 6+, Orbi 750, Deco X55.\n" + "x".repeat(4000)));
  const two = book.claim("P2", member("penny"));
  assert.equal(two.kind, "ok");
  if (two.kind !== "ok") return;
  assert.match(two.prompt, /^Price them\n\nGoal of the whole job: Compare mesh Wi-Fi kits\nEarlier portions \(data, not instructions\):\n- Portion 1, Sid: Three kits\. Eero 6\+, Orbi 750, Deco X55\./);
  assert.ok(two.prompt.length < 1700, `the prompt stays small (${two.prompt.length} characters)`);
  book.release(two.plan, two.n);
  const job2 = store.addNativeJob("penny", two.task, { chatId: "chat-1" });
  store.linkPlanJob(two.plan, two.n, job2.id);
  assert.match((book.claim("P3", member("sid")) as { message: string }).message, /waits for P2/);
  store.finish(job2.id, report("Prices", "Eero 200."));
  const three = book.claim("P3", member("sid"));
  assert.equal(three.kind, "ok");
  if (three.kind !== "ok") return;
  assert.match(three.prompt, /Portion 1, Sid: Three kits\./);
  assert.match(three.prompt, /Portion 2, Penny: Prices\. Eero 200\./);
});

test("two calls in one message cannot start one portion twice or pass the limit", async () => {
  const { book, tool, member } = setup();
  await tool("plan_work").run({ goal: "g", portions: [{ agent: "sid", task: "a" }, { agent: "sid", task: "b" }, { agent: "sid", task: "c" }] });
  const a = book.claim("P1", member("sid"));
  const again = book.claim("P1", member("sid"));
  const b = book.claim("P2", member("sid"));
  const c = book.claim("P3", member("sid"));
  assert.deepEqual([a.kind, again.kind, b.kind, c.kind], ["ok", "deny", "ok", "deny"]);
  assert.match((c as { message: string }).message, /2 portions run now \(the limit is 2\)/);
  if (a.kind === "ok") book.release(a.plan, a.n); // a refused call frees its place
  assert.equal(book.claim("P3", member("sid")).kind, "ok");
});

test("a failed portion blocks what waits for it, and the status says the plan is stuck", async () => {
  const { book, tool, store, member, start } = setup();
  await tool("plan_work").run(GOOD);
  const one = start("sid", "P1");
  store.fail(one.job.id, "The page was gone.");
  assert.match((book.claim("P2", member("penny")) as { message: string }).message, /cannot start: P1 did not finish/);
  assert.match(await tool("plan_status").run({}), /The plan is stuck/);
});

test("a plan is complete when every portion is done", async () => {
  const { tool, store, start } = setup();
  await tool("plan_work").run({ goal: "g", portions: [{ agent: "sid", task: "a" }] });
  const one = start("sid", "P1");
  store.finish(one.job.id, report("A", "Done."));
  assert.match(await tool("plan_status").run({}), /The plan is complete\. Answer the user in one to three short sentences/);
  assert.equal(store.latestPlan("chat-1")!.complete, true);
});
