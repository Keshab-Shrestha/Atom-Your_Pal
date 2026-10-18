import { test } from "node:test";
import assert from "node:assert/strict";
import { answerNeed, needsYou, startTelegramBot } from "./telegram-bot.ts";

// ADR-098 items 1 and 2: the Telegram bot. globalThis.fetch is replaced (startTelegram reads it when it starts).

const log = { debug() {}, info() {}, warn() {}, error() {} } as any;
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mkJob = (o: Record<string, unknown>) => ({ id: 1, helper: "h", state: "queued", task: "t", ...o });
const ask = (id: string) => ({ id, summary: `sum ${id}`, reason: "why" });

function fakeStore(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const rec = (n: string) => (id: number) => void calls.push(`${n}:${id}`);
  const store: any = {
    calls,
    list: () => [{ name: "Scout", jobs: [], routines: [], proposals: [] }],
    managers: () => [],
    skillDrafts: () => [],
    skillEdits: () => [],
    skillHubPending: () => [],
    onChange: () => () => {},
    report: () => undefined,
    get: () => undefined,
    approvePlan: rec("approvePlan"), rejectPlan: rec("rejectPlan"), acceptProposal: rec("acceptProposal"), rejectProposal: rec("rejectProposal"),
    approveSkillDraft: rec("approveSkillDraft"), rejectSkillDraft: rec("rejectSkillDraft"), acceptSkillEdit: rec("acceptSkillEdit"), rejectSkillEdit: rec("rejectSkillEdit"),
    approveSkillHub: rec("approveSkillHub"), rejectSkillHub: rec("rejectSkillHub"),
    retry: rec("retry"),
    testResults: () => [],
    ...over,
  };
  return store;
}

test("needsYou: keys, push flags and button codes", () => {
  const store = fakeStore({
    list: () => [{
      name: "Scout",
      jobs: [mkJob({ id: 1, planStatus: "awaiting", planSummary: "P" }), mkJob({ id: 2 }), mkJob({ id: 3, state: "failed", error: "bad" })],
      routines: [],
      proposals: [{ id: 7, state: "pending", field: "soul", text: "t", reason: "r" }, { id: 8, state: "accepted", field: "soul", text: "t", reason: "r" }],
    }],
    skillDrafts: () => [{ id: 4, state: "pending", name: "n", description: "d" }],
    skillEdits: () => [{ id: 5, state: "pending", skill: "k", reason: "r" }],
  });
  const needs = needsYou(store, [ask("q1")] as any);
  assert.deepEqual(needs.map((n) => n.key), ["ask-q1", "plan-1", "proposal-7", "skill-draft-4", "skill-edit-5", "failed-3"]);
  assert.deepEqual(needs.map((n) => n.push), [true, true, true, true, true, false]);
  const codes = (k: string) => needs.find((n) => n.key === k)!.buttons!.flat().map((b) => b.data);
  assert.deepEqual(codes("ask-q1"), ["a:q1:1", "a:q1:0"]);
  assert.deepEqual(codes("plan-1"), ["p:1:1", "p:1:0"]);
  assert.deepEqual(codes("proposal-7"), ["s:7:1", "s:7:0"]);
  assert.deepEqual(codes("skill-draft-4"), ["d:4:1", "d:4:0"]);
  assert.deepEqual(codes("skill-edit-5"), ["e:5:1", "e:5:0"]);
  assert.deepEqual(codes("failed-3"), ["r:3"]);
});

test("needsYou without a store still lists ATOM's questions; every code fits Telegram's 64 bytes", () => {
  assert.deepEqual(needsYou(undefined, [ask("q")] as any).map((n) => n.key), ["ask-q"]);
  const long = needsYou(undefined, [ask("x".repeat(40))] as any);
  assert.ok(long[0]!.buttons!.flat().every((b) => Buffer.byteLength(b.data) <= 64));
});

