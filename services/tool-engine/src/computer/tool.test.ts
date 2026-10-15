import { test } from "node:test";
import assert from "node:assert/strict";
import { createComputerTool, type ApprovalRequest } from "./tool.ts";
import type { CuaResult, CuaTransport } from "./cua-client.ts";

const textEdit = { name: "TextEdit", bundle_id: "com.apple.TextEdit", pid: 11, running: true };
const terminal = { name: "Terminal", bundle_id: "com.apple.Terminal", pid: 22, running: true };
const win = { app_name: "TextEdit", pid: 11, window_id: 7, title: "note.txt", is_on_screen: true };
const termWin = { app_name: "Terminal", pid: 22, window_id: 8, title: "zsh", is_on_screen: true };
const elements = [
  { element_index: 0, element_token: "s1:0", role: "AXWindow", label: "note.txt" },
  { element_index: 1, element_token: "s1:1", role: "AXTextArea", label: "", value: "hello" },
  { element_index: 2, element_token: "s1:2", role: "AXButton", label: "Bold" },
  { element_index: 3, element_token: "s1:3", role: "AXButton", label: "Send" },
  { element_index: 4, element_token: "s1:4", role: "AXSecureTextField", label: "Password" },
  { element_index: 5, element_token: "s1:5", role: "AXTextField", label: "Search" },
  { element_index: 6, element_token: "s1:6", role: "AXButton", label: "Settings", frame: { x: 2133, y: 85, w: 90, h: 24 } },
  { element_index: 7, element_token: "s1:7", role: "AXButton", label: "Broken", frame: { x: Number.NaN, y: 0, w: 10, h: 10 } },
  { element_index: 8, element_token: "s1:8", role: "AXGroup", label: "Hidden", frame: { x: 10, y: 10, w: 0, h: 0 } },
  { element_index: 9, element_token: "s1:9", role: "AXButton", label: "Far", frame: { x: 9e9, y: 5, w: 10, h: 10 } },
  { element_index: 10, element_token: "s1:10", role: "AXSlider", label: "Volume", value: "5" },
  { element_index: 11, element_token: "s1:11", role: "AXPopUpButton", label: "Delete files after" },
];
const ok = (text: string, data: Record<string, any> = {}): CuaResult => ({ text, data, isError: false, refusal: undefined });

function fakeCua(handlers: Record<string, (args: any) => CuaResult> = {}) {
  const calls: Array<{ name: string; args: any }> = [];
  const cua: CuaTransport = {
    async call(name, args) {
      calls.push({ name, args });
      if (handlers[name]) return handlers[name](args);
      if (name === "list_apps") return ok("apps", { apps: [textEdit, terminal] });
      if (name === "list_windows") return ok("wins", { windows: [win, termWin] });
      if (name === "get_window_state") return ok("state", { pid: args.pid, window_id: args.window_id, app_name: args.pid === 11 ? "TextEdit" : "Terminal", window_title: "x", snapshot_id: "s1", elements, tree_markdown: "tree" });
      return ok(`${name} done`, { effect: "confirmed" });
    },
    async close() {},
  };
  return { cua, calls };
}

function setup(opts: { point?: (p: { x: number; y: number; w: number; h: number; label: string }) => void; approve?: (r: ApprovalRequest) => boolean | Promise<boolean>; handlers?: Record<string, (a: any) => CuaResult> } = {}) {
  const { cua, calls } = fakeCua(opts.handlers);
  const asked: ApprovalRequest[] = [];
  const logs: any[] = [];
  const tool = createComputerTool({
    cua,
    approve: async (r) => {
      asked.push(r);
      return opts.approve ? opts.approve(r) : false;
    },
    onAction: (e) => logs.push(e),
    ...(opts.point ? { onPoint: opts.point } : {}),
  });
  const run = (input: Record<string, unknown>, signal?: AbortSignal) => Promise.resolve(tool.run(input, signal)).then((text) => ({ ok: true as const, text }), (e: Error) => ({ ok: false as const, text: e.message }));
  return { tool, run, calls, asked, logs };
}

const sees = async (s: ReturnType<typeof setup>) => s.run({ action: "look", app: "TextEdit" });

test("the tool exposes one `computer` spec with an action enum", () => {
  const { tool } = setup();
  assert.equal(tool.spec.name, "computer");
  assert.deepEqual(tool.spec.inputSchema.required, ["action"]);
});

