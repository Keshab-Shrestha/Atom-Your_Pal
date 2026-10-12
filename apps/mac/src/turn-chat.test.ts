import { test } from "node:test";
import assert from "node:assert/strict";
import type { Core } from "@zeno/core";
import { openHelperStore, createDelegateTool } from "@zeno/helpers";
import { turnChat, withTurnChat } from "./turn-chat.ts";

// ADR-098: two surfaces at once, one shared delegate tool, each goal keeps its own chat.

const tick = () => new Promise((r) => setTimeout(r, 5));

function fakeCore(sessionId: string, tool: ReturnType<typeof createDelegateTool>, goal: string): Core {
  return withTurnChat({
    sessionId,
    async handle() {
      await tick(); // the other surface's turn runs meanwhile
      tool.run({ goal, tasks: [{ worker: "sid", task: "Research" }] });
      await tick();
      return { text: "ok" } as never;
    },
    history: () => [],
    reset() {},
    resume() {},
    prepare() {},
  } as unknown as Core);
}

test("two Cores handle turns at once: each goal gets its own Core's chat", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const tool = createDelegateTool({ store, source: () => turnChat.getStore() });
  await Promise.all([
    fakeCore("telegram", tool, "from phone").handle({ text: "a", source: "text" }),
    fakeCore("api", tool, "from api").handle({ text: "b", source: "text" }),
    fakeCore("chat-7", tool, "from window").handle({ text: "c", source: "text" }),
  ]);
  const source = (text: string) => [1, 2, 3].map((id) => store.goal(id)!).find((g) => g.text === text)?.source;
  assert.deepEqual([source("from phone"), source("from api"), source("from window")], ["telegram", "api", "chat-7"]);
  assert.equal(turnChat.getStore(), undefined, "no chat outside a turn");
});
