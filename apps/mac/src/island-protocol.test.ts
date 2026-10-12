import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_COMMAND_LENGTH, createLevelThrottle, encodeEvent, parseCommand, planUsageEvent } from "./island-protocol.ts";

test("parses every command", () => {
  for (const type of ["talk.start", "talk.send", "talk.cancel", "conversation.reset", "quit"]) {
    assert.deepEqual(parseCommand(JSON.stringify({ type })), { command: { type } });
  }
});

test("ignores extra fields, surrounding spaces and Windows line endings", () => {
  assert.deepEqual(parseCommand(`  {"type":"talk.send","id":7,"future":true}\r`), { command: { type: "talk.send" } });
});

test("blank lines are not errors", () => {
  assert.deepEqual(parseCommand(""), { blank: true });
  assert.deepEqual(parseCommand("   "), { blank: true });
});

test("malformed or unknown commands become errors, never exceptions", () => {
  const cases: [string, RegExp][] = [
    ["not json", /not valid JSON/],
    ["[1,2]", /JSON object/],
    ["null", /JSON object/],
    ['"talk.start"', /JSON object/],
    ['{"kind":"talk.start"}', /no "type"/],
    ['{"type":42}', /no "type"/],
    ['{"type":"rm -rf"}', /Unknown command "rm -rf"/],
    ['{"type":"__proto__"}', /Unknown command/],
  ];
  for (const [line, expected] of cases) {
    const parsed = parseCommand(line);
    assert.ok("error" in parsed, line);
    assert.match(parsed.error, expected, line);
  }
});

test("rejects oversized commands without parsing them", () => {
  const huge = JSON.stringify({ type: "talk.start", pad: "x".repeat(MAX_COMMAND_LENGTH) });
  const parsed = parseCommand(huge);
  assert.ok("error" in parsed);
  assert.match(parsed.error, /too long/);
});

test("unknown command names are shortened in the error", () => {
  const parsed = parseCommand(JSON.stringify({ type: "y".repeat(500) }));
  assert.ok("error" in parsed);
  assert.ok(parsed.error.length < 80);
});

test("events are one line of JSON, even when the text contains line breaks", () => {
  const line = encodeEvent({ type: "reply", text: "Line one.\nLine two.\r\n\u2028Done." });
  assert.ok(line.endsWith("\n"));
  assert.equal(line.slice(0, -1).includes("\n"), false);
  assert.deepEqual(JSON.parse(line), { type: "reply", text: "Line one.\nLine two.\r\n\u2028Done." });
});

test("optional fields that are missing are left out of the event", () => {
  const line = encodeEvent({ type: "turn.complete", speechMs: 1, transcriptionMs: 2, modelMs: 3, firstSoundMs: undefined });
  assert.deepEqual(JSON.parse(line), { type: "turn.complete", speechMs: 1, transcriptionMs: 2, modelMs: 3 });
});

test("level throttle sends at most one level per interval, carrying the loudest peak", () => {
  let t = 0;
  const sent: number[] = [];
  const throttle = createLevelThrottle((p) => sent.push(p), 50, () => t);
  throttle.push(0.1); // first one goes straight out
  t = 10;
  throttle.push(0.9); // a short loud sound between events…
  t = 20;
  throttle.push(0.2);
  t = 60;
  throttle.push(0.05); // …is carried into the next event
  t = 70;
  throttle.push(0.3);
  assert.deepEqual(sent, [0.1, 0.9]);
});

test("level throttle rounds to three decimals and resets between recordings", () => {
  let t = 0;
  const sent: number[] = [];
  const throttle = createLevelThrottle((p) => sent.push(p), 50, () => t);
  throttle.push(0.123456);
  t = 10;
  throttle.push(0.8); // pending when the recording ends
  throttle.reset();
  throttle.push(0.01); // new recording: sent at once, without the old peak
  assert.deepEqual(sent, [0.123, 0.01]);
});