test("needsYou: a hub skill shows name, source, short sha and flag kinds, never its text; Approve and Reject use h:<id>", () => {
  const secret = "SECRET SKILL TEXT https://evil.example";
  const store = fakeStore({
    skillHubPending: () => [
      { id: 9, kind: "new", name: "pdf-tools", repo: "anthropics/skills", sha: "a".repeat(40), text: secret, flags: [{ kind: "url", severity: "info", excerpt: "https://evil.example" }, { kind: "url", severity: "info", excerpt: "x" }, { kind: "shell-command", severity: "warn", excerpt: "curl" }] },
      { id: 10, kind: "update", name: "old-one", repo: "anthropics/skills", sha: "b".repeat(40), text: secret, flags: [] },
    ],
  });
  const needs = needsYou(store, []);
  assert.deepEqual(needs.map((n) => [n.key, n.push]), [["skill-hub-9", true], ["skill-hub-10", true]]);
  assert.equal(needs[0]!.text, "Skill from the hub: pdf-tools\nanthropics/skills @ aaaaaaa\nFlags: url, shell-command\nRead it in the ATOM window before you approve.");
  assert.match(needs[1]!.text, /newer version of the old-one skill.*\nFlags: none/s);
  assert.ok(needs.every((n) => !n.text.includes("SECRET") && !n.text.includes("evil")));
  assert.deepEqual(needs[0]!.buttons!.flat().map((b) => b.data), ["h:9:1", "h:9:0"]);
});

test("answerNeed: each code calls the matching store method", () => {
  const store = fakeStore();
  const approvals = { pending: () => [{ id: "q1" }] as any, answered: [] as string[], answer(id: string, ok: boolean) { this.answered.push(`${id}:${ok}`); } };
  const said = (d: string) => answerNeed(d, store, approvals);
  assert.equal(said("a:q1:1"), "Allowed.");
  assert.equal(said("a:q1:0"), "Declined.");
  assert.equal(said("a:gone:1"), "That question has already ended.");
  assert.deepEqual(approvals.answered, ["q1:true", "q1:false"]);
  for (const d of ["p:1:1", "p:1:0", "s:2:1", "s:2:0", "d:3:1", "d:3:0", "e:4:1", "e:4:0", "h:6:1", "h:6:0", "r:5"]) said(d);
  assert.deepEqual(store.calls, ["approvePlan:1", "rejectPlan:1", "acceptProposal:2", "rejectProposal:2", "approveSkillDraft:3", "rejectSkillDraft:3", "acceptSkillEdit:4", "rejectSkillEdit:4", "approveSkillHub:6", "rejectSkillHub:6", "retry:5"]);
  assert.equal(said("zzz:1:1"), "That button is out of date.");
  assert.equal(said(""), "That button is out of date.");
  assert.equal(answerNeed("p:1:1", undefined, approvals), "The team is not available.");
});

test("recovery needs review on the Mac, stale remote retry buttons are inert, and old attempts do not keep asking", () => {
  const old = mkJob({ id: 1, state: "failed", retriedAs: 2 });
  const recovered = mkJob({ id: 2, state: "failed", recoveryNeeded: true, error: "Outcome unconfirmed" });
  const store = fakeStore({ list: () => [{ name: "Kame", jobs: [old, recovered], proposals: [] }], get: () => recovered });
  const needs = needsYou(store, []);
  assert.deepEqual(needs.map((n) => n.key), ["failed-2"]);
  assert.match(needs[0]!.text, /Review this attempt/);
  assert.deepEqual(needs[0]!.buttons, []);
  assert.match(answerNeed("r:2", store, { pending: () => [], answer() {} }), /Review the interrupted/);
  assert.deepEqual(store.calls, []);
});

test("an unexpected yes value is a No, never an approval", () => {
  const store = fakeStore();
  answerNeed("p:1:yes", store, { pending: () => [], answer() {} });
  answerNeed("p:1", store, { pending: () => [], answer() {} });
  assert.deepEqual(store.calls, ["rejectPlan:1", "rejectPlan:1"]);
});

// ---- the running bot, over a stubbed fetch ----

