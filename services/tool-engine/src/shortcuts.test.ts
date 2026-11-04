import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolCall, ToolResult } from "@ark/contracts";
import { createShortcuts, matchLearned, matchShortcut } from "./shortcuts.ts";
import type { Shortcut } from "./computer/learned-shortcuts.ts";

const APPS = ["Brave Browser", "Finder", "Notes", "Journal", "Safari", "Terminal", "System Settings", "Music"];
const match = (text: string) => matchShortcut(text, { apps: APPS });

test("Keshab's commands match, with capitals, punctuation, 'please', 'ARK' and 'Ark'", () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["Open settings.", "open_ark_settings", {}],
    ["open ARK's settings", "open_ark_settings", {}],
    ["Open system settings", "open_app", { name: "System Settings" }],
    ["Open Brave.", "open_app", { name: "Brave Browser" }],
    ["Ark, open brave browser please", "open_app", { name: "Brave Browser" }],
    ["Ark, open brave browser please", "open_app", { name: "Brave Browser" }],
    ["open ark's settings", "open_ark_settings", {}],
    ["Open Finder", "open_app", { name: "Finder" }],
    ["open notes", "open_app", { name: "Notes" }],
    ["Please open my journal!", "open_app", { name: "Journal" }],
    ["Switch to Safari", "open_app", { name: "Safari" }],
    ["Pause.", "play_pause", {}],
    ["Play the music", "play_pause", {}],
    ["pause the video on YouTube", "play_pause", {}],
    ["Resume the music in Brave", "play_pause", {}],
  ];
  for (const [text, tool, input] of cases) assert.deepEqual(match(text)?.call, { name: tool, input }, text);
});

test("searches: YouTube in the same tab, Google and Chrome in a new one", () => {
  assert.deepEqual(match("Search lo-fi beats on YouTube.")?.call, {
    name: "open_url",
    input: { url: "https://www.youtube.com/results?search_query=lo-fi%20beats", same_tab: true },
  });
  assert.deepEqual(match("search youtube for cats & dogs")?.call.input, { url: "https://www.youtube.com/results?search_query=cats%20%26%20dogs", same_tab: true });
  assert.deepEqual(match("Search for pasta recipes on Chrome")?.call.input, { url: "https://www.google.com/search?q=pasta%20recipes" });
  assert.deepEqual(match("search google for weather in tokyo")?.call.input, { url: "https://www.google.com/search?q=weather%20in%20tokyo" });
});

test("look-alikes stay with the model", () => {
  for (const text of [
    "open Safari and search for cats",
    "open the pod bay doors",
    "scroll down and tell me what it says",
    "open",
    "open safar",
    "open brave and play some music",
    "play some jazz",
    "pause for a second and tell me the time",
    "search for cats",
    "search cats on youtube and play the first one",
    "what are my settings",
    "open settings in brave",
    "go to youtube",
    "open youtube",
    `search ${"a".repeat(201)} on youtube`,
    "",
  ]) {
    assert.equal(match(text), undefined, text);
  }
});

test("Terminal matches (it is installed), so the tool can refuse it and the model can say why", () => {
  assert.deepEqual(match("open terminal")?.call, { name: "open_app", input: { name: "Terminal" } });
});

function runner(result: Partial<ToolResult> = {}) {
  const calls: ToolCall[] = [];
  return {
    calls,
    tools: {
      specs: () => [],
      run: async (call: ToolCall): Promise<ToolResult> => (calls.push(call), { callId: call.id, content: "Opened Brave Browser.", ...result }),
    },
  };
}

test("a hit runs the tool once and returns its reply; the log gets the name only", async () => {
  const r = runner();
  const hits: unknown[] = [];
  const run = createShortcuts({ tools: r.tools, apps: async () => APPS, onHit: (e) => hits.push(e), now: () => 5 });
  assert.equal(await run("Open Brave."), "Opened Brave Browser.");
  assert.deepEqual(r.calls.map((c) => [c.name, c.input]), [["open_app", { name: "Brave Browser" }]]);
  assert.deepEqual(hits, [{ name: "open_app", ms: 0 }]);
});