test("parses model.set with its provider and model", () => {
  assert.deepEqual(parseCommand('{"type":"model.set","provider":"gemini","model":"gemini-3.6-flash","extra":1}'), {
    command: { type: "model.set", provider: "gemini", model: "gemini-3.6-flash" },
  });
});

test("model.set without a provider or model string is a protocol error", () => {
  const cases: [object, RegExp][] = [
    [{ type: "model.set" }, /"provider" string/],
    [{ type: "model.set", model: "gemini-3.6-flash" }, /"provider" string/],
    [{ type: "model.set", provider: "gemini" }, /"model" string/],
    [{ type: "model.set", provider: 1, model: "gemini-3.6-flash" }, /"provider" string/],
    [{ type: "model.set", provider: "gemini", model: null }, /"model" string/],
    [{ type: "model.set", provider: "gemini", model: ["gemini-3.6-flash"] }, /"model" string/],
  ];
  for (const [command, expected] of cases) {
    const parsed = parseCommand(JSON.stringify(command));
    assert.ok("error" in parsed, JSON.stringify(command));
    assert.match(parsed.error, expected);
  }
});

test("approval.answer needs an id and a real boolean", () => {
  assert.deepEqual(parseCommand('{"type":"approval.answer","id":"a1","approved":true}'), { command: { type: "approval.answer", id: "a1", approved: true } });
  assert.deepEqual(parseCommand('{"type":"approval.answer","id":"a1","approved":false}'), { command: { type: "approval.answer", id: "a1", approved: false } });
  for (const bad of ['{"type":"approval.answer","approved":true}', '{"type":"approval.answer","id":"","approved":true}', '{"type":"approval.answer","id":"a1"}', '{"type":"approval.answer","id":"a1","approved":"yes"}', '{"type":"approval.answer","id":"a1","approved":1}', '{"type":"approval.answer","id":7,"approved":true}']) {
    assert.ok("error" in parseCommand(bad), bad);
  }
});

test("parses context.window with a bundle id and a name", () => {
  assert.deepEqual(parseCommand('{"type":"context.window","bundleId":"com.brave.Browser","name":"Brave Browser"}'), {
    command: { type: "context.window", bundleId: "com.brave.Browser", name: "Brave Browser" },
  });
});

test("rejects context.window without both strings, or with overlong ones", () => {
  for (const c of [
    { type: "context.window", name: "Brave Browser" },
    { type: "context.window", bundleId: "com.brave.Browser" },
    { type: "context.window", bundleId: "", name: "Brave Browser" },
    { type: "context.window", bundleId: "com.brave.Browser", name: "  " },
    { type: "context.window", bundleId: 7, name: "Brave Browser" },
    { type: "context.window", bundleId: "x".repeat(300), name: "Brave Browser" },
    { type: "context.window", bundleId: "com.brave.Browser", name: "y".repeat(300) },
  ]) {
    const parsed = parseCommand(JSON.stringify(c));
    assert.ok("error" in parsed, JSON.stringify(c));
    assert.match(parsed.error, /context\.window/);
  }
});

test("encodes context.ready, with a message when refused", () => {
  assert.equal(encodeEvent({ type: "context.ready", app: "Brave Browser", ok: true }), '{"type":"context.ready","app":"Brave Browser","ok":true}\n');
  assert.equal(
    encodeEvent({ type: "context.ready", app: "Terminal", ok: false, message: "ATOM doesn't read Terminal." }),
    '{"type":"context.ready","app":"Terminal","ok":false,"message":"ATOM doesn\'t read Terminal."}\n',
  );
});

test("capabilities and plan.usage encode as one JSON line each (ADR-076)", () => {
  assert.equal(
    encodeEvent({ type: "capabilities", items: [{ title: "Open apps and websites", examples: ["Open Safari", "Go to YouTube"] }] }),
    '{"type":"capabilities","items":[{"title":"Open apps and websites","examples":["Open Safari","Go to YouTube"]}]}\n',
  );
  assert.equal(
    encodeEvent({ type: "plan.usage", fiveHour: 0.42, sevenDay: 0.12, overage: false }),
    '{"type":"plan.usage","fiveHour":0.42,"sevenDay":0.12,"overage":false}\n',
  );
});

