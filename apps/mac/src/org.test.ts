import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReportsTo, createOrgStore, orgAgentIds, orgPrompt, resolveOrg, MAX_ORG_DEPTH } from "./org.ts";

const ids = ["kame", "lyra", "pk", "sid", "quill"];

test("orgAgentIds leaves Tinker (the improver) out", () => {
  assert.deepEqual(orgAgentIds([{ id: "sid", role: "researcher" }, { id: "tinker", role: "improver" }]), ["sid"]);
});

test("checkReportsTo refuses unknown agents, self-leads, loops and too many levels", () => {
  assert.throws(() => checkReportsTo("nobody", "kame", {}, ids), /not on your team/);
  assert.throws(() => checkReportsTo("sid", "tinker", {}, ids), /lead is not on your team/);
  assert.throws(() => checkReportsTo("sid", "sid", {}, ids), /cannot lead itself/);
  assert.throws(() => checkReportsTo("kame", "sid", { sid: "kame" }, ids), /already works under kame/);
  assert.throws(() => checkReportsTo("kame", "pk", { sid: "kame", pk: "sid" }, ids), /already works under/, "a longer loop");
  const deep = { lyra: "kame", pk: "lyra", sid: "pk" }; // kame 1, lyra 2, pk 3, sid 4
  assert.equal(MAX_ORG_DEPTH, 4);
  assert.throws(() => checkReportsTo("quill", "sid", deep, ids), /at most 4 levels/);
  assert.throws(() => checkReportsTo("kame", "quill", deep, ids), /at most 4 levels/, "moving a whole branch down counts its people");
  assert.deepEqual(checkReportsTo("quill", "pk", deep, ids), { ...deep, quill: "pk" });
  assert.deepEqual(checkReportsTo("sid", null, deep, ids), { lyra: "kame", pk: "lyra" }, "null: reports to ARK");
});

test("a removed lead's reports move up to its own lead, or ARK; a removed agent's entry goes", () => {
  const raw = { lyra: "kame", pk: "lyra", sid: "pk" };
  assert.deepEqual(resolveOrg(raw, ["kame", "pk", "sid"]), { pk: "kame", sid: "pk" });
  assert.deepEqual(resolveOrg(raw, ["pk", "sid"]), { sid: "pk" });
  assert.deepEqual(resolveOrg({ a: "b", b: "a" }, ["a", "b"]), {}, "a hand-made loop is dropped");
});

test("the store round-trips owner-only, refuses with words, and prunes removed agents", () => {
  const dir = mkdtempSync(join(tmpdir(), "ark-org-"));
  const path = join(dir, "data", "org.json");
  let team = [...ids];
  try {
    const store = createOrgStore(path, () => team);
    assert.deepEqual(store.map(), {});
    store.set("sid", "kame");
    store.set("pk", "kame");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, "data")).mode & 0o777, 0o700);
    assert.deepEqual(createOrgStore(path, () => team).map(), { pk: "kame", sid: "kame" }, "read back from the file");
    assert.throws(() => store.set("kame", "sid"), /already works under/);
    store.set("pk", null);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { version: 1, reportsTo: { sid: "kame" } });
    team = team.filter((id) => id !== "kame");
    assert.deepEqual(store.map(), {}, "read drops it at once");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).reportsTo.sid, "kame", "read alone does not rewrite the file");
    assert.equal(store.prune(), true);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).reportsTo, {});
    assert.equal(store.prune(), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a broken file reads as no chart and is never overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "ark-org-"));
  const path = join(dir, "org.json");
  const problems: string[] = [];
  try {
    writeFileSync(path, "{not json");
    const store = createOrgStore(path, () => ids, (m) => problems.push(m));
    assert.deepEqual(store.map(), {});
    assert.equal(problems.length, 1);
    assert.throws(() => store.set("sid", "kame"), /not valid JSON/);
    assert.equal(readFileSync(path, "utf8"), "{not json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("orgPrompt is empty without leads, and sorted and stable with them", () => {
  const names = (id: string) => ({ kame: "Kame", lyra: "Lyricists", pk: "ProjectK", sid: "Sid" })[id];
  assert.equal(orgPrompt({}, names), "");
  const a = orgPrompt({ pk: "kame", lyra: "kame", kame: "sid" }, names);
  const b = orgPrompt({ kame: "sid", lyra: "kame", pk: "kame" }, names);
  assert.equal(a, b, "the order of the map does not matter");
  assert.match(a, /^Team: Kame leads Lyricists, ProjectK; Sid leads Kame\.\n/);
  assert.match(a, /call plan_work with a first portion for the lead .* a last portion for the lead to review their reports\. Small single-step work may go straight to the worker\.$/);
});