type Sent = { method: string; body: any };
async function run(opts: { updates: unknown[][]; store?: any; asks?: any[]; ask?: (t: string) => Promise<string>; after?: (bot: any, h: any) => Promise<void>; wait?: number; steering?: any; log?: any; sendStatus?: () => number; tune?: Record<string, unknown> }) {
  const realFetch = globalThis.fetch;
  const sent: Sent[] = [];
  let polls = 0;
  globalThis.fetch = (async (url: string, init: any) => {
    const method = String(url).split("/").pop()!;
    const body = JSON.parse(init.body);
    if (method === "getUpdates") {
      const batch = opts.updates[polls++];
      if (!batch) await new Promise((r, j) => init.signal.addEventListener("abort", () => j(new Error("aborted"))));
      return { status: 200, json: async () => ({ ok: true, result: batch }) };
    }
    const status = method === "sendMessage" ? (opts.sendStatus?.() ?? 200) : 200;
    if (status !== 200) return { status, json: async () => ({ ok: false, error_code: status }) };
    sent.push({ method, body });
    return { status: 200, json: async () => ({ ok: true, result: true }) };
  }) as any;
  const listeners: ((a: any) => void)[] = [];
  const asks = opts.asks ?? [];
  const asked: string[] = [];
  const bot = startTelegramBot({
    token: "t", chatId: "42", skipBacklog: false, log, helpers: opts.store, describe: (e) => (e as Error).message, ...(opts.steering ? { steering: opts.steering } : {}), ...(opts.log ? { log: opts.log } : {}),
    ...(opts.tune ?? {}),
    ask: opts.ask ?? (async (t) => (asked.push(t), `ATOM:${t}`)),
    approvals: { pending: () => asks, answer() {}, onAsk: (l) => (listeners.push(l), () => {}) },
  });
  try {
    await tick(opts.wait ?? 80);
    await opts.after?.(bot, { listeners, asks, sent });
  } finally {
    bot.stop();
    globalThis.fetch = realFetch;
  }
  return { sent, asked };
}
const text = (id: number, chat: number, t: string) => ({ update_id: id, message: { chat: { id: chat }, from: { id: chat }, text: t } });
const texts = (s: Sent[]) => s.filter((x) => x.method === "sendMessage").map((x) => x.body.text as string);

test("only the allowed chat is served: a stranger's message and button get nothing", async () => {
  const r = await run({
    updates: [[text(1, 999, "hello"), text(2, 999, "/needs"), { update_id: 3, callback_query: { id: "c", data: "p:1:1", message: { chat: { id: 999 } }, from: { id: 999 } } }, text(4, 42, "hi")]],
    store: fakeStore(),
  });
  assert.deepEqual(r.asked, ["hi"]);
  assert.deepEqual(texts(r.sent), ["ATOM:hi"]);
  assert.equal(r.sent.some((s) => s.method === "answerCallbackQuery"), false);
});

test("commands: /help, /needs empty, /report validation, unknown command", async () => {
  const r = await run({ updates: [[text(1, 42, "/help"), text(2, 42, "/needs"), text(3, 42, "/report"), text(4, 42, "/report 99"), text(5, 42, "/needs@zeno_bot"), text(6, 42, "/evil")]], store: fakeStore(), wait: 150 });
  const t = texts(r.sent);
  assert.match(t[0]!, /^I am ATOM/);
  assert.equal(t[1], "Nothing waits for you.");
  assert.match(t[2]!, /Send \/report and a task number/);
  assert.equal(t[3], "Task #99 has no report.");
  assert.equal(t[4], "Nothing waits for you.");
  assert.match(t[5]!, /I do not know that command/);
});

test("a button press from the allowed chat is answered with the result", async () => {
  const store = fakeStore();
  const r = await run({ updates: [[{ update_id: 1, callback_query: { id: "c1", data: "p:3:1", message: { chat: { id: 42 } }, from: { id: 42 } } }]], store });
  assert.deepEqual(store.calls, ["approvePlan:3"]);
  const a = r.sent.find((s) => s.method === "answerCallbackQuery")!;
  assert.deepEqual(a.body, { callback_query_id: "c1", text: "Plan approved." });
});

