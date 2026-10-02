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

function setup(opts: { approve?: (r: ApprovalRequest) => boolean | Promise<boolean>; handlers?: Record<string, (a: any) => CuaResult> } = {}) {
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

test("list_apps shows apps but hides ones ZENO may not control", async () => {
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
