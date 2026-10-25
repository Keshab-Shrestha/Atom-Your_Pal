import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ENTRIES, MAX_ANSWER_UNITS, acceptedAnswers, addAnswer, answerWhy, dropAcknowledged, pendingAnswers, removeAnswers, enqueue, pendingIds, fromSaved, holdAll, markSending, nextToSend, putBack, savedKey, snapshot, started, take, toSaved, type Entry, type Inputs } from "./input.ts";

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
  assert.deepEqual(saved, { version: 2, chats: { a: { draft: "typed so far", held: [{ id: "1", text: "first", lost: 2 }, { id: "2", text: "second", lost: 0 }], answers: [] } } });
  assert.ok(!JSON.stringify(saved).includes("kept-in-memory"), "no file names or contents are saved");
  const back = fromSaved(saved);
  assert.equal(back.a!.draft, "typed so far");
  assert.deepEqual(back.a!.held.map((e) => [e.id, e.text, e.lost, e.files.length]), [["1", "first", 2, 0], ["2", "second", 0, 0]]);
  assert.equal(back.a!.queue.length, 0, "nothing comes back live");
});

test("chats with nothing to keep are not saved, and what cannot be read comes back empty", () => {
  assert.deepEqual(toSaved(snapshot({}, "a", "", [file("x.txt")])), { version: 2, chats: {} });
  assert.deepEqual(fromSaved(undefined), {});
  assert.deepEqual(fromSaved({ version: 1 } as never), {});
});

test("choosing a file does not change what would be saved", () => {
  const a = snapshot({}, "a", "words", []);
  const b = snapshot(a, "a", "words", [file("new.txt")]);
  assert.equal(savedKey(a), savedKey(b));
});

test("pending ids cover every chat's live and held messages", () => {
  let inputs = add({}, "a", entry("1"), entry("2"));
  inputs = holdAll(inputs, "a");
  inputs = add(inputs, "b", entry("3"));
  assert.deepEqual(pendingIds(inputs).sort(), ["1", "2", "3"]);
});

test("a held message the runtime already has goes, unless it carries files or says files were lost; waiting ones are never dropped", () => {
  let inputs = add({}, "a", entry("plain"), entry("withfile", "x", [file("a.txt")]), { ...entry("lost"), lost: 1 });
  inputs = holdAll(inputs, "a");
  inputs = add(inputs, "a", entry("live"));
  const next = dropAcknowledged(inputs, ["PLAIN", "withfile", "lost", "live"]);
  assert.deepEqual(next.a!.held.map((e) => e.id), ["withfile", "lost"]);
  assert.deepEqual(next.a!.queue.map((e) => e.id), ["live"]);
  assert.equal(dropAcknowledged(inputs, []), inputs);
});

// ---- answers to question cards ----
const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";
const ans = (id: string, answer = "Tuesday") => ({ id, turn: T1, question: "Which day?", answer });

test("an answer is written down per chat, replaces an earlier one for the same card, and is limited to 20", () => {
  const first = addAnswer({}, "a", ans(A1));
  assert.ok(first.ok);
  const again = addAnswer(first.inputs, "a", ans(A1.toUpperCase(), "Wednesday"));
  assert.ok(again.ok);
  assert.deepEqual(again.inputs.a!.answers.map((x) => x.answer), ["Wednesday"], "one per card, the newest words");
  let full: Inputs = {};
  for (let i = 0; i < MAX_ENTRIES; i++) { const r = addAnswer(full, "a", ans(`${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`)); assert.ok(r.ok); full = r.inputs; }
  const over = addAnswer(full, "a", ans(A2));
  assert.ok(!over.ok);
  assert.match(over.ok ? "" : over.why, /Recovery/);
  assert.equal(over.inputs, full, "a refused answer changes nothing");
  assert.ok(addAnswer(full, "b", ans(A2)).ok, "another chat has its own room");
});

test("a chat with only an unconfirmed answer is kept, and it is saved and restored with the words", () => {
  const r = addAnswer({}, "a", ans(A1));
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.inputs), ["a"]);
  const saved = toSaved(r.inputs);
  assert.deepEqual(saved.chats.a!.answers, [ans(A1)]);
  assert.deepEqual(fromSaved(saved).a!.answers, [ans(A1)]);
  assert.deepEqual(pendingAnswers(r.inputs), [{ ...ans(A1), chat: "a" }]);
});

test("a confirmed or dismissed answer leaves, and the chat goes with it when nothing else is kept", () => {
  const two = addAnswer(addAnswer({}, "a", ans(A1)).inputs, "b", ans(A2)).inputs;
  const some = removeAnswers(two, [A1.toUpperCase()]);
  assert.deepEqual(Object.keys(some), ["b"]);
  assert.equal(removeAnswers(some, ["99999999-9999-4999-8999-999999999999"]), some, "an unknown id changes nothing");
  assert.deepEqual(removeAnswers(some, [A2]), {});
  const withDraft = removeAnswers(addAnswer(snapshot({}, "a", "typing", []), "a", ans(A1)).inputs, [A1]);
  assert.equal(withDraft.a!.draft, "typing", "words typed meanwhile stay");
});

test("a work snapshot confirms only an answered card whose words are exactly the ones waiting", () => {
  const inputs = addAnswer({}, "a", ans(A1, "Tuesday")).inputs;
  assert.deepEqual(acceptedAnswers(inputs, [{ id: A1, state: "answered", answer: "Tuesday" }]), [A1]);
  assert.deepEqual(acceptedAnswers(inputs, [{ id: A1, state: "answered", answer: "Monday" }]), [], "other words are not this answer");
  assert.deepEqual(acceptedAnswers(inputs, [{ id: A1, state: "expired" }]), [], "an expired card did not take it");
  assert.deepEqual(acceptedAnswers(inputs, [{ id: A1, state: "skipped" }]), []);
  assert.deepEqual(acceptedAnswers(inputs, [{ id: A1, state: "pending" }]), []);
  assert.deepEqual(acceptedAnswers(inputs, [{ id: A2, state: "answered", answer: "Tuesday" }]), [], "another card");
});

test("an answer must have words and fit the runtime's limit", () => {
  assert.match(answerWhy("   ")!, /Skip/);
  assert.equal(answerWhy(" Tuesday "), undefined);
  assert.equal(answerWhy("x".repeat(MAX_ANSWER_UNITS)), undefined);
  assert.match(answerWhy("x".repeat(MAX_ANSWER_UNITS + 1))!, /2000/);
});