test("a store error on a button is reported back, not thrown", async () => {
  const store = fakeStore({ retry: () => { throw new Error("cannot retry"); } });
  const r = await run({ updates: [[{ update_id: 1, callback_query: { id: "c", data: "r:1", message: { chat: { id: 42 } }, from: { id: 42 } } }]], store });
  assert.equal(r.sent.find((s) => s.method === "answerCallbackQuery")!.body.text, "cannot retry");
});

test("an ATOM failure is sent as a message; non-text input gets a short note", async () => {
  const r = await run({ updates: [[text(1, 42, "go"), { update_id: 2, message: { chat: { id: 42 }, from: { id: 42 } } }]], store: fakeStore(), ask: async () => { throw new Error("down"); }, wait: 120 });
  assert.deepEqual(texts(r.sent), ["I read text only.", "ATOM could not answer: down"]);
});

test("a long answer is split at 4096", async () => {
  const r = await run({ updates: [[text(1, 42, "big")]], store: fakeStore(), ask: async () => "w".repeat(5000) });
  const t = texts(r.sent);
  assert.equal(t.length, 2);
  assert.ok(t.every((x) => x.length <= 4096));
});

test("push: a new Needs you item is sent once with buttons; setPush(false) stops it; failures are not pushed", async () => {
  const asks: any[] = [];
  const store = fakeStore();
  const r = await run({
    updates: [],
    store,
    asks,
    after: async (bot, h) => {
      asks.push(ask("n1"));
      h.listeners.forEach((l: any) => l(asks[0]));
      await tick(1300);
      assert.equal(texts(h.sent).length, 1);
      assert.match(texts(h.sent)[0]!, /ATOM asks: sum n1/);
      assert.deepEqual(h.sent[0].body.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data), ["a:n1:1", "a:n1:0"]);
      h.listeners.forEach((l: any) => l(asks[0])); // same key again
      await tick(1300);
      assert.equal(texts(h.sent).length, 1, "not sent twice");
      bot.setPush(false);
      asks.push(ask("n2"));
      h.listeners.forEach((l: any) => l(asks[1]));
      await tick(1300);
      assert.equal(texts(h.sent).length, 1, "push off sends nothing");
    },
    wait: 10,
  });
  assert.equal(texts(r.sent).length, 1);
});

test("ADR-110 N3: send(): a later reply always goes; a routine's result follows Send to Telegram", async () => {
  const r = await run({
    updates: [],
    store: fakeStore(),
    after: async (bot) => {
      bot.send("Sid found three flights.", false);
      bot.send("Morning news: calm.", true);
      bot.setPush(false);
      bot.send("Evening news: calm.", true);
      bot.send("Penny wrote the draft.", false);
      await tick(50);
    },
    wait: 10,
  });
  assert.deepEqual(texts(r.sent), ["Sid found three flights.", "Morning news: calm.", "Penny wrote the draft."]);
});

// ---- steering and test results ----

function fakeSteering(how: "live" | "queued" = "live", fail?: Error) {
  const calls: string[] = [];
  return {
    calls,
    steer(id: number, t: string) { calls.push(`steer:${id}:${t}`); if (fail) throw fail; return how; },
    async interrupt(id: number) { calls.push(`interrupt:${id}`); if (fail) throw fail; },
  };
}

test("/steer: live, queued, bad number, empty text, error text", async () => {
  const live = fakeSteering("live");
  const r1 = await run({ updates: [[text(1, 42, "/steer 12 use  the plan"), text(2, 42, "/steer #5 hi")]], store: fakeStore(), steering: live, wait: 150 });
  assert.deepEqual(texts(r1.sent), ["Sent to task #12 now.", "Sent to task #5 now."]);
  assert.deepEqual(live.calls, ["steer:12:use the plan", "steer:5:hi"]);
  const queued = fakeSteering("queued");
  const r2 = await run({ updates: [[text(1, 42, "/steer 3 hi")]], store: fakeStore(), steering: queued });
  assert.deepEqual(texts(r2.sent), ["Kept for task #3. It runs after this step."]);
  const none = fakeSteering();
  const r3 = await run({ updates: [[text(1, 42, "/steer"), text(2, 42, "/steer abc hi"), text(3, 42, "/steer 0 hi")]], store: fakeStore(), steering: none, wait: 150 });
  assert.equal(texts(r3.sent).length, 3);
  assert.ok(texts(r3.sent).every((t) => /^Send \/steer/.test(t)));
  assert.deepEqual(none.calls, []);
  const bad = fakeSteering("live", new Error("The message is empty."));
  const r4 = await run({ updates: [[text(1, 42, "/steer 4")]], store: fakeStore(), steering: bad });
  assert.deepEqual(texts(r4.sent), ["The message is empty."]);
});