test("plan usage keeps only sane shares and a true/false overage, and nothing else from the SDK", () => {
  assert.deepEqual(planUsageEvent({ fiveHour: 0.42, sevenDay: 0, overage: true }), { type: "plan.usage", fiveHour: 0.42, sevenDay: 0, overage: true });
  assert.deepEqual(planUsageEvent({ fiveHour: 2, sevenDay: 2.01 }), { type: "plan.usage", fiveHour: 2 });
  assert.deepEqual(planUsageEvent({ fiveHour: -0.1, sevenDay: Number.NaN, overage: "no" }), undefined);
  assert.deepEqual(planUsageEvent({ fiveHour: Infinity, sevenDay: "0.5", overage: false }), { type: "plan.usage", overage: false });
  const extra = { fiveHour: 0.3, token: "secret", resetsAt: 123 } as { fiveHour: number };
  assert.deepEqual(planUsageEvent(extra), { type: "plan.usage", fiveHour: 0.3 });
  assert.equal(planUsageEvent({}), undefined);
});

// --- helpers (ADR-081) ---

test("parses the helper commands", () => {
  const good: object[] = [
    { type: "helpers.list" },
    { type: "helper.set", helper: "sid", app: "Brave Browser" },
    { type: "helper.set", helper: "sid", app: "" },
    { type: "job.add", helper: "sid", task: "research networking" },
    { type: "job.add", helper: "sid", task: "" }, // refused later by the store, with stage "settings"
    { type: "job.stop", id: 12 },
    { type: "job.delete", id: 12 },
    { type: "helper.pin", helper: "sid", model: "claude-sonnet-5-5" },
    { type: "helper.pin", helper: "sid", model: "" },
    { type: "helper.pin", helper: "sid", model: "not-offered" }, // refused later by the helpers, with stage "settings"
    { type: "helpers.settings", allowLarge: false },
    { type: "helpers.settings", allowLarge: true },
    { type: "soul.set", helper: "sid", soul: { name: "Sid", personality: "Curious.", howItWorks: "", rules: "", lessons: "" } },
    { type: "soul.set", helper: "sid", soul: { name: "", personality: "", howItWorks: "", rules: "", lessons: "" } }, // the store refuses
    { type: "soul.restore", helper: "sid", version: 2 },
    { type: "job.add", helper: "hana", task: "Write it up", blockedBy: [1, 2] },
    { type: "job.block", id: 3, blockedBy: [] },
    { type: "comment.add", id: 3, text: "Keep it short" },
    { type: "thread.get", id: 3 },
    { type: "job.fresh", id: 3 },
    { type: "helper.budget", helper: "sid", cap: 2.5 },
    { type: "helper.budget", helper: "team", cap: null },
    { type: "helpers.settings", planLimit: 70 },
    { type: "helpers.settings", maxRunning: 4 },
    { type: "helpers.settings", maxRunning: 40 }, // refused later by the helpers, with stage "settings"
    { type: "job.add", helper: "sid", task: "x", planFirst: true },
    { type: "plan.approve", id: 3 },
    { type: "plan.reject", id: 3 },
    { type: "helper.planFirst", helper: "sid", on: false },
    { type: "routine.delete", id: 2 },
    { type: "grant.add", helper: "kame", path: "/Users/k/Developer/app" },
    { type: "grant.remove", helper: "kame", path: "/Users/k/Developer/app" },
    { type: "helper.skills", helper: "sid", skills: ["pdf"] },
    { type: "job.rate", id: 3, good: false, comment: "Thin" },
    { type: "job.rate", id: 3, good: true },
    { type: "proposal.accept", id: 1 },
    { type: "proposal.reject", id: 1 },
    { type: "proposal.undo", id: 1 },
    { type: "skill.make", id: 4 },
    { type: "skill.approve", id: 1 },
    { type: "skill.reject", id: 1 },
    { type: "skill.hub.search", query: "pdf" },
    { type: "skill.hub.preview", source: 0, path: "skills/pdf/SKILL.md" },
    { type: "skill.hub.approve", id: 3 },
    { type: "skill.hub.reject", id: 3 },
    { type: "skill.hub.uninstall", name: "pdf" },
    { type: "skill.hub.uninstall", name: "pdf", force: true },
    { type: "skill.hub.update", name: "pdf" },
    { type: "skill.edit.accept", id: 2 },
    { type: "skill.edit.reject", id: 2 },
    { type: "skill.edit.undo", id: 2 },
    { type: "job.open", id: 3 },
    { type: "job.retry", id: 3 },
    { type: "speech.set", reports: false, updates: true },
    { type: "git.list" },
    { type: "tools.scan" },
    { type: "git.push", repo: "/Users/me/site", branch: "zeno/task-7" },
    { type: "git.diff", repo: "/Users/me/site", branch: "zeno/task-7" },
    { type: "chats.list" },
    { type: "chat.open", id: "4f1c-aa" },
    { type: "chat.delete", id: "4f1c-aa" },
    { type: "mcp.add", name: "notes", kind: "command", command: "notes-mcp", args: ["--stdio"], env: ["T=1"] },
    { type: "mcp.add", name: "linear", kind: "url", url: "https://x/mcp", transport: "sse", headers: ["A: b"] },
    { type: "mcp.set", id: 1, enabled: true, trusted: false, workers: ["sid"] },
    { type: "mcp.test", id: 1 },
    { type: "mcp.remove", id: 1 },
    { type: "agent.create", name: "Rumi", role: "travel planner", kit: "research", personality: "Calm.", howItWorks: "", rules: "" },
    { type: "agent.remove", id: "rumi" },
  ];
  for (const command of good) assert.deepEqual(parseCommand(JSON.stringify(command)), { command }, JSON.stringify(command));
  assert.deepEqual(parseCommand('{"type":"helpers.list","extra":1}'), { command: { type: "helpers.list" } });
  const soul = { name: "Sid", personality: "x", howItWorks: "", rules: "", lessons: "", tools: ["Bash"] };
  assert.deepEqual(parseCommand(JSON.stringify({ type: "soul.set", helper: "sid", soul })), {
    command: { type: "soul.set", helper: "sid", soul: { name: "Sid", personality: "x", howItWorks: "", rules: "", lessons: "" } },
  }, "fields outside the soul are dropped");
  const long = { type: "soul.set", helper: "sid", soul: { name: "Sid", personality: "x".repeat(600), howItWorks: "\n".repeat(1500), rules: '"'.repeat(1500), lessons: "x".repeat(2000) } };
  assert.ok("command" in parseCommand(JSON.stringify(long)), "the longest soul fits in one command");
});