test("list_apps shows apps but hides ones ATOM may not control", async () => {
  const s = setup();
  const r = await s.run({ action: "list_apps" });
  assert.equal(r.ok, true);
  assert.match(r.text, /TextEdit/);
  assert.doesNotMatch(r.text, /Terminal/);
});

test("look finds the app's window and returns numbered elements", async () => {
  const s = setup();
  const r = await sees(s);
  assert.equal(r.ok, true);
  assert.match(r.text, /\[1\] AXTextArea/);
  assert.match(r.text, /\[2\] AXButton "Bold"/);
  assert.deepEqual(s.calls.map((c) => c.name), ["list_apps", "list_windows", "get_window_state"]);
  assert.equal(s.calls[2].args.pid, 11);
  assert.equal(s.calls[2].args.window_id, 7);
});

test("look refuses a blocked app and never reads its window", async () => {
  const s = setup();
  const r = await s.run({ action: "look", app: "Terminal" });
  assert.equal(r.ok, false);
  assert.match(r.text, /never control Terminal/);
  assert.equal(s.calls.some((c) => c.name === "get_window_state"), false);
});

test("look says so when the app is installed but not running, and when it does not exist", async () => {
  const s = setup({
    handlers: { list_apps: () => ok("apps", { apps: [textEdit, { name: "Pages", bundle_id: "com.apple.iWork.Pages", running: false }] }) },
  });
  const idle = await s.run({ action: "look", app: "Pages" });
  assert.equal(idle.ok, false);
  assert.match(idle.text, /not running.*open/i);
  const missing = await s.run({ action: "look", app: "Nonexistent" });
  assert.equal(missing.ok, false);
  assert.match(missing.text, /no app called "Nonexistent"/);
});

test("click on a harmless element runs without asking", async () => {
  const s = setup();
  await sees(s);
  const r = await s.run({ action: "click", element: 2 });
  assert.equal(r.ok, true);
  assert.equal(s.asked.length, 0);
  const call = s.calls.find((c) => c.name === "click")!;
  assert.deepEqual(call.args, { pid: 11, window_id: 7, element_token: "s1:2", delivery_mode: "background" });
});

test("click on Send asks first, and does nothing if refused", async () => {
  const s = setup({ approve: () => false });
  await sees(s);
  const r = await s.run({ action: "click", element: 3 });
  assert.equal(r.ok, false);
  assert.match(r.text, /did not approve/i);
  assert.equal(s.asked.length, 1);
  assert.match(s.asked[0].summary, /Send/);
  assert.equal(s.calls.some((c) => c.name === "click"), false);
});

test("click on Send runs once the user approves", async () => {
  const s = setup({ approve: () => true });
  await sees(s);
  const r = await s.run({ action: "click", element: 3 });
  assert.equal(r.ok, true);
  assert.equal(s.calls.some((c) => c.name === "click"), true);
});

test("an approval that never comes is a refusal, not a hang", async () => {
  const s = setup({ approve: () => new Promise<boolean>(() => {}) });
  const ac = new AbortController();
  await sees(s);
  const pending = s.run({ action: "click", element: 3 }, ac.signal);
  setTimeout(() => ac.abort(), 20);
  const r = await pending;
  assert.equal(r.ok, false);
  assert.equal(s.calls.some((c) => c.name === "click"), false);
});

test("typing into a password field is refused and never reaches Cua", async () => {
  const s = setup({ approve: () => true });
  await sees(s);
  const r = await s.run({ action: "type", element: 4, text: "hunter2" });
  assert.equal(r.ok, false);
  assert.match(r.text, /password field/);
  assert.equal(s.asked.length, 0);
  assert.equal(s.calls.some((c) => c.name === "type_text"), false);
});

test("typing into an ordinary field works", async () => {
  const s = setup();
  await sees(s);
  const r = await s.run({ action: "type", element: 1, text: "hi" });
  assert.equal(r.ok, true);
  assert.deepEqual(s.calls.find((c) => c.name === "type_text")!.args, { pid: 11, window_id: 7, element_token: "s1:1", text: "hi", delivery_mode: "background" });
});

test("an element number the model made up is refused", async () => {
  const s = setup();
  await sees(s);
  const r = await s.run({ action: "click", element: 99 });
  assert.equal(r.ok, false);
  assert.match(r.text, /no element 99/i);
});

