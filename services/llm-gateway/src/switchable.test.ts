import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel, ModelRequest } from "@zeno/contracts";
import { createSwitchableModel } from "./switchable.ts";

const request: ModelRequest = {
  system: "be brief",
  messages: [{ role: "user", content: "hi" }],
  context: { requestId: "r1", sessionId: "s1", source: "voice", receivedAt: new Date(0) },
};

const fixed = (text: string): LanguageModel => ({ complete: async () => ({ text }) });

test("uses the replacement model for the next request", async () => {
  const model = createSwitchableModel(fixed("old"));
  assert.equal((await model.complete(request)).text, "old");
  model.replace(fixed("new"));
  assert.equal((await model.complete(request)).text, "new");
});

test("a request in flight finishes on the model it started with", async () => {
  let finish: (text: string) => void = () => {};
  const slow: LanguageModel = { complete: () => new Promise((resolve) => (finish = (text) => resolve({ text }))) };
  const model = createSwitchableModel(slow);
  const inFlight = model.complete(request);
  model.replace(fixed("new"));
  finish("old");
  assert.equal((await inFlight).text, "old");
  assert.equal((await model.complete(request)).text, "new");
});

test("passes the cancel signal through", async () => {
  let seen: AbortSignal | undefined;
  const model = createSwitchableModel({ complete: async (_r, signal) => ((seen = signal), { text: "ok" }) });
  const controller = new AbortController();
  await model.complete(request, controller.signal);
  assert.equal(seen, controller.signal);
});