test("helper commands with missing or wrong fields are protocol errors", () => {
  const bad: [object, RegExp][] = [
    [{ type: "helper.set", app: "Notes" }, /"helper"/],
    [{ type: "helper.set", helper: "", app: "Notes" }, /"helper"/],
    [{ type: "helper.set", helper: "sid" }, /"app"/],
    [{ type: "helper.set", helper: "sid", app: null }, /"app"/],
    [{ type: "job.add", task: "x" }, /"helper"/],
    [{ type: "job.add", helper: 1, task: "x" }, /"helper"/],
    [{ type: "job.add", helper: "sid", task: 5 }, /"task"/],
    [{ type: "job.stop" }, /whole number/],
    [{ type: "job.stop", id: "12" }, /whole number/],
    [{ type: "job.delete", id: 1.5 }, /whole number/],
    [{ type: "helper.pin", model: "x" }, /"helper"/],
    [{ type: "helper.pin", helper: "", model: "x" }, /"helper"/],
    [{ type: "helper.pin", helper: "sid" }, /"model"/],
    [{ type: "helper.pin", helper: "sid", model: null }, /"model"/],
    [{ type: "helpers.settings" }, /"allowLarge"/],
    [{ type: "helpers.settings", allowLarge: "false" }, /"allowLarge"/],
    [{ type: "helpers.settings", maxRunning: "6" }, /"maxRunning" to be a number/],
    [{ type: "soul.set", soul: {} }, /"helper"/],
    [{ type: "soul.set", helper: "sid" }, /"soul" object/],
    [{ type: "soul.set", helper: "sid", soul: ["Sid"] }, /"soul" object/],
    [{ type: "soul.set", helper: "sid", soul: { name: "Sid", personality: "x", howItWorks: "", rules: "" } }, /"soul\.lessons"/],
    [{ type: "soul.set", helper: "sid", soul: { name: 1, personality: "x", howItWorks: "", rules: "", lessons: "" } }, /"soul\.name"/],
    [{ type: "soul.restore", helper: "sid" }, /"version"/],
    [{ type: "soul.restore", helper: "sid", version: 0 }, /"version"/],
    [{ type: "soul.restore", version: 1 }, /"helper"/],
    [{ type: "job.add", helper: "sid", task: "x", blockedBy: [1, "2"] }, /"blockedBy"/],
    [{ type: "job.add", helper: "sid", task: "x", blockedBy: 1 }, /"blockedBy"/],
    [{ type: "job.block", id: 3 }, /"blockedBy"/],
    [{ type: "job.block", id: 0, blockedBy: [] }, /"id"/],
    [{ type: "comment.add", id: 3 }, /"text"/],
    [{ type: "comment.add", text: "x" }, /"id"/],
    [{ type: "thread.get", id: -1 }, /whole number/],
    [{ type: "skill.approve", id: "1" }, /skill.approve needs an "id"/],
    [{ type: "skill.edit.undo" }, /whole number/],
    [{ type: "skill.hub.search" }, /"query"/],
    [{ type: "skill.hub.search", query: "  " }, /"query"/],
    [{ type: "skill.hub.search", query: "x".repeat(61) }, /1 to 60/],
    [{ type: "skill.hub.preview", source: "0", path: "p" }, /"source"/],
    [{ type: "skill.hub.preview", source: -1, path: "p" }, /"source"/],
    [{ type: "skill.hub.preview", source: 0 }, /"path"/],
    [{ type: "skill.hub.approve", id: 0 }, /whole number/],
    [{ type: "skill.hub.reject", id: "1" }, /"id"/],
    [{ type: "skill.hub.uninstall" }, /"name"/],
    [{ type: "skill.hub.uninstall", name: "pdf", force: "yes" }, /"force"/],
    [{ type: "skill.hub.update", name: 5 }, /"name"/],
  ];
  for (const [command, expected] of bad) {
    const parsed = parseCommand(JSON.stringify(command));
    assert.ok("error" in parsed, JSON.stringify(command));
    assert.match(parsed.error, expected, JSON.stringify(command));
  }
});

