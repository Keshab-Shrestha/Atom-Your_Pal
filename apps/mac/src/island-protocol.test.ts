import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_COMMAND_LENGTH, createLevelThrottle, encodeEvent, parseCommand } from "./island-protocol.ts";

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