test("acting before looking is refused", async () => {
  const s = setup();
  const r = await s.run({ action: "click", element: 1 });
  assert.equal(r.ok, false);
  assert.match(r.text, /look at an app first/i);
});

test("a stale element is reported so the model looks again", async () => {
  const s = setup({
    handlers: {
      click: () => ({ text: "stale", data: { refusal: { code: "stale_element_token", message: "stale" } }, isError: true, refusal: { code: "stale_element_token", message: "stale" } }),
    },
  });
  await sees(s);
  const r = await s.run({ action: "click", element: 2 });
  assert.equal(r.ok, false);
  assert.match(r.text, /changed.*look again/i);
});

test("pressing Return asks, except right after typing", async () => {
  const s = setup({ approve: () => true });
  await sees(s);
  await s.run({ action: "key", keys: ["return"] });
  assert.equal(s.asked.length, 1);
  await s.run({ action: "type", element: 5, text: "cats" });
  await s.run({ action: "key", keys: ["return"] });
  assert.equal(s.asked.length, 1);
});

test("a key press on a blocked app's window is refused", async () => {
  const s = setup();
  await s.run({ action: "look", app: "TextEdit" });
  // simulate switching the target to a blocked app by looking at it (refused), which must not change the target
  await s.run({ action: "look", app: "Terminal" });
  const r = await s.run({ action: "key", keys: ["tab"] });
  assert.equal(r.ok, true);
  assert.equal(s.calls.find((c) => c.name === "press_key")!.args.pid, 11);
});

test("open launches an app in the background; blocked apps are refused", async () => {
  const s = setup();
  const good = await s.run({ action: "open", app: "TextEdit" });
  assert.equal(good.ok, true);
  assert.equal(s.calls.find((c) => c.name === "launch_app")!.args.bundle_id, "com.apple.TextEdit");
  const bad = await s.run({ action: "open", app: "Terminal" });
  assert.equal(bad.ok, false);
});

test("an unknown action is refused", async () => {
  const s = setup();
  const r = await s.run({ action: "drag" });
  assert.equal(r.ok, false);
  assert.match(r.text, /not an action/);
});

test("every action is logged, and logs never contain typed text", async () => {
  const s = setup();
  await sees(s);
  await s.run({ action: "type", element: 1, text: "my secret note" });
  const text = JSON.stringify(s.logs);
  assert.doesNotMatch(text, /my secret note/);
  assert.ok(s.logs.some((l) => l.action === "type" && l.app === "TextEdit"));
});

test("onStep is told about each action as it begins, with no text or screen content", async () => {
  const steps: any[] = [];
  const { cua } = fakeCua();
  const tool = createComputerTool({ cua, approve: async () => false, onStep: (s) => steps.push(s) });
  await Promise.resolve(tool.run({ action: "look", app: "TextEdit" })).catch(() => {});
  await Promise.resolve(tool.run({ action: "type", element: 1, text: "my secret note" })).catch(() => {});
  assert.deepEqual(steps, [{ action: "look", app: "TextEdit" }, { action: "type", app: "TextEdit" }]);
});

test("long element lists are cut to a sensible size", async () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ element_index: i, element_token: `s1:${i}`, role: "AXButton", label: `B${i}` }));
  const s = setup({ handlers: { get_window_state: () => ok("s", { pid: 11, window_id: 7, snapshot_id: "s1", elements: many }) } });
  const r = await sees(s);
  assert.ok(r.text.length < 20000);
  assert.match(r.text, /more elements/);
});

test("the menu bar and everything under it is left out of a look, and numbers stay Cua's own", async () => {
  // Depth-first order, as Cua reports it: the window's content first, then the menu bar and its children.
  const els = [
    { element_index: 0, element_token: "s1:0", role: "AXWindow", label: "Doc", depth: 0 },
    { element_index: 1, element_token: "s1:1", role: "AXTextArea", label: "", depth: 1 },
    { element_index: 2, element_token: "s1:2", role: "AXButton", label: "Bold", depth: 1 },
    { element_index: 3, element_token: "s1:3", role: "AXMenuBar", label: "bar", depth: 0 },
    { element_index: 4, element_token: "s1:4", role: "AXMenuBarItem", label: "Apple", depth: 1 },
    { element_index: 5, element_token: "s1:5", role: "AXMenuItem", label: "About This Mac", depth: 3 },
    { element_index: 6, element_token: "s1:6", role: "AXWindow", label: "Other", depth: 0 },
  ];
  const s = setup({ handlers: { get_window_state: () => ok("s", { pid: 11, window_id: 7, snapshot_id: "s1", elements: els }) } });
  const r = await sees(s);
  assert.doesNotMatch(r.text, /Apple|About This Mac|AXMenuBar/);
  assert.match(r.text, /\[2\] AXButton "Bold"/);
  assert.match(r.text, /\[6\] AXWindow "Other"/); // a new root after the bar is kept
  // a hidden element cannot be acted on
  const hidden = await s.run({ action: "click", element: 5 });
  assert.equal(hidden.ok, false);
  assert.match(hidden.text, /no element 5/i);
});