test("/interrupt: ok and error; steering off answers for both commands", async () => {
  const ok = fakeSteering();
  const r1 = await run({ updates: [[text(1, 42, "/interrupt 7"), text(2, 42, "/interrupt x")]], store: fakeStore(), steering: ok, wait: 150 });
  const t = texts(r1.sent);
  assert.ok(t.includes("Task #7 stopped. It waits for your message."));
  assert.ok(t.some((x) => /Send \/interrupt/.test(x)));
  const bad = fakeSteering("live", new Error("Only a running task can be interrupted."));
  const r2 = await run({ updates: [[text(1, 42, "/interrupt 7")]], store: fakeStore(), steering: bad });
  assert.deepEqual(texts(r2.sent), ["Only a running task can be interrupted."]);
  const r3 = await run({ updates: [[text(1, 42, "/steer 1 hi"), text(2, 42, "/interrupt 1")]], store: fakeStore(), wait: 150 });
  assert.deepEqual(texts(r3.sent), ["Steering is off.", "Steering is off."]);
});

test("a stranger cannot steer; the log never holds the message text", async () => {
  const steering = fakeSteering();
  const lines: string[] = [];
  const spy = { debug() {}, info: (...a: unknown[]) => void lines.push(JSON.stringify(a)), warn: (...a: unknown[]) => void lines.push(JSON.stringify(a)), error() {} };
  await run({ updates: [[text(1, 999, "/steer 1 nope"), text(2, 42, "/steer 2 SECRETWORDS")]], store: fakeStore(), steering, log: spy, wait: 150 });
  assert.deepEqual(steering.calls, ["steer:2:SECRETWORDS"]);
  assert.ok(lines.some((l) => l.includes("steer")));
  assert.ok(!lines.some((l) => l.includes("SECRETWORDS")));
});

test("needs text: a test line for a soul proposal and a skill edit, nothing without results", () => {
  const res = (better: string, state = "done") => ({ better, state, task: "t", caseId: 1 });
  const store = fakeStore({
    list: () => [{ name: "Scout", jobs: [], routines: [], proposals: [{ id: 7, state: "pending", field: "soul", text: "t", reason: "r" }, { id: 8, state: "pending", field: "soul", text: "t", reason: "r" }] }],
    skillEdits: () => [{ id: 5, state: "pending", skill: "k", reason: "r" }],
    testResults: (kind: string, id: number) => (kind === "soul" && id === 7 ? [res("new"), res("new"), res("same")] : kind === "skill" ? [res("old"), res("", "running")] : []),
  });
  const text = (k: string) => needsYou(store, []).find((n) => n.key === k)!.text;
  assert.match(text("proposal-7"), /\nTest cases: 2 better, 1 same$/);
  assert.doesNotMatch(text("proposal-8"), /Test cases/);
  assert.match(text("skill-edit-5"), /\nTest cases: running…$/);
});