test("git.push and git.diff take only a full path and a ATOM task branch; chats take an id (ADR-091)", () => {
  const cases: [object, RegExp][] = [
    [{ type: "git.push", repo: "/r", branch: "main" }, /zeno\/task-<id>/],
    [{ type: "git.push", repo: "/r", branch: "zeno/task-7; rm -rf /" }, /zeno\/task-<id>/],
    [{ type: "git.push", repo: "relative/path", branch: "zeno/task-7" }, /full path/],
    [{ type: "git.diff", branch: "zeno/task-7" }, /full path/],
    [{ type: "chat.open", id: "../x" }, /chat's "id"/],
    [{ type: "chat.delete" }, /chat's "id"/],
  ];
  for (const [command, expected] of cases) {
    const parsed = parseCommand(JSON.stringify(command));
    assert.ok("error" in parsed, JSON.stringify(command));
    assert.match(parsed.error, expected);
  }
});

test("ADR-094: team tasks, wake-ups and routine pause parse; bad values are refused", () => {
  assert.deepEqual(parseCommand('{"type":"team.add","task":"Compare apps"}'), { command: { type: "team.add", task: "Compare apps" } });
  assert.deepEqual(parseCommand('{"type":"team.add","task":"x","role":"coder"}'), { command: { type: "team.add", task: "x", role: "coder" } });
  assert.deepEqual(parseCommand('{"type":"team.add","task":"x","role":""}'), { command: { type: "team.add", task: "x" } }, "empty role: anyone");
  assert.ok("error" in parseCommand('{"type":"team.add","role":"coder"}'));
  assert.ok("error" in parseCommand('{"type":"team.add","task":"x","role":7}'));
  assert.deepEqual(parseCommand('{"type":"team.delete","id":3}'), { command: { type: "team.delete", id: 3 } });
  assert.ok("error" in parseCommand('{"type":"team.delete","id":"3"}'));
  assert.deepEqual(parseCommand('{"type":"helper.wakeUp","helper":"sid","every":"4h"}'), { command: { type: "helper.wakeUp", helper: "sid", every: "4h" } });
  assert.deepEqual(parseCommand('{"type":"helper.wakeUp","helper":"sid","every":"off"}'), { command: { type: "helper.wakeUp", helper: "sid", every: "off" } });
  assert.ok("error" in parseCommand('{"type":"helper.wakeUp","helper":"sid","every":"2h"}'));
  assert.deepEqual(parseCommand('{"type":"helper.wakeUp.pause","helper":"sid","paused":true}'), { command: { type: "helper.wakeUp.pause", helper: "sid", paused: true } });
  assert.ok("error" in parseCommand('{"type":"helper.wakeUp.pause","helper":"sid","paused":"yes"}'));
  assert.deepEqual(parseCommand('{"type":"routine.pause","id":2,"paused":false}'), { command: { type: "routine.pause", id: 2, paused: false } });
  assert.ok("error" in parseCommand('{"type":"routine.pause","id":2}'));
});

test("ADR-095: Manager commands parse; bad values are refused", () => {
  assert.deepEqual(parseCommand('{"type":"manager.create","name":"Travel"}'), { command: { type: "manager.create", name: "Travel" } });
  assert.deepEqual(parseCommand('{"type":"manager.create","name":"Travel","mode":"plan"}'), { command: { type: "manager.create", name: "Travel", mode: "plan" } });
  assert.ok("error" in parseCommand('{"type":"manager.create","name":"Travel","mode":"boss"}'));
  assert.ok("error" in parseCommand('{"type":"manager.create"}'));
  assert.deepEqual(parseCommand('{"type":"manager.rename","id":"travel","name":"Trips"}'), { command: { type: "manager.rename", id: "travel", name: "Trips" } });
  assert.ok("error" in parseCommand('{"type":"manager.rename","name":"Trips"}'));
  assert.deepEqual(parseCommand('{"type":"manager.mode","id":"travel","mode":"group"}'), { command: { type: "manager.mode", id: "travel", mode: "group" } });
  assert.ok("error" in parseCommand('{"type":"manager.mode","id":"travel"}'));
  assert.deepEqual(parseCommand('{"type":"manager.delete","id":"travel"}'), { command: { type: "manager.delete", id: "travel" } });
  assert.ok("error" in parseCommand('{"type":"manager.delete","id":3}'));
  assert.deepEqual(parseCommand('{"type":"agent.manager","helper":"sid","manager":"research"}'), { command: { type: "agent.manager", helper: "sid", manager: "research" } });
  assert.ok("error" in parseCommand('{"type":"agent.manager","helper":"sid"}'));
});

test("job.undo: an id, an optional path and force", () => {
  assert.deepEqual(parseCommand('{"type":"job.undo","id":5}'), { command: { type: "job.undo", id: 5 } });
  assert.deepEqual(parseCommand('{"type":"job.undo","id":5,"path":"src/a.ts","force":true}'), { command: { type: "job.undo", id: 5, path: "src/a.ts", force: true } });
  for (const line of ['{"type":"job.undo"}', '{"type":"job.undo","id":0}', '{"type":"job.undo","id":5,"path":""}', '{"type":"job.undo","id":5,"path":7}', '{"type":"job.undo","id":5,"force":"yes"}']) {
    assert.ok("error" in parseCommand(line), line);
  }
});