test("the description says typed text goes in at the cursor", () => {
  assert.match(setup().tool.spec.description, /at the cursor/i);
});

const refused = (code: string, message: string): CuaResult => ({ text: message, data: {}, isError: true, refusal: { code, message } });
const AMBIGUOUS = refused("same_pid_keyboard_ambiguity", "pid 942 owns 1 other eligible top-level window(s); process-scoped key events cannot be proven to reach window 7");

test("a two-window app refusing the keyboard becomes a plain, final message, with no Cua jargon", async () => {
  const s = setup({ handlers: { press_key: () => AMBIGUOUS } });
  await sees(s);
  const r = await s.run({ action: "key", keys: ["m"] });
  assert.equal(r.ok, false);
  assert.match(r.text, /TextEdit has more than one window open/);
  assert.match(r.text, /Do not retry/i);
  assert.match(r.text, /tell the user/i);
  assert.doesNotMatch(r.text, /pid|process-scoped|top-level|same_pid/);
});

test("typing into a two-window app gets the same plain message", async () => {
  const s = setup({ handlers: { type_text: () => AMBIGUOUS } });
  await sees(s);
  const r = await s.run({ action: "type", element: 5, text: "x" });
  assert.match(r.text, /more than one window/);
  assert.doesNotMatch(r.text, /pid|process-scoped/);
});

test("clicks are not blocked by the keyboard rule: the click still goes through", async () => {
  const s = setup({ handlers: { press_key: () => AMBIGUOUS } });
  await sees(s);
  assert.equal((await s.run({ action: "click", element: 2 })).ok, true);
});

test("the same refusal twice in a row tells the model to stop now", async () => {
  const s = setup({ handlers: { press_key: () => AMBIGUOUS } });
  await sees(s);
  const first = await s.run({ action: "key", keys: ["m"] });
  const second = await s.run({ action: "key", keys: ["k"] });
  assert.doesNotMatch(first.text, /twice/i);
  assert.match(second.text, /twice/i);
  assert.match(second.text, /stop/i);
});

test("a success in between resets the repeat count", async () => {
  const s = setup({ handlers: { press_key: () => AMBIGUOUS } });
  await sees(s);
  await s.run({ action: "key", keys: ["m"] });
  await s.run({ action: "click", element: 2 });
  const again = await s.run({ action: "key", keys: ["m"] });
  assert.doesNotMatch(again.text, /twice/i);
});

test("other known refusals are explained in plain words too", async () => {
  for (const [code, pattern] of [
    ["minimized_or_hidden_window", /minimi[sz]ed or hidden/],
    ["window_not_found", /window/],
    ["off_space_or_ax_unresolved", /another desktop|Space/i],
  ] as const) {
    const s = setup({ handlers: { press_key: () => refused(code, `raw ${code} detail`) } });
    await sees(s);
    const r = await s.run({ action: "key", keys: ["a"] });
    assert.match(r.text, pattern, code);
    assert.doesNotMatch(r.text, /raw /, code);
    assert.match(r.text, /tell the user/i, code);
  }
});

test("an unknown refusal still passes Cua's own message along", async () => {
  const s = setup({ handlers: { press_key: () => refused("something_new", "new thing happened") } });
  await sees(s);
  const r = await s.run({ action: "key", keys: ["a"] });
  assert.match(r.text, /new thing happened/);
});

// ---- Pointing (ADR-054, Task 0.6.4)

type Pointed = { x: number; y: number; w: number; h: number; label: string };

