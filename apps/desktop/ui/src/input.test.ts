import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ENTRIES, enqueue, fromSaved, holdAll, markSending, nextToSend, putBack, savedKey, snapshot, started, take, toSaved, type Entry, type Inputs } from "./input.ts";

const entry = (id: string, text = id, files: File[] = []): Entry => ({ id, text, files, lost: 0 });
const file = (name: string) => new File(["x"], name);
const add = (inputs: Inputs, chat: string, ...es: Entry[]) => es.reduce((acc, e) => { const r = enqueue(acc, chat, e); assert.ok(r.ok); return r.inputs; }, inputs);

test("a chat's draft is kept apart from every other chat's, and an empty chat leaves no trace", () => {
  let inputs: Inputs = {};
  inputs = snapshot(inputs, "a", "draft for a", []);
  inputs = snapshot(inputs, "b", "draft for b", [file("x.txt")]);
  assert.equal(inputs.a!.draft, "draft for a");
  assert.equal(inputs.b!.files.length, 1);
  inputs = snapshot(inputs, "a", "", []);
  assert.equal("a" in inputs, false);
});

test("the queue is first in, first out, and one entry is sent at a time", () => {
  let inputs = add({}, "a", entry("1"), entry("2"), entry("3"));
  assert.equal(nextToSend(inputs, "a")!.id, "1");
  inputs = markSending(inputs, "a", "1");
  assert.equal(nextToSend(inputs, "a"), undefined, "the next waits until the turn has started");
  inputs = started(inputs, "a", "1");
  assert.deepEqual(inputs.a!.queue.map((e) => e.id), ["2", "3"]);
  assert.equal(nextToSend(inputs, "a")!.id, "2");
});

test("Stop, an error, leaving the chat or a restart hold everything that still waits, in order, with nothing sent", () => {
  let inputs = add({}, "a", entry("1"), entry("2"), entry("3"));
  inputs = markSending(inputs, "a", "1");
  inputs = holdAll(inputs, "a");
  assert.deepEqual(inputs.a!.held.map((e) => e.id), ["1", "2", "3"]);
  assert.equal(inputs.a!.queue.length, 0);
  assert.equal(nextToSend(inputs, "a"), undefined, "held messages are never sent by themselves");
  const more = add(inputs, "a", entry("4"));
  assert.deepEqual(more.a!.held.map((e) => e.id), ["1", "2", "3"], "a new message does not release the held ones");
  assert.equal(nextToSend(more, "a")!.id, "4");
});

test("holding clears a stuck 'sending' mark even when its entry is already gone", () => {
  let inputs = add({}, "a", entry("1"));
  inputs = markSending(inputs, "a", "1");
  inputs = started(inputs, "a", "1");
  assert.equal("a" in inputs, false);
  assert.equal(holdAll(inputs, "a"), inputs);
});

test("a chat keeps 20 waiting messages, live and held together; a full chat refuses and keeps the incoming message with the user", () => {
  let inputs: Inputs = {};
  for (let i = 0; i < MAX_ENTRIES; i++) inputs = add(inputs, "a", entry(String(i)));
  const refused = enqueue(inputs, "a", entry("extra"));
  assert.equal(refused.ok, false);
  assert.equal(refused.inputs, inputs);
  assert.match((refused as { why: string }).why, /at most 20 waiting messages/);
  const held = holdAll(inputs, "a");
  assert.equal(enqueue(held, "a", entry("extra")).ok, false, "held messages count too");
});

test("an oversized message is refused, not cut", () => {
  const r = enqueue({}, "a", entry("big", "x".repeat(128 * 1024 + 1)));
  assert.equal(r.ok, false);
});

test("Edit takes one entry out, wherever it is, and Remove is the same without putting it back; the one being sent cannot be taken", () => {
  let inputs = add({}, "a", entry("1", "one", [file("f.txt")]), entry("2"));
  inputs = holdAll(add(inputs, "a", entry("3")), "a");
  const taken = take(inputs, "a", "2");
  assert.equal(taken.entry!.id, "2");
  assert.deepEqual(taken.inputs.a!.held.map((e) => e.id), ["1", "3"]);
  assert.equal(taken.entry!.files.length, 0);
  assert.equal(take(inputs, "a", "none").entry, undefined);
  let live = markSending(add({}, "b", entry("9")), "b", "9");
  assert.equal(take(live, "b", "9").entry, undefined, "a message already being sent is not editable");
  assert.deepEqual(putBack(live, "b", entry("8")).b!.queue.map((e) => e.id), ["8", "9"]);
});

test("saving keeps the words and drops the files, counting them; a queued message is saved as held", () => {
  let inputs = snapshot({}, "a", "typed so far", [file("kept-in-memory.txt")]);
  inputs = add(inputs, "a", entry("1", "first", [file("a.txt"), file("b.png")]), entry("2", "second"));
  const saved = toSaved(inputs);
  assert.deepEqual(saved, { version: 1, chats: { a: { draft: "typed so far", held: [{ id: "1", text: "first", lost: 2 }, { id: "2", text: "second", lost: 0 }] } } });
  assert.ok(!JSON.stringify(saved).includes("kept-in-memory"), "no file names or contents are saved");
  const back = fromSaved(saved);
  assert.equal(back.a!.draft, "typed so far");
  assert.deepEqual(back.a!.held.map((e) => [e.id, e.text, e.lost, e.files.length]), [["1", "first", 2, 0], ["2", "second", 0, 0]]);
  assert.equal(back.a!.queue.length, 0, "nothing comes back live");
});

test("chats with nothing to keep are not saved, and what cannot be read comes back empty", () => {
  assert.deepEqual(toSaved(snapshot({}, "a", "", [file("x.txt")])), { version: 1, chats: {} });
  assert.deepEqual(fromSaved(undefined), {});
  assert.deepEqual(fromSaved({ version: 2 } as never), {});
});

test("choosing a file does not change what would be saved", () => {
  const a = snapshot({}, "a", "words", []);
  const b = snapshot(a, "a", "words", [file("new.txt")]);
  assert.equal(savedKey(a), savedKey(b));
});
