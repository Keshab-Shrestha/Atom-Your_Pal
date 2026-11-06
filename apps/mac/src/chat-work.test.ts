import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolRunner } from "@ark/contracts";
import { createChatWork, type ChatWork } from "./chat-work.ts";

// ADR-275: one ask_user card may carry up to four questions; the card waits until each has an answer or is left blank.
const base: ToolRunner = { specs: () => [], async run(call) { return { callId: call.id, content: "base" }; } };

function setup() {
  const events: ChatWork[] = [];
  const saved: string[] = [];
  const work = createChatWork({ persistAnswer: (_turn, _card, question, answer) => { saved.push(`${question}=${answer}`); } });
  work.attach((event) => events.push(event));
  work.enableCards();
  const end = work.begin("cedar");
  const tools = work.tools("cedar", base);
  const last = () => events[events.length - 1];
  return { work, tools, end, last, saved };
}

test("one call with questions shows every question and settles once all have an answer or a blank", async () => {
  const { work, tools, last, saved } = setup();
  const pending = tools.run({ id: "c1", name: "ask_user", input: { questions: JSON.stringify([
    { question: "Which database?", choices: "Postgres | Fits the stack (recommended)\nSQLite" },
    { question: "When?" },
  ]) } });
  const [first, second] = last().questions;
  assert.equal(last().questions.length, 2);
  assert.deepEqual(first.choices, ["Postgres | Fits the stack (recommended)", "SQLite"]);
  assert.ok(first.state === "pending" && second.state === "pending");
  work.answer("cedar", last().turn, first.id, "Postgres");
  assert.equal(last().questions[0].state, "pending", "the card waits for the second question");
  work.answer("cedar", last().turn, second.id);
  const result = await pending;
  assert.deepEqual(JSON.parse(result.content).answers, [{ question: "Which database?", userAnswer: "Postgres" }, { question: "When?", unanswered: true }]);
  assert.deepEqual(last().questions.map((q) => q.state), ["answered", "skipped"]);
  assert.deepEqual(saved, ["Which database?=Postgres"]);
});

test("a single question keeps its answer format, and the turn's end skips what waits", async () => {
  const { work, tools, last, end } = setup();
  const one = tools.run({ id: "c1", name: "ask_user", input: { question: "Ship today?", choices: "Yes\nNo" } });
  work.answer("cedar", last().turn, last().questions[0].id, "Yes");
  assert.equal(JSON.parse((await one).content).userAnswer, "Yes");
  const two = tools.run({ id: "c2", name: "ask_user", input: { question: "Anything else?" } });
  end("completed");
  assert.match((await two).content, /did not answer/);
  assert.equal(last().questions[1].state, "skipped");
});

test("bad question input is refused with a reason the model can act on", async () => {
  const { tools, last } = setup();
  const refuse = async (input: Record<string, unknown>) => (await tools.run({ id: "x", name: "ask_user", input })).isError;
  assert.ok(await refuse({}));
  assert.ok(await refuse({ question: "A?", questions: "[]" }), "not both forms");
  assert.ok(await refuse({ questions: "not json" }));
  assert.ok(await refuse({ questions: JSON.stringify([1, 2, 3, 4, 5].map((n) => ({ question: `Q${n}?` }))) }), "at most four");
  assert.ok(await refuse({ questions: JSON.stringify([{ question: "A?", extra: 1 }]) }));
  assert.ok(await refuse({ question: "A?", choices: "x".repeat(161) }), "a choice is at most 160 characters");
  assert.equal(last().questions.length, 0);
});
