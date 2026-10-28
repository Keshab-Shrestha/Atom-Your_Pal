import { test } from "node:test";
import assert from "node:assert/strict";
import { createComputerTool } from "./tool.ts";
import type { CuaTransport, CuaResult } from "./cua-client.ts";

const ok = (data: Record<string, unknown>): CuaResult => ({ data, text: "ok", isError: false, refusal: undefined });
const step = (button: string, value: string) => ({ button, expect: { label: "Result", value } });

/** Snapshot numbers deliberately change so passing a previous element/token cannot succeed. */
function fixture(options: { effect?: string; noChange?: boolean; duplicateButton?: boolean; duplicateReading?: boolean; disabled?: boolean; wrongOwner?: boolean; failRead?: boolean; restartRead?: boolean; cancel?: AbortController } = {}, choosePlan?: Parameters<typeof createComputerTool>[0]["choosePlan"]) {
  let generation = 1, snapshot = 0, value = "0";
  const calls: Array<{ name: string; args: Record<string, unknown>; generation?: number }> = [];
  const progress: unknown[] = [], starts: unknown[] = [], finished: unknown[] = [];
  const cua: CuaTransport = {
    get generation() { return generation; },
    async close() {},
    async call(name, args, signal, expectedGeneration) {
      if (signal?.aborted) throw new Error("Cancelled.");
      if (expectedGeneration !== undefined && generation !== expectedGeneration) throw new Error("Session changed.");
      calls.push({ name, args, generation: expectedGeneration });
      if (name === "list_apps") return ok({ apps: [{ name: "TextEdit", pid: 11, bundle_id: "com.apple.TextEdit", running: true }] });
      if (name === "list_windows") return ok({ windows: [{ app_name: "TextEdit", pid: 11, window_id: 7, is_on_screen: true }] });
      if (name === "get_window_state") {
        snapshot++;
        if (snapshot > 1 && options.failRead) throw new Error("read failed");
        if (snapshot > 1 && options.restartRead) generation++;
        if (snapshot > 1) options.cancel?.abort();
        const button = { element_index: snapshot * 10, element_token: `s${snapshot}`, role: "AXButton", label: "Next", enabled: !options.disabled };
        return { ...ok({ pid: options.wrongOwner && snapshot > 1 ? 22 : 11, window_id: 7, app_name: "TextEdit", elements: [button, ...(options.duplicateButton ? [{ ...button, element_index: 999 }] : [])], tree_markdown: `- AXStaticText = ${JSON.stringify(value)} (Result)\n${options.duplicateReading ? '- AXStaticText = "other" (Result)' : ''}` }), images: [{ mimeType: "image/png", data: `image-${snapshot}` }] };
      }
      if (name === "click") {
        assert.equal(args.element_token, `s${snapshot}`);
        if (!options.noChange) value = String(Number(value) + 1);
        return ok({ effect: options.effect ?? "unverifiable" });
      }
      throw new Error(`Unexpected ${name}`);
    },
  };
  const tool = createComputerTool({ cua, choosePlan, approve: async () => { throw new Error("Sequence must not bundle an approval"); }, onStep: (e) => starts.push(e), onProgress: (e) => progress.push(e), onAction: (e) => finished.push(e) });
  const look = () => tool.run({ action: "look", app: "TextEdit", window_id: 7 });
  const run = async (steps: unknown = [step("Next", "1"), step("Next", "2")], signal?: AbortSignal, extra = {}) => tool.run({ action: "click_sequence", steps, ...extra }, signal);
  return { tool, calls, look, run, progress, starts, finished, restart: () => generation++ };
}

const text = (v: Awaited<ReturnType<ReturnType<typeof fixture>["run"]>>) => typeof v === "string" ? v : v.text;
const clicks = (f: ReturnType<typeof fixture>) => f.calls.filter((c) => c.name === "click");

test("checked sequence re-resolves fresh buttons, pins ownership/mode and returns only the final window image", async () => {
  const f = fixture();
  await f.look();
  const result = await f.run(undefined, undefined, { mode: "background" });
  assert.match(text(result), /2\/2 clicks passed exact labelled-value checks/);
  assert.match(text(result), /2 clicks were driver-unconfirmed/);
  assert.deepEqual(clicks(f).map((c) => c.args), ["s1", "s2"].map((token) => ({ pid: 11, window_id: 7, element_token: token, delivery_mode: "background" })));
  assert.ok(clicks(f).every((c) => c.generation === 1));
  assert.equal(f.calls.filter((c) => c.name === "get_window_state").length, 3);
  assert.deepEqual(typeof result === "object" && result.images, [{ mimeType: "image/png", data: "image-3" }]);
  assert.equal(f.starts.length, 2); // look + one sequence, never a new lifecycle per subclick
  assert.equal(f.finished.length, 2);
  assert.deepEqual(f.progress, [1, 2].map((current) => ({ action: "click", app: "TextEdit", current, total: 2 })));
  assert.doesNotMatch(JSON.stringify(f.finished), /Result|Next|image-3/);
});

test("sequence preflights every step and delivery mode before any input/progress", async () => {
  const invalid = [[], Array.from({ length: 9 }, () => step("Next", "1")), [step("Next", "1"), { button: "Next", expect: { label: "Result", value: 2 } }], [step("Next", "1"), { ...step("Next", "2"), keys: ["return"] }], [step("Next", "1"), step("Send", "2")], [step("Next", "1"), step("Delete", "2")], [{ button: "Next", expect: { label: "Password", value: "secret" } }]];
  for (const steps of invalid) {
    const f = fixture(); await f.look();
    await assert.rejects(f.run(steps));
    assert.equal(clicks(f).length, 0);
    assert.equal(f.progress.length, 0);
    assert.equal(f.starts.length, 1);
  }
  const f = fixture(); await f.look();
  await assert.rejects(f.run(undefined, undefined, { mode: "fast" }), /mode must be/);
  assert.equal(clicks(f).length, 0);
});

