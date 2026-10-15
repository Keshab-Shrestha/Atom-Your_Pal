import { test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGE_LIMIT, splitMessage, startTelegram, type TelegramInput } from "./telegram.ts";

// ADR-098: the Telegram client, with a scripted fake fetch. No network.

const TOKEN = "123:SECRET-TOKEN";
type Call = { method: string; body: any; url: string };

function harness(script: (call: Call, n: number) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const inputs: TelegramInput[] = [];
  const log = { debug() {}, info: (e: string, f?: unknown) => logs.push(JSON.stringify([e, f])), warn: (e: string, f?: unknown) => logs.push(JSON.stringify([e, f])), error() {} } as any;
  const fetchFn = (async (url: string, init: any) => {
    const call = { url, method: url.split("/").pop()!, body: JSON.parse(init.body) };
    calls.push(call);
    const out: any = await script(call, calls.length);
    if (out instanceof Error) throw out;
    return { status: out.status ?? 200, json: async () => out.json ?? { ok: true, result: out.result ?? [] } };
  }) as unknown as typeof fetch;
  const client = startTelegram({ token: TOKEN, chatId: "42", log, onInput: (i) => inputs.push(i), fetch: fetchFn });
  return { calls, logs, inputs, client };
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const msg = (update_id: number, chat: number, text: string) => ({ update_id, message: { chat: { id: chat }, text } });

test("splitMessage: limit, line breaks, empty text", () => {
  assert.deepEqual(splitMessage("hello"), ["hello"]);
  assert.deepEqual(splitMessage("   "), ["…"]);
  const exact = "a".repeat(MESSAGE_LIMIT);
  assert.deepEqual(splitMessage(exact), [exact]);
  const over = splitMessage("a".repeat(MESSAGE_LIMIT + 1));
  assert.deepEqual(over.map((p) => p.length), [MESSAGE_LIMIT, 1]);
  const lines = `${"a".repeat(3000)}\n${"b".repeat(3000)}`;
  assert.deepEqual(splitMessage(lines), ["a".repeat(3000), "b".repeat(3000)]);
  const long = splitMessage("x".repeat(10_000));
  assert.ok(long.every((p) => p.length <= MESSAGE_LIMIT));
  assert.equal(long.join(""), "x".repeat(10_000));
});

test("polling: offset moves past each update id; other chats are ignored", async () => {
  let n = 0;
  const h = harness(async (c) => {
    if (c.method !== "getUpdates") return {};
    n++;
    if (n === 1) return { result: [msg(10, 42, "hi"), msg(11, 999, "intruder"), { update_id: 12, callback_query: { id: "q", data: "a:1:1", message: { chat: { id: 42 } } } }] };
    if (n === 2) return { result: [{ update_id: 13, callback_query: { id: "q2", data: "x", message: { chat: { id: 7 } } } }] };
    await tick(1000);
    return {};
  });
  await tick(100);
  h.client.stop();
  const polls = h.calls.filter((c) => c.method === "getUpdates");
  assert.deepEqual(polls.slice(0, 3).map((c) => c.body.offset), [0, 13, 14]);
  assert.deepEqual(polls[0]!.body.allowed_updates, ["message", "callback_query"]);
  assert.deepEqual(h.inputs, [{ kind: "text", text: "hi" }, { kind: "button", data: "a:1:1", queryId: "q" }]);
  assert.ok(h.logs.some((l) => l.includes("telegram.ignored")));
});

test("an update with no chat (e.g. edited_message) is ignored, not served", async () => {
  let n = 0;
  const h = harness(async (c) => {
    if (c.method !== "getUpdates") return {};
    if (++n === 1) return { result: [{ update_id: 1, edited_message: { chat: { id: 42 }, text: "x" } }, { update_id: 2, callback_query: { id: "q", data: "d" } }] };
    await tick(1000);
    return {};
  });
  await tick(60);
  h.client.stop();
  assert.deepEqual(h.inputs, []);
});

test("poll error: logs the code only (never the token), backs off, then recovers", async () => {
  let n = 0;
  const h = harness(async (c) => {
    if (c.method !== "getUpdates") return {};
    n++;
    if (n === 1) return new Error(`fetch failed for https://api.telegram.org/bot${TOKEN}/getUpdates`);
    if (n === 2) return { result: [msg(5, 42, "back")] };
    await tick(1000);
    return {};
  });
  await tick(1300);
  h.client.stop();
  assert.deepEqual(h.inputs, [{ kind: "text", text: "back" }]);
  const all = h.logs.join("\n");
  assert.ok(all.includes("telegram.poll_failed") && all.includes('"retryMs":1000'));
  assert.ok(!all.includes("SECRET-TOKEN"));
});

test("API error responses (ok:false) count as failures with the error code", async () => {
  const h = harness(async (c) => (c.method === "getUpdates" ? { status: 409, json: { ok: false, error_code: 409 } } : {}));
  await tick(50);
  h.client.stop();
  assert.ok(h.logs.some((l) => l.includes("poll_failed") && l.includes("409")));
});

test("send: splits long text, buttons on the last part only, targets the one chat", async () => {
  const h = harness(async (c) => (c.method === "getUpdates" ? (await tick(1000), {}) : {}));
  await h.client.send("y".repeat(MESSAGE_LIMIT + 10), [[{ text: "Yes", data: "a:1:1" }]]);
  h.client.stop();
  const sends = h.calls.filter((c) => c.method === "sendMessage");
  assert.equal(sends.length, 2);
  assert.ok(sends.every((s) => s.body.chat_id === "42" && s.body.text.length <= MESSAGE_LIMIT));
  assert.equal(sends[0]!.body.reply_markup, undefined);
  assert.deepEqual(sends[1]!.body.reply_markup, { inline_keyboard: [[{ text: "Yes", callback_data: "a:1:1" }]] });
  assert.ok(sends[0]!.url.includes(`/bot${TOKEN}/`));
});

test("send failure is logged and swallowed, and stops after the failed part", async () => {
  const h = harness(async (c) => {
    if (c.method === "getUpdates") return await tick(1000), {};
    return { status: 400, json: { ok: false, error_code: 400 } };
  });
  await h.client.send("z".repeat(MESSAGE_LIMIT * 2 + 5));
  h.client.stop();
  assert.equal(h.calls.filter((c) => c.method === "sendMessage").length, 1);
  assert.ok(h.logs.some((l) => l.includes("send_failed") && l.includes("400")));
});

test("answer: toast cut to 200 characters; failure is swallowed", async () => {
  const h = harness(async (c) => (c.method === "getUpdates" ? (await tick(1000), {}) : { status: 400, json: { ok: false } }));
  await h.client.answer("qid", "t".repeat(500));
  h.client.stop();
  const a = h.calls.find((c) => c.method === "answerCallbackQuery")!;
  assert.equal(a.body.callback_query_id, "qid");
  assert.equal(a.body.text.length, 200);
  assert.ok(h.logs.some((l) => l.includes("answer_failed")));
});

// 2026-10-16 (code review): send() gave up after one failure, so a Wi-Fi blip at the wrong moment lost a plan or an approval request for good.
function flaky(failures: Array<{ status: number; json?: unknown } | Error>, waits: number[]) {
  const calls: Call[] = [];
  let sends = 0;
  const fetchFn = (async (url: string, init: any) => {
    const call = { url, method: url.split("/").pop()!, body: JSON.parse(init.body) };
    calls.push(call);
    if (call.method === "getUpdates") {
      await new Promise((_, j) => init.signal.addEventListener("abort", () => j(new Error("aborted"))));
    }
    const failure = failures[sends++];
    if (failure instanceof Error) throw failure;
    if (failure) return { status: failure.status, json: async () => failure.json ?? { ok: false, error_code: failure.status } };
    return { status: 200, json: async () => ({ ok: true, result: true }) };
  }) as unknown as typeof fetch;
  const logs: string[] = [];
  const log = { debug() {}, info: (e: string, f?: unknown) => logs.push(JSON.stringify([e, f])), warn: (e: string, f?: unknown) => logs.push(JSON.stringify([e, f])), error() {} } as never;
  const client = startTelegram({ token: TOKEN, chatId: "42", log, onInput: () => {}, fetch: fetchFn, sleep: async (ms) => void waits.push(ms) });
  return { client, calls, logs };
}
const sendCalls = (calls: Call[]) => calls.filter((c) => c.method === "sendMessage");

test("send: a server error or a network error is retried and the message gets through", async () => {
  const waits: number[] = [];
  const f = flaky([{ status: 500 }, new TypeError("fetch failed"), { status: 502 }], waits);
  assert.equal(await f.client.send("plan waits"), true);
  f.client.stop();
  assert.equal(sendCalls(f.calls).length, 4, "three failures, then the delivery");
  assert.deepEqual(waits, [1000, 3000, 9000], "waits grow");
  assert.ok(!f.logs.join("").includes("SECRET-TOKEN"));
});

test("send: a rate limit waits as long as Telegram says (cut to 30 s), and 4xx errors are not retried", async () => {
  const waits: number[] = [];
  const f = flaky([{ status: 429, json: { ok: false, error_code: 429, parameters: { retry_after: 7 } } }, { status: 429, json: { ok: false, error_code: 429, parameters: { retry_after: 500 } } }], waits);
  assert.equal(await f.client.send("hi"), true);
  assert.deepEqual(waits, [7000, 30_000]);
  const waits2: number[] = [];
  const g = flaky([{ status: 403 }], waits2);
  assert.equal(await g.client.send("hi"), false, "the bot was blocked or the chat is wrong: retrying cannot help");
  assert.equal(sendCalls(g.calls).length, 1);
  assert.deepEqual(waits2, []);
  f.client.stop();
  g.client.stop();
});

test("send: after the last retry it reports false; a long message resends only the part that failed", async () => {
  const f = flaky([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }], []);
  assert.equal(await f.client.send("never arrives"), false);
  assert.equal(sendCalls(f.calls).length, 4, "the first try and three retries");
  f.client.stop();
  const g = flaky([undefined as never, { status: 500 }], []);
  assert.equal(await g.client.send("p".repeat(MESSAGE_LIMIT + 5)), true);
  const parts = sendCalls(g.calls).map((c) => c.body.text.length);
  assert.deepEqual(parts, [MESSAGE_LIMIT, 5, 5], "part 1 once; part 2 failed once and was sent again");
  g.client.stop();
});