test("point sends the element's place on screen and a label to Pal, and clicks nothing", async () => {
  const pointed: Pointed[] = [];
  const s = setup({ point: (p) => pointed.push(p) });
  await sees(s);
  const r = await s.run({ action: "point", element: 6, text: "the settings button" });
  assert.equal(r.ok, true);
  assert.deepEqual(pointed, [{ x: 2133, y: 85, w: 90, h: 24, label: "the settings button" }]);
  assert.deepEqual(s.calls.map((c) => c.name), ["list_apps", "list_windows", "get_window_state"], "nothing was clicked or typed");
  assert.equal(s.asked.length, 0, "pointing never asks");
  assert.match(r.text, /Pointed/);
});

test("point labels from the element when the model gives no label", async () => {
  const pointed: Pointed[] = [];
  const s = setup({ point: (p) => pointed.push(p) });
  await sees(s);
  await s.run({ action: "point", element: 6 });
  assert.equal(pointed[0].label, "Settings");
});

test("point cuts a long label and strips line breaks", async () => {
  const pointed: Pointed[] = [];
  const s = setup({ point: (p) => pointed.push(p) });
  await sees(s);
  await s.run({ action: "point", element: 6, text: `line one\nline two ${"x".repeat(200)}` });
  assert.ok(pointed[0].label.length <= 60);
  assert.doesNotMatch(pointed[0].label, /\n/);
});

test("point at an element the last look did not show is refused", async () => {
  const s = setup({ point: () => assert.fail("must not point") });
  await sees(s);
  const r = await s.run({ action: "point", element: 99 });
  assert.equal(r.ok, false);
  assert.match(r.text, /no element 99/i);
});

test("point before any look is refused", async () => {
  const s = setup({ point: () => assert.fail("must not point") });
  const r = await s.run({ action: "point", element: 1 });
  assert.equal(r.ok, false);
  assert.match(r.text, /look/i);
});

test("point at an element with no usable place on screen says so and does not point", async () => {
  for (const element of [1, 7, 8, 9]) { // no frame, NaN, zero size, absurdly far
    const s = setup({ point: () => assert.fail("must not point") });
    await sees(s);
    const r = await s.run({ action: "point", element });
    assert.equal(r.ok, false, `element ${element}`);
    assert.match(r.text, /cannot show where/i, `element ${element}`);
  }
});

test("point without an island to show it says pointing is unavailable", async () => {
  const s = setup();
  await sees(s);
  const r = await s.run({ action: "point", element: 6 });
  assert.equal(r.ok, false);
  assert.match(r.text, /pointing is not available/i);
});

test("point is logged with the app and no label", async () => {
  const s = setup({ point: () => {} });
  await sees(s);
  await s.run({ action: "point", element: 6, text: "secret thing" });
  const entry = s.logs.at(-1);
  assert.deepEqual(entry, { action: "point", app: "TextEdit", ok: true });
});

test("the schema offers point", () => {
  const { tool } = setup();
  assert.match(JSON.stringify(tool.spec.inputSchema), /point/);
});

// ---- Task 0.6.5: what Cua says about an action, look_after, and set_value

const verdict = (effect: string, extra: Record<string, unknown> = {}) => ({ click: () => ok("clicked", { effect, ...extra }) });

test("a confirmed action says so, and an unconfirmed one tells the model to look", async () => {
  const s = setup({ handlers: verdict("confirmed") });
  await sees(s);
  assert.match((await s.run({ action: "click", element: 2 })).text, /confirmed/i);
  const u = setup({ handlers: verdict("unverifiable") });
  await sees(u);
  const r = await u.run({ action: "click", element: 2 });
  assert.equal(r.ok, true);
  assert.match(r.text, /could not confirm|not confirmed/i);
  assert.match(r.text, /look/i);
});

test("a click that probably did nothing is reported as such, and asking twice for the same thing ends the attempt", async () => {
  const s = setup({ handlers: verdict("suspected_noop", { escalation: { recommended: "foreground", reason: "no change seen" } }) });
  await sees(s);
  const first = await s.run({ action: "click", element: 2 });
  assert.equal(first.ok, true); // delivered, so it is a result, not an error
  assert.match(first.text, /probably did nothing/i);
  assert.match(first.text, /look/i);
  assert.doesNotMatch(first.text, /foreground|delivery_mode|escalat/i); // the model never sees Cua's ladder
  await sees(s);
  const second = await s.run({ action: "click", element: 2 });
  assert.match(second.text, /twice|stop/i);
  assert.match(second.text, /tell the user/i);
});

