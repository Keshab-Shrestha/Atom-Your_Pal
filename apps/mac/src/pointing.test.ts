import { test } from "node:test";
import assert from "node:assert/strict";
import type { Core, HandleHooks } from "@atom/core";
import type { PointTarget, ScreenShot } from "@atom/tool-engine";
import { withPointing } from "./pointing.ts";

const main: ScreenShot = { width: 1280, height: 720, display: { x: 0, y: 0, width: 1920, height: 1080 } };

/** A Core that streams `pieces` (if given) and answers with `reply`; `during` runs while it "thinks" (the tool call). */
function fakeCore(reply: string, pieces?: string[], during?: () => void): Core {
  return {
    sessionId: "s1",
    history: () => [],
    reset() {},
    resume() {},
    prepare() {},
    async handle(_input, _signal, hooks?: HandleHooks) {
      during?.();
      for (const p of pieces ?? []) hooks?.onText?.(p);
      return { requestId: "r1", text: reply };
    },
  };
}

function setup(core: Core) {
  let shot: ScreenShot | undefined;
  const points: PointTarget[] = [];
  const logged: unknown[] = [];
  const wrapped = withPointing(core, {
    takeShot: () => {
      const s = shot;
      shot = undefined;
      return s;
    },
    point: (t) => points.push(t),
    log: (e) => logged.push(e),
  });
  return { wrapped, points, logged, setShot: (s: ScreenShot) => (shot = s) };
}

test("a pointing reply is spoken and shown without its marker, and Pal is sent to the place", async () => {
  let ctx!: ReturnType<typeof setup>;
  const core = fakeCore("It's the fan icon, top right. [POINT:1200,10:the fan icon]", ["It's the fan icon, top right. [PO", "INT:1200,10:the fan icon]"], () => ctx.setShot(main));
  ctx = setup(core);
  let spoken = "";
  const answer = await ctx.wrapped.handle({ text: "where's the fan?", source: "voice" }, undefined, { onText: (d) => (spoken += d) });
  assert.equal(answer.text, "It's the fan icon, top right.");
  assert.equal(spoken, "It's the fan icon, top right. ");
  assert.deepEqual(ctx.points, [{ x: 1800, y: 15, label: "the fan icon" }]);
  assert.deepEqual(ctx.logged, [{ marker: "point" }]);
});

test("a malformed marker is dropped silently: not spoken, not shown, no pointing", async () => {
  let ctx!: ReturnType<typeof setup>;
  ctx = setup(fakeCore("Top right. [POINT:9999,10:x]", ["Top right. [POINT:9999,10:x]"], () => ctx.setShot(main)));
  let spoken = "";
  const answer = await ctx.wrapped.handle({ text: "where?", source: "text" }, undefined, { onText: (d) => (spoken += d) });
  assert.equal(answer.text, "Top right.");
  assert.equal(spoken, "Top right. ");
  assert.deepEqual(ctx.points, []);
  assert.deepEqual(ctx.logged, [{ marker: "bad" }]);
});

test("a screenshot from an earlier turn does not count: a marker with no screenshot this turn points nowhere", async () => {
  const ctx = setup(fakeCore("There. [POINT:10,10:x]"));
  ctx.setShot(main); // left over from before this turn
  const answer = await ctx.wrapped.handle({ text: "and now?", source: "voice" });
  assert.equal(answer.text, "There.");
  assert.deepEqual(ctx.points, []);
});

test("an answer that was only a marker still says something", async () => {
  let ctx!: ReturnType<typeof setup>;
  ctx = setup(fakeCore("[POINT:640,360:the button]", undefined, () => ctx.setShot(main)));
  assert.equal((await ctx.wrapped.handle({ text: "where?", source: "voice" })).text, "It's the button.");
  ctx = setup(fakeCore("[POINT:none]"));
  assert.equal((await ctx.wrapped.handle({ text: "where?", source: "voice" })).text, "I can't see it on the screen.");
});

test("a reply without a marker passes through unchanged, and the rest of the Core is the same Core", async () => {
  const core = fakeCore("It is nine.", ["It is ", "nine."]);
  const ctx = setup(core);
  let spoken = "";
  assert.deepEqual(await ctx.wrapped.handle({ text: "time?", source: "voice" }, undefined, { onText: (d) => (spoken += d) }), { requestId: "r1", text: "It is nine." });
  assert.equal(spoken, "It is nine.");
  assert.equal(ctx.wrapped.sessionId, "s1");
  assert.deepEqual(ctx.logged, []);
});
