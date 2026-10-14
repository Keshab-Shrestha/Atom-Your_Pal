import { test } from "node:test";
import assert from "node:assert/strict";
import { openHelperStore } from "@atom/helpers";
import { SEARCH_HITS, createProposeSkillTool, createSearchChatsTool } from "./reach-tools.ts";

const hit = (n: number) => ({ id: `chat-${n}`, title: `Chat ${n}`, snippet: `Snippet ${n} ${"x".repeat(300)}`, updatedAt: new Date(Date.UTC(2026, 0, n)) });

test("search_chats returns at most five short hits and counts them, never the query", async () => {
  const seen: number[] = [];
  const tool = createSearchChatsTool({ search: () => Array.from({ length: 9 }, (_, i) => hit(i + 1)), onSearch: (e) => seen.push(e.hits) });
  const text = String(await tool.run({ query: "mortgage" }));
  const lines = text.split("\n");
  assert.equal(lines.length, SEARCH_HITS);
  assert.match(lines[0]!, /^- Chat 1 \(2026-01-01\): Snippet 1 x+…$/);
  assert.ok(lines.every((l) => l.length < 260), "each hit is cut short");
  assert.deepEqual(seen, [SEARCH_HITS]);
});

test("search_chats: no hit, an empty query", async () => {
  const tool = createSearchChatsTool({ search: () => [] });
  assert.equal(await tool.run({ query: "nothing" }), "No past chat matches.");
  await assert.rejects(async () => tool.run({ query: "  " }), /query is empty/);
});

test("propose_skill makes a pending draft from a finished task only", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const proposed: string[] = [];
  const tool = createProposeSkillTool({ store, onProposed: (e) => proposed.push(`${e.job}:${e.skill}`) });
  const job = store.addJob("sid", "Compare kits");
  const draft = { job: job.id, name: "compare-kits", description: "Use when comparing products.", body: "1. Find options\n2. Compare prices" };
  await assert.rejects(async () => tool.run(draft), /Only a finished task/);
  store.start(job.id);
  store.finish(job.id, { title: "T", summary: "S.", body: "B", sources: [] });
  await assert.rejects(async () => tool.run({ ...draft, name: "Bad Name" }), /lower-case letters/);
  await assert.rejects(async () => tool.run({ ...draft, job: "x" }), /job must be a task number/);
  assert.match(String(await tool.run(draft)), /Skill "compare-kits" is proposed/);
  assert.deepEqual(proposed, [`${job.id}:compare-kits`]);
  const drafts = store.skillDrafts();
  assert.deepEqual([drafts.length, drafts[0]!.name, drafts[0]!.state], [1, "compare-kits", "pending"]);
  await assert.rejects(async () => tool.run(draft), /already has a skill draft/);
  store.close();
});