test("a different outcome in between resets the no-effect count", async () => {
  let effect = "suspected_noop";
  const s = setup({ handlers: { click: () => ok("clicked", { effect }) } });
  await sees(s);
  await s.run({ action: "click", element: 2 });
  effect = "confirmed";
  await s.run({ action: "click", element: 2 });
  effect = "suspected_noop";
  const again = await s.run({ action: "click", element: 2 });
  assert.doesNotMatch(again.text, /twice/i);
});

test("a result with no verdict (an older driver) reads as before", async () => {
  const s = setup({ handlers: { click: () => ok("clicked") } });
  await sees(s);
  const r = await s.run({ action: "click", element: 2 });
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.text, /confirm|nothing/i);
});

test("type, key and scroll report the verdict too", async () => {
  const s = setup({ handlers: { type_text: () => ok("t", { effect: "suspected_noop" }), press_key: () => ok("k", { effect: "unverifiable" }), scroll: () => ok("s", { effect: "confirmed" }) } });
  await sees(s);
  assert.match((await s.run({ action: "type", element: 1, text: "hi" })).text, /probably did nothing/i);
  assert.match((await s.run({ action: "key", keys: ["tab"] })).text, /could not confirm|not confirmed/i);
  assert.match((await s.run({ action: "scroll", direction: "down" })).text, /confirmed/i);
});

test("look_after returns the new screen in the same reply and keeps working from it", async () => {
  const s = setup();
  await sees(s);
  const before = s.calls.filter((c) => c.name === "get_window_state").length;
  const r = await s.run({ action: "click", element: 2, look_after: true });
  assert.equal(r.ok, true);
  assert.equal(s.calls.filter((c) => c.name === "get_window_state").length, before + 1);
  assert.match(r.text, /Clicked \[2\]/);
  assert.match(r.text, /TextEdit — window/); // the look, appended
  assert.match(r.text, /\[1\] AXTextArea/);
  const next = await s.run({ action: "click", element: 2 }); // the new look's numbers are live
  assert.equal(next.ok, true);
});

test("without look_after there is no extra look", async () => {
  const s = setup();
  await sees(s);
  const before = s.calls.filter((c) => c.name === "get_window_state").length;
  await s.run({ action: "click", element: 2 });
  assert.equal(s.calls.filter((c) => c.name === "get_window_state").length, before);
});

test("look_after is not done when the action was refused or declined", async () => {
  const s = setup({ approve: () => false });
  await sees(s);
  const before = s.calls.filter((c) => c.name === "get_window_state").length;
  const r = await s.run({ action: "click", element: 3, look_after: true }); // Send, declined
  assert.equal(r.ok, false);
  assert.equal(s.calls.filter((c) => c.name === "get_window_state").length, before);
});

test("a look_after that cannot read the window still reports the action", async () => {
  const s = setup();
  await sees(s);
  s.calls.length = 0;
  let reads = 0;
  const t = setup({ handlers: { get_window_state: (a) => (++reads > 1 ? { text: "gone", data: {}, isError: true, refusal: { code: "window_not_found", message: "gone" } } : ok("state", { pid: a.pid, window_id: a.window_id, app_name: "TextEdit", window_title: "x", snapshot_id: "s1", elements, tree_markdown: "" })) } });
  await sees(t);
  const r = await t.run({ action: "click", element: 2, look_after: true });
  assert.equal(r.ok, true);
  assert.match(r.text, /Clicked \[2\]/);
  assert.match(r.text, /could not read|look again/i);
});

test("typing in a search field then look_after still counts as just typed, so Return after it does not ask", async () => {
  const s = setup({ approve: () => false });
  await sees(s);
  await s.run({ action: "type", element: 5, text: "hello", look_after: true }); // element 5 is the "Search" field
  const r = await s.run({ action: "key", keys: ["return"] });
  assert.equal(r.ok, true);
  assert.equal(s.asked.length, 0);
  // and without the typing, the same Return does ask
  const fresh = setup({ approve: () => false });
  await sees(fresh);
  assert.equal((await fresh.run({ action: "key", keys: ["return"] })).ok, false);
  assert.equal(fresh.asked.length, 1);
});