test("a refused or failed tool leaves the sentence to the model", async () => {
  const r = runner({ isError: true, content: '"open_app" failed: ARK will never control Terminal' });
  const fallbacks: unknown[] = [];
  const run = createShortcuts({ tools: r.tools, apps: async () => APPS, onFallback: (e) => fallbacks.push(e) });
  assert.equal(await run("open Terminal"), undefined);
  assert.deepEqual(fallbacks, [{ name: "open_app", reason: "tool_error" }]);
});

test("no match runs nothing; a broken app list still allows the other shortcuts", async () => {
  const r = runner({ content: "Done." });
  const run = createShortcuts({ tools: r.tools, apps: async () => Promise.reject(new Error("no folder")) });
  assert.equal(await run("open Brave"), undefined);
  assert.equal(await run("what's the weather"), undefined);
  assert.equal(r.calls.length, 0);
  assert.equal(await run("pause"), "Done.");
});

// 2026-11-04: a sentence equal to the goal of a learned computer shortcut replays it with no model.
const learnedOf = (app: string, goal: string): Shortcut => ({ id: goal, app, goal, steps: [], uses: 0, failures: 0, savedAt: "2026-11-04T10:00:00.000Z" });

test("learned: the sentence must equal one saved goal; a short or shared goal never claims it", () => {
  const all = [learnedOf("Calculator", "add 2 and 3"), learnedOf("Calculator", "ok"), learnedOf("Notes", "make a list"), learnedOf("Reminders", "make a list")];
  assert.deepEqual(matchLearned(all, "Please, add 2 and 3."), { app: "Calculator", goal: "add 2 and 3" });
  assert.equal(matchLearned(all, "add 2 and 4"), undefined);
  assert.equal(matchLearned(all, "ok"), undefined, "a goal that short is not matched");
  assert.equal(matchLearned(all, "make a list"), undefined, "the same goal in two apps is left to the model");
  assert.equal(matchLearned([], "add 2 and 3"), undefined);
});

test("learned: a hit runs the computer shortcut action and says it is done; a fixed command wins over a learned goal", async () => {
  const r = runner({ content: "Saved shortcut \"add 2 and 3\" ran; every step passed its check." });
  const hits: unknown[] = [];
  const run = createShortcuts({ tools: r.tools, apps: async () => APPS, learned: () => [learnedOf("Calculator", "add 2 and 3"), learnedOf("Finder", "open notes")], onHit: (e) => hits.push(e), now: () => 5 });
  assert.equal(await run("add 2 and 3"), "Done: add 2 and 3.");
  assert.deepEqual(r.calls.map((c) => [c.name, c.input]), [["computer", { action: "shortcut", app: "Calculator", goal: "add 2 and 3" }]]);
  assert.deepEqual(hits, [{ name: "learned", ms: 0 }]);
  await run("open notes");
  assert.deepEqual(r.calls[1]!.name, "open_app", "the fixed command is not replaced");
});

test("learned: a replay that stopped is told as it is, and a refused one goes to the model", async () => {
  const stopped = runner({ content: 'Saved shortcut "add 2 and 3" stopped. Do not replay it; look and finish by hand.' });
  const learned = () => [learnedOf("Calculator", "add 2 and 3")];
  const reply = await createShortcuts({ tools: stopped.tools, apps: async () => APPS, learned })("add 2 and 3");
  assert.match(reply!, /stopped partway/);
  assert.match(reply!, /Nothing more was clicked/);
  const refused = runner({ isError: true, content: "Computer control is off." });
  const fallbacks: unknown[] = [];
  assert.equal(await createShortcuts({ tools: refused.tools, apps: async () => APPS, learned, onFallback: (e) => fallbacks.push(e) })("add 2 and 3"), undefined);
  assert.deepEqual(fallbacks, [{ name: "learned", reason: "tool_error" }]);
});