test("mismatch, ambiguous readings and unchanged unconfirmed input halt the remainder", async () => {
  for (const options of [{}, { duplicateReading: true }, { noChange: true }]) {
    const f = fixture(options); await f.look();
    const result = await f.run([step("Next", options.noChange ? "0" : "wrong"), step("Next", "2")]);
    assert.match(text(result), /Sequence stopped at click 1\/2/);
    assert.equal(clicks(f).length, 1);
    assert.deepEqual(f.finished.at(-1), { action: "click_sequence", app: "TextEdit", ok: false, reason: "sequence_stopped", imageCount: 1 });
  }
});

test("suspected no-op or unknown driver effect cannot authorize a following click even if the value matches", async () => {
  for (const effect of ["suspected_noop", "unknown"]) {
    const f = fixture({ effect }); await f.look();
    assert.match(text(await f.run()), /Sequence stopped at click 1\/2/);
    assert.equal(clicks(f).length, 1);
  }
});

test("missing, duplicate and disabled buttons are never clicked", async () => {
  for (const options of [{ duplicateButton: true }, { disabled: true }, {}]) {
    const f = fixture(options); await f.look();
    const result = await f.run([step(options.duplicateButton || options.disabled ? "Next" : "Missing", "1")]);
    assert.match(text(result), /missing, ambiguous or disabled/);
    assert.equal(clicks(f).length, 0);
  }
});

test("cancel after a fresh observation sends no remaining input; pre-cancel sends no input", async () => {
  const controller = new AbortController();
  const f = fixture({ cancel: controller }); await f.look();
  await assert.rejects(f.run(undefined, controller.signal), /Sequence stopped at click 1\/2.*Cancelled/);
  assert.equal(clicks(f).length, 1);
  const before = fixture(); await before.look();
  await assert.rejects(before.run(undefined, controller.signal), /Cancelled/);
  assert.equal(clicks(before).length, 0);
});

test("ownership, generation and post-input read failure stop without replay and invalidate the target", async () => {
  for (const options of [{ wrongOwner: true }, { failRead: true }, { restartRead: true }]) {
    const f = fixture(options); await f.look();
    await assert.rejects(f.run(), /Sequence stopped at click 1\/2.*No remaining clicks were sent/);
    assert.equal(clicks(f).length, 1);
    await assert.rejects(async () => f.tool.run({ action: "click", element: 10 }), /Look at an app first/);
    assert.equal(clicks(f).length, 1);
  }
  const f = fixture(); await f.look(); f.restart();
  await assert.rejects(f.run(), /Look at an app first/);
  assert.equal(clicks(f).length, 0);
});


test("fast selector executes only one prepared checked plan and shares no editable values or images", async () => {
  const seen: unknown[] = [];
  const f = fixture({}, async (request) => { seen.push(request); return { index: 0, source: "laya" }; });
  await f.look();
  const result = await f.tool.run({ action: "choose_sequence", goal: "Do the fictional first plan", plans: [
    { description: "First plan", steps: [step("Next", "1"), step("Next", "2")] },
    { description: "Other plan", steps: [step("Next", "other")] },
  ] });
  assert.match(text(result), /selected by laya/);
  assert.match(text(result), /2\/2 clicks passed/);
  assert.equal(clicks(f).length, 2);
  assert.equal(seen.length, 1);
  assert.doesNotMatch(JSON.stringify(seen), /image-|element_token|s1/);
});

test("off/uncertain/out-of-range/cancelled fast decisions send no input; every candidate is prevalidated", async () => {
  for (const selected of [undefined, { index: 9, source: "jev" as const }]) {
    const f = fixture({}, async () => selected); await f.look();
    const result = await f.tool.run({ action: "choose_sequence", goal: "fictional", plans: [0, 1].map((n) => ({ description: `Plan ${n}`, steps: [step("Next", "1")] })) });
    assert.match(text(result), /No input was sent/); assert.equal(clicks(f).length, 0);
  }
  let asked = false;
  const f = fixture({}, async () => { asked = true; return { index: 0, source: "jev" }; }); await f.look();
  await assert.rejects(async () => f.tool.run({ action: "choose_sequence", goal: "fictional", plans: [{ description: "Good", steps: [step("Next", "1")] }, { description: "Bad", steps: [step("Send", "sent")] }] }));
  assert.equal(asked, false); assert.equal(clicks(f).length, 0);
  const controller = new AbortController();
  const cancelled = fixture({}, async () => { controller.abort(); return { index: 0, source: "jev" }; }); await cancelled.look();
  await assert.rejects(async () => cancelled.tool.run({ action: "choose_sequence", goal: "fictional", plans: [0, 1].map((n) => ({ description: `Plan ${n}`, steps: [step("Next", "1")] })) }, controller.signal), /Cancelled/);
  assert.equal(clicks(cancelled).length, 0);
});


test("fast decision declines explain uncertainty separately from availability without authorizing input", async () => {
  for (const reason of ["uncertain", "unavailable"] as const) {
    const f = fixture({}, async () => ({ source: "laya", reason })); await f.look();
    const result = await f.tool.run({ action: "choose_sequence", goal: "fictional", plans: [0, 1].map((n) => ({ description: `Plan ${n}`, steps: [step("Next", "1")] })) });
    assert.match(text(result), reason === "uncertain" ? /could not confidently choose/ : /unavailable or exceeded/);
    assert.match(text(result), /No input was sent/); assert.equal(clicks(f).length, 0);
  }
});