// 2026-10-15 (security review): Return skipped its card after typing in ANY field, so "type, then Return" sent a message from a compose box.
test("Return after typing in a text area or compose box asks; text with a line break asks before it is typed", async () => {
  const s = setup({ approve: () => false });
  await sees(s);
  await s.run({ action: "type", element: 1, text: "hello" }); // element 1 is the document text area, not a search field
  const r = await s.run({ action: "key", keys: ["return"] });
  assert.equal(r.ok, false, "Return after typing in a document asks");
  assert.equal(s.asked.length, 1);
  const lines = setup({ approve: () => false });
  await sees(lines);
  const typed = await lines.run({ action: "type", element: 1, text: "hi\nsend this" });
  assert.equal(typed.ok, false, "a line break in the text asks first");
  assert.equal(lines.asked.length, 1);
  assert.equal(lines.calls.some((c) => c.name === "type_text"), false, "nothing was typed");
});

test("key aliases cannot dodge the rules: command+q, alt+escape-style names and kp_enter ask like cmd+q and enter", async () => {
  const s = setup({ approve: () => false });
  await sees(s);
  for (const keys of [["command", "q"], ["super", "space"], ["kp_enter"], ["numpad enter"], ["command", "alt", "esc"]]) {
    assert.equal((await s.run({ action: "key", keys })).ok, false, keys.join("+"));
  }
  assert.equal(s.asked.length, 5);
});

test("set_value sets a slider by its element and says what it set", async () => {
  const s = setup({ handlers: { set_value: () => ok("set", { effect: "confirmed" }) } });
  await sees(s);
  const r = await s.run({ action: "set_value", element: 10, text: "60" });
  assert.equal(r.ok, true);
  assert.match(r.text, /Set \[10\]/);
  assert.match(r.text, /60/);
  const call = s.calls.find((c) => c.name === "set_value")!;
  assert.deepEqual(call.args, { pid: 11, window_id: 7, element_token: "s1:10", value: "60" });
});

test("set_value needs a look, an element from it and a value", async () => {
  const s = setup();
  assert.equal((await s.run({ action: "set_value", element: 10, text: "60" })).ok, false); // no look yet
  await sees(s);
  assert.match((await s.run({ action: "set_value", element: 99, text: "60" })).text, /no element 99/i);
  assert.match((await s.run({ action: "set_value", element: 10 })).text, /"text" is required|value/i);
  assert.equal(s.calls.some((c) => c.name === "set_value"), false);
});

test("set_value never writes into a password field", async () => {
  const s = setup();
  await sees(s);
  const r = await s.run({ action: "set_value", element: 4, text: "hunter2" });
  assert.equal(r.ok, false);
  assert.match(r.text, /never types into/i);
  assert.equal(s.calls.some((c) => c.name === "set_value"), false);
});

test("set_value on a risky control asks first, like a click", async () => {
  const s = setup({ approve: () => false });
  await sees(s);
  const r = await s.run({ action: "set_value", element: 11, text: "Immediately" }); // "Delete files after"
  assert.equal(r.ok, false);
  assert.equal(s.asked.length, 1);
  assert.equal(s.calls.some((c) => c.name === "set_value"), false);
});

test("set_value into a search field counts as typing, but into a slider or a document does not", async () => {
  const typed = setup({ approve: () => false, handlers: { set_value: () => ok("set", { effect: "confirmed" }) } });
  await sees(typed);
  await typed.run({ action: "set_value", element: 5, text: "hello" });
  assert.equal((await typed.run({ action: "key", keys: ["return"] })).ok, true);
  const slid = setup({ approve: () => false, handlers: { set_value: () => ok("set", { effect: "confirmed" }) } });
  await sees(slid);
  await slid.run({ action: "set_value", element: 10, text: "60" });
  assert.equal((await slid.run({ action: "key", keys: ["return"] })).ok, false);
});

test("set_value is refused in a blocked app and does not appear for the model as a raw Cua tool", async () => {
  const s = setup();
  assert.equal((await s.run({ action: "look", app: "Terminal" })).ok, false);
  const r = await s.run({ action: "set_value", element: 10, text: "1" });
  assert.equal(r.ok, false);
  assert.equal(s.calls.some((c) => c.name === "set_value"), false);
});

test("the schema offers look_after and describes set_value", () => {
  const { tool } = setup();
  const props = (tool.spec.inputSchema as any).properties;
  assert.ok(props.look_after);
  assert.match(props.action.description, /set_value/);
});

