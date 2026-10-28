import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIFFICULTY_QUESTION,
  LayaMissingError,
  createLayaEngine,
  layaServerPath,
  readScore,
  tierFromScore,
  type LayaClient,
  type LayaConnect,
} from "./index.ts";

const answer = (score: number) => ({ content: [{ type: "text", text: JSON.stringify({ answers: { difficulty: { score } } }) }] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake Laya: counts starts, records what it was asked, and can crash, fail or be slow. */
function fakeLaya(opts: { score?: number; startMs?: number; predictMs?: number; startError?: Error; predictError?: Error } = {}) {
  const asked: { state: Record<string, string>; questions: object }[] = [];
  const crashes: (() => void)[] = [];
  let starts = 0;
  let closes = 0;
  const connect: LayaConnect = async (onCrash) => {
    starts += 1;
    crashes.push(onCrash);
    if (opts.startMs) await wait(opts.startMs);
    if (opts.startError) throw opts.startError;
    const client: LayaClient = {
      async predict(state, questions, signal) {
        asked.push({ state, questions });
        if (opts.predictMs) await wait(opts.predictMs);
        if (signal.aborted) throw new Error("aborted");
        if (opts.predictError) throw opts.predictError;
        return answer(opts.score ?? 1);
      },
      async close() {
        closes += 1;
      },
    };
    return client;
  };
  return {
    connect,
    asked,
    starts: () => starts,
    closes: () => closes,
    crash: () => crashes.at(-1)!(),
    set: (o: Partial<typeof opts>) => Object.assign(opts, o),
  };
}

test("ADR-083 thresholds: below 0.75 small, below 2.25 medium, else large; the label is the nearest rung", () => {
  const cases: [number, string, string][] = [
    [0.16, "small", "trivial"],
    [0.74, "small", "easy"],
    [0.75, "medium", "easy"],
    [1.66, "medium", "moderate"],
    [2.24, "medium", "moderate"],
    [2.25, "large", "moderate"],
    [2.67, "large", "hard"],
    [-0.4, "small", "trivial"],
    [3.9, "large", "hard"],
  ];
  for (const [score, tier, label] of cases) assert.deepEqual(tierFromScore(score), { tier, label }, String(score));
});

test("readScore reads content[0].text and refuses errors and junk", () => {
  assert.equal(readScore(answer(1.92)), 1.92);
  assert.throws(() => readScore({ isError: true, content: [{ text: "boom" }] }));
  assert.throws(() => readScore({ content: [] }));
  assert.throws(() => readScore({ content: [{ text: "not json" }] }));
  assert.throws(() => readScore({ content: [{ text: JSON.stringify({ answers: {} }) }] }));
  assert.throws(() => readScore(null));
});

test("the server path: ATOM_LAYA_SERVER wins, else ~/laya/.venv/bin/laya-mcp-server", () => {
  assert.equal(layaServerPath({ ATOM_LAYA_SERVER: "/x/laya" }), "/x/laya");
  assert.match(layaServerPath({}), /laya\/\.venv\/bin\/laya-mcp-server$/);
});

test("starts lazily on the first job, keeps one warm session, and asks the difficulty question with the task as `request`", async () => {
  const laya = fakeLaya({ score: 0.16 });
  const engine = createLayaEngine({ connect: laya.connect, env: {} });
  assert.equal(laya.starts(), 0, "nothing starts before a job");
  assert.deepEqual(await engine.chooseTier("What year was TCP/IP adopted?", "researcher"), { tier: "small", label: "trivial", score: 0.16, source: "laya" });
  laya.set({ score: 2.67 });
  assert.deepEqual(await engine.chooseTier("Refactor auth", "coder"), { tier: "large", label: "hard", score: 2.67, source: "laya" });
  assert.equal(laya.starts(), 1);
  assert.deepEqual(laya.asked[0], { state: { request: "What year was TCP/IP adopted?" }, questions: DIFFICULTY_QUESTION });
  await engine.close();
});

test("a slow first start falls back for that job but keeps starting, and the next job uses it", async () => {
  const laya = fakeLaya({ startMs: 60, score: 1.2 });
  const engine = createLayaEngine({ connect: laya.connect, env: {}, timeoutMs: 20 });
  const t = Date.now();
  assert.deepEqual(await engine.chooseTier("a", "researcher"), { tier: "medium", source: "fallback" });
  assert.ok(Date.now() - t < 55, "the job did not wait for the start");
  await wait(60);
  assert.deepEqual(await engine.chooseTier("b", "researcher"), { tier: "medium", label: "easy", score: 1.2, source: "laya" });
  assert.equal(laya.starts(), 1);
  await engine.close();
});

test("a slow or failed answer falls back without dropping the warm session", async () => {
  const laya = fakeLaya({ predictMs: 50 });
  const engine = createLayaEngine({ connect: laya.connect, env: {}, timeoutMs: 20 });
  assert.equal((await engine.chooseTier("a", "x")).source, "fallback");
  laya.set({ predictMs: 0, predictError: new Error("bad") });
  assert.equal((await engine.chooseTier("b", "x")).source, "fallback");
  laya.set({ predictError: undefined, score: 0.3 });
  assert.equal((await engine.chooseTier("c", "x")).source, "laya");
  assert.equal(laya.starts(), 1);
  await engine.close();
});

test("after a crash it restarts once; a second crash turns Laya off for good", async () => {
  const laya = fakeLaya();
  const engine = createLayaEngine({ connect: laya.connect, env: {} });
  await engine.chooseTier("a", "x");
  laya.crash();
  assert.equal((await engine.chooseTier("b", "x")).source, "laya");
  assert.equal(laya.starts(), 2);
  laya.crash();
  assert.deepEqual(await engine.chooseTier("c", "x"), { tier: "medium", source: "fallback" });
  assert.equal(laya.starts(), 2, "no third start");
  await engine.close();
});

test("a start that fails is retried once, then never again", async () => {
  const laya = fakeLaya({ startError: new Error("exit 1") });
  const engine = createLayaEngine({ connect: laya.connect, env: {} });
  for (const t of ["a", "b", "c", "d"]) assert.equal((await engine.chooseTier(t, "x")).source, "fallback");
  assert.equal(laya.starts(), 2);
});

test("a missing server falls back at once and is not tried again every job", async () => {
  const laya = fakeLaya({ startError: new LayaMissingError("/nope") });
  const engine = createLayaEngine({ connect: laya.connect, env: {} });
  assert.equal((await engine.chooseTier("a", "x")).source, "fallback");
  assert.equal((await engine.chooseTier("b", "x")).source, "fallback");
  assert.equal(laya.starts(), 1);
});

test("the real connect reports a missing program as LayaMissingError", async () => {
  const engine = createLayaEngine({ env: { ATOM_LAYA_SERVER: "/nonexistent/laya-mcp-server" } });
  assert.deepEqual(await engine.chooseTier("a", "x"), { tier: "medium", source: "fallback" });
  await engine.close();
});

test("ATOM_LAYA=0 never starts Laya", async () => {
  const laya = fakeLaya();
  const engine = createLayaEngine({ connect: laya.connect, env: { ATOM_LAYA: "0" } });
  assert.equal((await engine.chooseTier("a", "x")).source, "fallback");
  assert.equal(laya.starts(), 0);
});

test("close stops the server; later jobs fall back; a start still under way is stopped when it arrives", async () => {
  const laya = fakeLaya();
  const engine = createLayaEngine({ connect: laya.connect, env: {} });
  await engine.chooseTier("a", "x");
  await engine.close();
  assert.equal(laya.closes(), 1);
  assert.equal((await engine.chooseTier("b", "x")).source, "fallback");
  assert.equal(laya.starts(), 1);

  const slow = fakeLaya({ startMs: 40 });
  const other = createLayaEngine({ connect: slow.connect, env: {}, timeoutMs: 10 });
  await other.chooseTier("a", "x"); // times out while starting
  await other.close();
  await wait(50);
  assert.equal(slow.closes(), 1);
});

test("warm() starts the server ahead of the first job, so a slow start no longer makes that job fall back", async () => {
  const laya = fakeLaya({ score: 0.16, startMs: 40 });
  const engine = createLayaEngine({ connect: laya.connect, env: {}, timeoutMs: 20 });
  engine.warm();
  engine.warm();
  await wait(60);
  assert.equal(laya.starts(), 1, "warming twice starts once");
  assert.equal((await engine.chooseTier("What year was TCP/IP adopted?", "researcher")).source, "laya");
  await engine.close();
  engine.warm();
  assert.equal(laya.starts(), 1, "nothing starts after close");
});

// 2026-10-16 (review): `failures` never reset, so a second crash days after the first still turned Laya off until ATOM restarted.
test("a crash after a long healthy session is a first failure again; two quick crashes still turn Laya off", async () => {
  const laya = fakeLaya();
  const engine = createLayaEngine({ connect: laya.connect, env: {}, stableMs: 30 });
  await engine.chooseTier("a", "x");
  laya.crash(); // the first crash, soon after it started
  assert.equal((await engine.chooseTier("b", "x")).source, "laya", "restarted");
  await wait(60); // the restarted session stays up longer than the stable time
  laya.crash(); // a crash long after the last one: a first failure again, not a second
  assert.equal((await engine.chooseTier("c", "x")).source, "laya", "restarted again");
  assert.equal(laya.starts(), 3);
  await engine.close();
});