// 2026-10-16 (code review): a failed push was marked as sent before it was sent, so a Wi-Fi blip lost it for good; the turn queue had no
// limit, so one hung answer blocked every later message; and a throw inside a fire-and-forget command was an unhandled rejection.
test("push: a Needs you item whose send failed is tried again later and then arrives, once", async () => {
  const asks: any[] = [];
  let down = true;
  let attempts = 0;
  const waitFor = async (ok: () => boolean) => { for (let i = 0; i < 500 && !ok(); i++) await tick(10); };
  const r = await run({
    updates: [],
    store: fakeStore(),
    asks,
    tune: { retryDelaysMs: [1, 1, 1], pushRetryMs: 60 },
    sendStatus: () => (attempts++, down ? 500 : 200),
    wait: 10,
    after: async (_bot, h) => {
      asks.push(ask("n1"));
      h.listeners.forEach((l: any) => l(asks[0]));
      await waitFor(() => attempts >= 4); // the first round (a try and its three quick retries) failed; five rounds are left
      assert.equal(texts(h.sent).length, 0, "nothing got through while the network was down");
      down = false;
      await waitFor(() => texts(h.sent).length === 1); // the next round
      assert.equal(texts(h.sent).length, 1, "it arrived after the network came back");
      assert.match(texts(h.sent)[0]!, /ATOM asks: sum n1/);
      await tick(400);
      assert.equal(texts(h.sent).length, 1, "and only once");
    },
  });
  assert.equal(texts(r.sent).length, 1);
});

test("a hung answer does not block the next message: the turn is given up on after the limit", async () => {
  let n = 0;
  const r = await run({
    updates: [[text(1, 42, "first")], [text(2, 42, "second")]],
    tune: { turnTimeoutMs: 40 },
    ask: (t) => (++n === 1 ? new Promise<string>(() => {}) : Promise.resolve(`ATOM:${t}`)),
    wait: 400,
  });
  const out = texts(r.sent);
  assert.ok(out.some((m) => /could not answer.*did not answer in/i.test(m)), out.join(" | "));
  assert.ok(out.includes("ATOM:second"), "the second message was answered");
});

