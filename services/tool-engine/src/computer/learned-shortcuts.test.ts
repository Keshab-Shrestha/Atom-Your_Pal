import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createComputerTool } from "./tool.ts";
import { createShortcutStore } from "./learned-shortcuts.ts";
import type { CuaTransport, CuaResult } from "./cua-client.ts";

const ok = (data: Record<string, unknown>): CuaResult => ({ data, text: "ok", isError: false, refusal: undefined });
const step = (button: string, value: string) => ({ button, expect: { label: "Result", value } });
const text = (v: string | { text: string }) => (typeof v === "string" ? v : v.text);

/** A TextEdit window with one "Next" button; each click adds 1 to "Result". `reset` puts it back to 0; `broken` makes clicks change nothing. */
function fixture(shortcuts = createShortcutStore()) {
  let snapshot = 0, value = "0", broken = false;
  const cua: CuaTransport = {
    get generation() { return 1; },
    async close() {},
    async call(name) {
      if (name === "list_apps") return ok({ apps: [{ name: "TextEdit", pid: 11, bundle_id: "com.apple.TextEdit", running: true }] });
      if (name === "list_windows") return ok({ windows: [{ app_name: "TextEdit", pid: 11, window_id: 7, is_on_screen: true }] });
      if (name === "get_window_state") {
        snapshot++;
        return ok({ pid: 11, window_id: 7, app_name: "TextEdit", elements: [{ element_index: snapshot * 10, element_token: `s${snapshot}`, role: "AXButton", label: "Next", enabled: true }], tree_markdown: `- AXStaticText = ${JSON.stringify(value)} (Result)\n` });
      }
      if (name === "click") {
        if (!broken) value = String(Number(value) + 1);
        return ok({ effect: "unverifiable" });
      }
      throw new Error(`Unexpected ${name}`);
    },
  };
  const tool = createComputerTool({ cua, shortcuts, approve: async () => false });
  return { tool, shortcuts, reset: () => { value = "0"; }, breakClicks: () => { broken = true; } };
}

test("store: same goal in other case replaces; two stops in a row remove; the file survives a restart", () => {
  const path = join(mkdtempSync(join(tmpdir(), "ark-shortcuts-")), "shortcuts.json");
  const store = createShortcutStore({ path });
  const first = store.save("TextEdit", "Add 2 and 3.", [step("Next", "1")]);
  const again = store.save("textedit", "add 2   and 3", [step("Next", "1"), step("Next", "2")]);
  assert.equal(again.id, first.id);
  assert.equal(store.all().length, 1);
  assert.equal(store.record(first.id, true), true);
  assert.equal(store.record(first.id, false), true, "one stop keeps it");
  assert.equal(createShortcutStore({ path }).find("TextEdit", "add 2 and 3")?.uses, 1, "read back from the file");
  assert.equal(store.record(first.id, false), false, "two stops in a row remove it");
  assert.equal(store.all().length, 0);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), []);
});

test("a fully checked click_sequence with a goal is saved; look lists it; shortcut replays it through the same checks", async () => {
  const f = fixture();
  await f.tool.run({ action: "look", app: "TextEdit", window_id: 7 });
  const done = text(await f.tool.run({ action: "click_sequence", goal: "count to two", steps: [step("Next", "1"), step("Next", "2")] }));
  assert.match(done, /Saved as shortcut "count to two"/);
  assert.deepEqual(f.shortcuts.find("TextEdit", "Count to two")?.steps.map((s) => s.expect.value), ["1", "2"]);

  f.reset();
  assert.match(text(await f.tool.run({ action: "look", app: "TextEdit", window_id: 7 })), /Saved shortcuts for TextEdit.*"count to two"/);
  const replay = text(await f.tool.run({ action: "shortcut", app: "TextEdit", goal: "Count to two" }));
  assert.match(replay, /ran; every step passed its check/);
  assert.match(replay, /2\/2 clicks passed/);
  assert.equal(f.shortcuts.find("TextEdit", "count to two")?.uses, 1);
});

test("no goal, a stopped sequence or no store saves nothing; an unknown shortcut clicks nothing", async () => {
  const f = fixture();
  await f.tool.run({ action: "look", app: "TextEdit", window_id: 7 });
  await f.tool.run({ action: "click_sequence", steps: [step("Next", "1")] });
  assert.equal(f.shortcuts.all().length, 0, "no goal");
  f.reset();
  f.breakClicks();
  const stopped = await f.tool.run({ action: "click_sequence", goal: "never works", steps: [step("Next", "1")] });
  assert.match(text(stopped), /stopped/);
  assert.equal(f.shortcuts.all().length, 0, "a stopped sequence is not learned");
  await assert.rejects(async () => f.tool.run({ action: "shortcut", app: "TextEdit", goal: "nothing saved" }), /No saved shortcut/);
  const off = createComputerTool({ cua: {} as CuaTransport, approve: async () => false });
  await assert.rejects(async () => off.run({ action: "shortcut", app: "TextEdit", goal: "x" }), /Learned shortcuts are off/);
});

test("a replay that stops is not repeated by hand and the shortcut goes after two stops", async () => {
  const f = fixture();
  await f.tool.run({ action: "look", app: "TextEdit", window_id: 7 });
  await f.tool.run({ action: "click_sequence", goal: "count to one", steps: [step("Next", "1")] });
  f.reset();
  f.breakClicks();
  const first = text(await f.tool.run({ action: "shortcut", app: "TextEdit", goal: "count to one" }));
  assert.match(first, /stopped\. Do not replay it/);
  assert.equal(f.shortcuts.all().length, 1);
  const second = text(await f.tool.run({ action: "shortcut", app: "TextEdit", goal: "count to one" }));
  assert.match(second, /stopped twice in a row and is removed/);
  assert.equal(f.shortcuts.all().length, 0);
});

test("a saved shortcut that holds an approval-needing button is refused and removed", async () => {
  const f = fixture();
  f.shortcuts.save("TextEdit", "send it", [step("Send", "1")]);
  await assert.rejects(async () => f.tool.run({ action: "shortcut", app: "TextEdit", goal: "send it" }), /no longer allowed and was removed/);
  assert.equal(f.shortcuts.all().length, 0);
});
