import { test } from "node:test";
import assert from "node:assert/strict";
import { HITS_PER_GROUP, fold, rankHits, score, snippetAround } from "./search-rank.ts";
import { countHits, searchEverything, type EverythingSources } from "./everything-search.ts";

// upgrades.md C1: ranking and the grouped search, on fake sources.

test("score: title start, then a word of the title, then inside the title, then the body", () => {
  const item = (title: string, body?: string) => ({ id: "x", title, ...(body ? { body } : {}) });
  assert.equal(score(item("Mesh Wi-Fi kits"), "mesh"), 4);
  assert.equal(score(item("Best mesh kits"), "mesh"), 3);
  assert.equal(score(item("Meshwork"), "work"), 2, "inside a word is a weaker match");
  assert.equal(score(item("Router", "compare a mesh kit"), "mesh"), 1);
  assert.equal(score(item("Router"), "mesh"), 0);
  assert.equal(score(item("anything"), "   "), 0);
});

test("case and width do not matter; Japanese matches anywhere", () => {
  assert.equal(fold("ＭＥＳＨ　Ｗｉ-Ｆｉ"), "mesh wi-fi");
  assert.equal(score({ id: "1", title: "ﾒｯｼｭ ネットワーク" }, "メッシュ"), 4, "half-width katakana folds to full-width");
  assert.equal(score({ id: "1", title: "ＭＥＳＨ" }, "mesh"), 4);
  assert.equal(score({ id: "1", title: "今日の天気予報" }, "天気"), 3, "no word boundaries in Japanese");
  assert.equal(score({ id: "1", title: "Notes", body: "来週の旅行の計画" }, "旅行"), 1);
});

test("rankHits: better matches first, newer wins a tie, at most eight, ties keep their order", () => {
  const items = [
    { id: "body", title: "Other", body: "has mesh inside" },
    { id: "word", title: "A mesh note" },
    { id: "old", title: "Mesh old", at: "2026-01-01T00:00:00Z" },
    { id: "new", title: "Mesh new", at: "2026-10-01T00:00:00Z" },
    { id: "none", title: "Nothing" },
  ];
  assert.deepEqual(rankHits(items, "mesh").map((h) => h.id), ["new", "old", "word", "body"]);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: `mesh ${i}` }));
  assert.equal(rankHits(many, "mesh").length, HITS_PER_GROUP);
  assert.deepEqual(rankHits(many, "mesh").map((h) => h.id), ["0", "1", "2", "3", "4", "5", "6", "7"]);
});

test("snippetAround: short text stays; long text is cut around the match with …", () => {
  assert.equal(snippetAround("short  text\n here", "text"), "short text here");
  const long = `${"word ".repeat(60)}the NEEDLE is here ${"word ".repeat(60)}`;
  const s = snippetAround(long, "needle");
  assert.ok(s.toLowerCase().includes("needle") && s.startsWith("…") && s.endsWith("…") && s.length <= 100, s);
  assert.ok(snippetAround(long, "absent").startsWith("word word"));
});

const sources: EverythingSources = {
  brain: () => [
    { id: 1, title: "Mesh plan", kind: "note", snippet: "buy the mesh kit in March" },
    { id: 2, title: "A fact", kind: "memory", snippet: "mirrored" },
    { id: 3, title: "Penny", kind: "entity", snippet: "" },
  ],
  facts: () => [{ id: 10, text: "Prefers window seats", createdAt: "2026-09-01T00:00:00Z" }, { id: 11, text: "Mesh Wi-Fi at home", createdAt: "2026-10-01T00:00:00Z" }],
  episodes: () => [{ id: 20, summary: "Talked about a mesh purchase", endedAt: "2026-10-02T00:00:00Z" }],
  projects: () => [
    { id: "p1", name: "Home network", folderLabel: "~/Developer/mesh-setup", archived: false },
    { id: "p2", name: "Mesh old", folderLabel: "~/old", archived: true },
  ],
  agents: () => [
    { id: "sid", name: "Sid", role: "researcher", available: true, routines: [{ id: 5, task: "Mesh deals every Monday", when: "Every Monday at 9:00 AM", lastAt: "2026-10-12T00:00:00Z" }] },
    { id: "tinker", name: "Mesh helper", role: "improver", available: false, routines: [] },
  ],
  skills: () => [{ name: "mesh-compare", description: "Compare mesh Wi-Fi kits" }, { name: "summarise", description: "Short summaries" }],
};

test("searchEverything: every group answers, mirrored brain pages are not doubled, archived and unavailable are left out", () => {
  const r = searchEverything(sources, "mesh");
  assert.deepEqual(r.pages.map((h) => h.id), ["1", "3"], "written pages and names; the memory-kind page is a fact, in its own group");
  assert.deepEqual(r.facts.map((h) => h.id), ["11"]);
  assert.deepEqual(r.notes.map((h) => h.id), ["20"]);
  assert.deepEqual(r.projects.map((h) => h.id), ["p1"], "found in the folder name; the archived project is left out");
  assert.deepEqual(r.agents, [], "Sid does not match 'mesh'; the unavailable helper is left out");
  assert.deepEqual(r.routines.map((h) => h.id), ["5"]);
  assert.match(r.routines[0]!.snippet, /Sid\. Every Monday/);
  assert.deepEqual(r.skills.map((h) => h.id), ["mesh-compare"]);
  assert.equal(r.facts[0]!.at, "2026-10-01T00:00:00.000Z");
  assert.equal(countHits(r), 7);
});

test("searchEverything: empty words give nothing; a source that throws is skipped and the others answer", () => {
  assert.equal(countHits(searchEverything(sources, "   ")), 0);
  const skipped: string[] = [];
  const broken: EverythingSources = { ...sources, facts: () => { throw new Error("db closed"); } };
  const r = searchEverything(broken, "mesh", (g) => skipped.push(g));
  assert.deepEqual(skipped, ["facts"]);
  assert.deepEqual(r.facts, []);
  assert.equal(r.skills.length, 1);
  assert.equal(countHits(searchEverything({}, "mesh")), 0, "no sources: no hits");
});