test("a command that throws on the way is answered, not an unhandled rejection that ends ATOM", async () => {
  const rejections: unknown[] = [];
  const onRejection = (e: unknown) => rejections.push(e);
  process.on("unhandledRejection", onRejection);
  try {
    const base = fakeStore();
    let reads = 0;
    const store = { ...base, list: () => { if (++reads > 1) throw new Error("database is locked"); return base.list(); } }; // the bot reads the list once when it starts
    const r = await run({ updates: [[text(1, 42, "/needs"), text(2, 42, "/tasks")]], store, wait: 150 });
    assert.equal(rejections.length, 0, "no unhandled rejection");
    assert.ok(texts(r.sent).some((m) => /database is locked|could not/i.test(m)), texts(r.sent).join(" | "));
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

// 2026-10-16 (code check, third review pass).
test("a text that merely starts with a slash is a message for ATOM, not an unknown command", async () => {
  const r = await run({ updates: [[text(1, 42, "/tmp/build.log is huge, why?"), text(2, 42, "/evil"), text(3, 42, "/needs@zeno_bot")]], store: fakeStore(), wait: 150 });
  assert.ok(r.asked.includes("/tmp/build.log is huge, why?"), "reached ATOM");
  const out = texts(r.sent);
  assert.ok(out.some((m) => /I do not know that command/.test(m)), "a real unknown command is still answered");
  assert.ok(out.includes("Nothing waits for you."), "a command with a bot name still works");
});

test("the help list does not promise /interrupt, which native tasks refuse", async () => {
  const r = await run({ updates: [[text(1, 42, "/help")]], store: fakeStore(), wait: 100 });
  const help = texts(r.sent)[0]!;
  assert.ok(help.includes("/steer") && help.includes("/tasks"));
  assert.ok(!help.includes("/interrupt"));
});

test("after stop(), a failed push does not keep timers alive or send again", async () => {
  const asks: any[] = [];
  let sends = 0;
  await run({
    updates: [],
    store: fakeStore(),
    asks,
    tune: { retryDelaysMs: [1], pushRetryMs: 40 },
    sendStatus: () => (sends++, 500),
    wait: 10,
    after: async (bot, h) => {
      asks.push(ask("n1"));
      h.listeners.forEach((l: any) => l(asks[0]));
      await tick(1200); // the push ran and failed
      bot.stop();
      const before = sends;
      await tick(300); // a retry timer left running would send again
      assert.equal(sends, before, "nothing is sent after stop()");
    },
  });
});

test("a store change during the retry wait does not bring the retry forward", async () => {
  const asks: any[] = [];
  const times: number[] = [];
  const store = fakeStore();
  let notify: ((change: unknown) => void) | undefined;
  (store as any).onChange = (l: (change: unknown) => void) => ((notify = l), () => {});
  await run({
    updates: [],
    store,
    asks,
    tune: { retryDelaysMs: [1], pushRetryMs: 600 },
    sendStatus: () => (times.push(Date.now()), 500),
    wait: 10,
    after: async (_bot, h) => {
      asks.push(ask("n1"));
      h.listeners.forEach((l: any) => l(asks[0]));
      const waitFor = async (ok: () => boolean) => { for (let i = 0; i < 300 && !ok(); i++) await tick(10); };
      await waitFor(() => times.length >= 2); // first push: a try and its quick retry fail; the next round is planned 600 ms later
      const n0 = times.length;
      await waitFor(() => times.length >= n0 + 2); // the second round: a try and its quick retry
      const roundStart = times[n0]!;
      const before = times.length;
      notify?.({ action: "job" }); // a change in the store while the third round waits
      await tick(300);
      assert.equal(times.length, before, "the store change did not bring the next round forward");
      await waitFor(() => times.length > before); // the third round arrives on its own timer
      assert.ok(times[before]! - roundStart >= 550, `the next round came at its time, not early: ${times[before]! - roundStart} ms`);
    },
  });
});

test("messages that arrived while ATOM was closed are not run; the user is told once", async () => {
  const r = await run({ updates: [[text(1, 42, "/steer 3 delete everything"), text(2, 42, "hello")], []], store: fakeStore(), wait: 150, tune: { skipBacklog: true } });
  assert.deepEqual(r.asked, [], "nothing ran");
  const out = texts(r.sent);
  assert.equal(out.filter((m) => /was closed/.test(m)).length, 1);
  assert.ok(out.some((m) => /2 messages arrived/.test(m)));
});

// 2026-10-16 (code check): an item whose push failed was added to `known` by a store change during the retry wait, and was then never tried again.
test("a failed push is still tried again after a store change during the wait", async () => {
  const asks: any[] = [];
  let sends = 0;
  const store = fakeStore();
  let notify: ((change: unknown) => void) | undefined;
  (store as any).onChange = (l: (change: unknown) => void) => ((notify = l), () => {});
  await run({
    updates: [],
    store,
    asks,
    tune: { retryDelaysMs: [1], pushRetryMs: 300 },
    sendStatus: () => (sends++ < 2 ? 500 : 200), // the first round (a try and its quick retry) fails; later sends work
    wait: 10,
    after: async (_bot, h) => {
      asks.push(ask("n9"));
      h.listeners.forEach((l: any) => l(asks[0]));
      for (let i = 0; i < 300 && sends < 2; i++) await tick(10);
      notify?.({ action: "job" }); // a store change while the retry waits
      for (let i = 0; i < 300 && sends < 3; i++) await tick(10);
      assert.ok(sends >= 3, "the item was sent again after the wait");
    },
  });
});

// 2026-10-16: an answer that Telegram did not get was lost; now it waits in an outbox and is sent again.
test("an answer that failed to send is sent again later, once, in order", async () => {
  let down = true;
  let attempts = 0;
  const waitFor = async (ok: () => boolean) => { for (let i = 0; i < 500 && !ok(); i++) await tick(10); };
  const r = await run({
    updates: [[text(1, 42, "hello")]],
    store: fakeStore(),
    tune: { retryDelaysMs: [1], pushRetryMs: 60 },
    sendStatus: () => (attempts++, down ? 500 : 200),
    wait: 10,
    after: async (_bot, h) => {
      await waitFor(() => attempts >= 2); // the answer and its quick retry failed
      assert.equal(texts(h.sent).length, 0, "nothing got through while the network was down");
      down = false;
      await waitFor(() => texts(h.sent).length === 1);
      assert.match(texts(h.sent)[0]!, /ATOM:hello/);
      await tick(300);
      assert.equal(texts(h.sent).length, 1, "and only once");
    },
  });
  assert.equal(texts(r.sent).length, 1);
});
