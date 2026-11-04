import { test } from "node:test";
import assert from "node:assert/strict";
import { createComputerTool } from "./tool.ts";
import { createShortcutStore } from "./learned-shortcuts.ts";
import { calculatorApp, fakeMac, mailApp } from "./fake-mac.ts";

// Scenario evals (2026-11-04): the computer tool against a fake Mac. Each scenario is a short script of tool calls with what must
// hold after it: what the driver was asked to do, what the user was asked, what the tool refused. No screen, driver or model.

const text = (v: string | { text: string }) => (typeof v === "string" ? v : v.text);
const seq = (button: string, value: string) => ({ button, expect: { label: "Display", value } });
const ADD_2_3 = [seq("2", "2"), seq("+", "2"), seq("3", "3"), seq("=", "5")];

function world(options: { approve?: boolean; calculator?: Parameters<typeof calculatorApp>[0] } = {}) {
  const mail = mailApp();
  const mac = fakeMac([calculatorApp(options.calculator), mail]);
  const asked: string[] = [];
  const shortcuts = createShortcutStore();
  const tool = createComputerTool({ cua: mac.cua, shortcuts, approve: async (r) => { asked.push(r.summary); return options.approve ?? false; } });
  const run = async (input: Record<string, unknown>) => text(await tool.run(input));
  const look = (app: string) => run({ action: "look", app });
  return { mac, mail, asked, shortcuts, run, look };
}

test("scenario: add 2 and 3 once, save the shortcut, and replay it later with a fresh window read", async () => {
  const w = world();
  await w.look("Calculator");
  assert.match(await w.run({ action: "click_sequence", goal: "add 2 and 3", steps: ADD_2_3 }), /Saved as shortcut "add 2 and 3"/);
  assert.deepEqual(w.mac.inputs, ["click:2", "click:+", "click:3", "click:="]);
  await w.look("Calculator");
  const before = w.mac.inputs.length;
  const replay = await w.run({ action: "shortcut", app: "Calculator", goal: "Add 2 and 3" });
  assert.match(replay, /ran; every step passed its check/);
  assert.equal(w.mac.inputs.length - before, 4, "the replay clicked four buttons and nothing else");
  assert.equal(w.shortcuts.find("Calculator", "add 2 and 3")?.uses, 1);
  assert.deepEqual(w.asked, [], "no question for plain digit buttons");
});

test("scenario: a button that is renamed stops the replay with no click, and the shortcut goes after two stops", async () => {
  const learn = world();
  await learn.look("Calculator");
  await learn.run({ action: "click_sequence", goal: "add 2 and 3", steps: ADD_2_3 });
  const saved = learn.shortcuts.find("Calculator", "add 2 and 3")!;

  const changed = world({ calculator: { renameButton: { from: "3", to: "Three" } } });
  changed.shortcuts.save("Calculator", saved.goal, saved.steps);
  const first = await changed.run({ action: "shortcut", app: "Calculator", goal: saved.goal });
  assert.match(first, /stopped/);
  assert.match(first, /Do not replay it/);
  assert.deepEqual(changed.mac.inputs.slice(2), [], "nothing was clicked after the missing button");
  const second = await changed.run({ action: "shortcut", app: "Calculator", goal: saved.goal });
  assert.match(second, /removed/);
  assert.equal(changed.shortcuts.all().length, 0);
});

test("scenario: a wrong expected value stops the sequence after the click that did not match", async () => {
  const w = world();
  await w.look("Calculator");
  const result = await w.run({ action: "click_sequence", goal: "wrong", steps: [seq("2", "2"), seq("+", "2"), seq("3", "4")] });
  assert.match(result, /Sequence stopped at click 3\/3/);
  assert.equal(w.shortcuts.all().length, 0, "a stopped sequence is not learned");
});

test("scenario: Mail asks before Send, sends only after a yes, and never types into the password field", async () => {
  const declined = world({ approve: false });
  await declined.look("Mail");
  const elements = (await declined.look("Mail")).match(/\[(\d+)\] AXButton "Send"/)?.[1];
  assert.ok(elements, "the Send button is listed");
  await assert.rejects(async () => declined.run({ action: "click", element: Number(elements) }), /The user did not approve: Click "Send" in Mail/);
  assert.equal(declined.mail.sent, 0);
  assert.equal(declined.asked.length, 1);
  assert.match(declined.asked[0]!, /Send/);

  const approved = world({ approve: true });
  const listing = await approved.look("Mail");
  const send = listing.match(/\[(\d+)\] AXButton "Send"/)![1]!;
  await approved.run({ action: "click", element: Number(send) });
  assert.equal(approved.mail.sent, 1);
});

test("scenario: the password field is never typed into, and a delete button never goes in a sequence", async () => {
  const w = world({ approve: true });
  const listing = await w.look("Mail");
  const password = listing.match(/\[(\d+)\] AXSecureTextField/)![1]!;
  await assert.rejects(async () => w.run({ action: "type", element: Number(password), text: "hunter2" }), /never types into a password field/);
  assert.deepEqual(w.mac.inputs, []);
  await assert.rejects(async () => w.run({ action: "click_sequence", steps: [{ button: "Delete", expect: { label: "Status", value: "Draft" } }] }), /ARK never deletes/);
  assert.deepEqual(w.mac.inputs, [], "nothing was clicked");
});

test("scenario: an app that is not there is refused with words, and no input is sent", async () => {
  const w = world();
  await assert.rejects(async () => w.look("Keynote"), /There is no app called "Keynote"/);
  assert.deepEqual(w.mac.inputs, []);
});