// 2026-10-15 (benchmark): TextEdit was running with its Open panel and no document window. Cua's list_apps showed it as pid 0 and
// not running, so `look` refused ("TextEdit is not running") after every `open`. list_windows still names the app and its pid.
test("look finds a running app that list_apps shows as pid 0 and not running, by the pid of its windows", async () => {
  const s = setup({
    handlers: {
      list_apps: () => ok("apps", { apps: [{ name: "TextEdit", bundle_id: "com.apple.TextEdit", pid: 0, running: false, windows: [] }] }),
      list_windows: (args) =>
        ok("wins", {
          windows: args.pid === undefined
            ? [{ app_name: "Finder", pid: 5, window_id: 1 }, { app_name: "TextEdit", pid: 6522, window_id: 3545, title: "Open", is_on_screen: true }]
            : [{ app_name: "TextEdit", pid: args.pid, window_id: 3545, title: "Open", is_on_screen: true }],
        }),
    },
  });
  const r = await sees(s);
  assert.equal(r.ok, true, r.text);
  assert.deepEqual(s.calls.map((c) => [c.name, c.args.pid]), [["list_apps", undefined], ["list_windows", undefined], ["list_windows", 6522], ["get_window_state", 6522]]);
});

test("look still refuses an app with no process and no window", async () => {
  const s = setup({
    handlers: {
      list_apps: () => ok("apps", { apps: [{ name: "Pages", bundle_id: "com.apple.iWork.Pages", pid: 0, running: false, windows: [] }] }),
      list_windows: () => ok("wins", { windows: [{ app_name: "Finder", pid: 5, window_id: 1 }] }),
    },
  });
  const r = await s.run({ action: "look", app: "Pages" });
  assert.equal(r.ok, false);
  assert.match(r.text, /not running.*open/i);
});

// 2026-10-15: TextEdit with no document owns only 30-point menu-bar windows. `look` read one and said "no title and no readable text".
test("look says there is no document when an app has only thin menu-bar windows", async () => {
  const s = setup({
    handlers: {
      list_windows: () => ok("wins", { windows: [{ window_id: 1, app_name: "TextEdit", pid: 11, bounds: { x: 0, y: 0, width: 1920, height: 30 }, is_on_screen: false }, { window_id: 2, app_name: "TextEdit", pid: 11, bounds: { x: -1920, y: 0, width: 1920, height: 30 } }] }),
    },
  });
  const r = await sees(s);
  assert.equal(r.ok, false);
  assert.match(r.text, /no window open \(no document\)/);
  assert.equal(s.calls.some((c) => c.name === "get_window_state"), false, "nothing was read");
});

test("look still reads a real window next to the thin ones", async () => {
  const s = setup({
    handlers: {
      list_windows: () => ok("wins", { windows: [{ window_id: 1, pid: 11, bounds: { height: 30 } }, { window_id: 7, pid: 11, bounds: { height: 448 }, is_on_screen: true }] }),
    },
  });
  const r = await sees(s);
  assert.equal(r.ok, true, r.text);
  assert.equal(s.calls.find((c) => c.name === "get_window_state")?.args.window_id, 7);
});

// 2026-10-16 (code check): look printed every field's value except a secure text field's, so a field labelled "Card number" or "API key" showed its
// value to the model and the log, while type and set_value refuse the same names.
test("look does not show the value of a field named like a secret", async () => {
  const s = setup({
    handlers: {
      get_window_state: (args) =>
        ok("state", {
          pid: args.pid, window_id: args.window_id, app_name: "TextEdit", window_title: "x", snapshot_id: "s1",
          elements: [
            { element_index: 0, element_token: "t0", role: "AXTextField", label: "Card number", value: "4111111111111111" },
            { element_index: 1, element_token: "t1", role: "AXTextField", label: "API key", value: "sk-secret-value" },
            { element_index: 2, element_token: "t2", role: "AXTextField", label: "Name", value: "Keshab" },
          ],
        }),
    },
  });
  const r = await sees(s);
  assert.equal(r.ok, true, r.text);
  assert.ok(!r.text.includes("4111111111111111") && !r.text.includes("sk-secret-value"), "secret values are hidden");
  assert.ok(r.text.includes("Keshab"), "an ordinary field's value still shows");
  assert.ok(r.text.includes("Card number"), "the label still shows");
});
