import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HAND_BACK_CHARS, callable, checkReportsTo, handBackLine, handBackNeed, createOrgStore, delegationProblem, orgAgentIds, orgPrompt, resolveOrg, teamLine, MAX_ORG_DEPTH } from "./org.ts";

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
  assert.match(a, /\nGive work for an agent with a lead to that lead \(or plan it with plan_work\); .* Call such an agent directly only when the user named it\.\nA report that ends with "Hand back:" means its agent left the choice to you/);
});

test("ADR-272 hand back: only a last line that starts with it counts; the need is one line of at most 300 characters", () => {
  assert.equal(handBackNeed("Done. The table is filled in."), undefined, "a normal report");
  assert.equal(handBackNeed("Hand back: a designer\nThen I stopped."), undefined, "not the last line");
  assert.equal(handBackNeed("I could not do the logo.\n\nHand back: someone who can draw a logo  \n"), "someone who can draw a logo");
  assert.equal(handBackNeed("hand back: a\u2028second\u0007line\rhere"), "a second line here", "control and line separators become spaces");
  assert.equal(handBackNeed(`Hand back: ${"x".repeat(1000)}`)!.length, HAND_BACK_CHARS);
  assert.equal(handBackNeed("Hand back:   "), undefined, "no need given");
  const names = (id: string) => ({ kame: "Kame", sid: "Sid" })[id];
  assert.equal(handBackLine("Kame", "a logo designer", { kame: "sid" }, names), "Kame handed back to ARK: a logo designer. Choose the agent for it (the chart: Sid leads Kame); the usual rules apply.");
  assert.equal(handBackLine("Kame", "a logo designer", {}, names), "Kame handed back to ARK: a logo designer. Choose the agent for it; the usual rules apply.");
});

test("ADR-272: an agent may call its direct reports and its peers, never itself or up the chart", () => {
  const ids = ["ana", "bo", "cy", "di", "ed"];
  const map = { bo: "ana", cy: "ana", di: "bo" }; // ana (to ARK) leads bo and cy; bo leads di; ed reports to ARK
  const names = (id: string) => id.toUpperCase();
  assert.deepEqual(callable("ana", map, ids), { reports: ["bo", "cy"], peers: ["ed"] });
  assert.deepEqual(callable("bo", map, ids), { reports: ["di"], peers: ["cy"] });
  assert.equal(delegationProblem("ana", "bo", map, ids, names), undefined, "a direct report");
  assert.equal(delegationProblem("bo", "cy", map, ids, names), undefined, "a peer under the same lead");
  assert.equal(delegationProblem("ana", "ed", map, ids, names), undefined, "peers that report to ARK");
  assert.match(delegationProblem("ana", "ana", map, ids, names)!, /yourself/);
  assert.match(delegationProblem("di", "bo", map, ids, names)!, /^BO is above you/);
  assert.match(delegationProblem("di", "ana", map, ids, names)!, /^ANA is above you/, "no call up past the lead either");
  assert.match(delegationProblem("ana", "di", map, ids, names)!, /^DI is not one of your reports or peers\. You may call: BO \(bo\), CY \(cy\), ED \(ed\)\./, "not a report's report");
  assert.match(delegationProblem("di", "ed", map, ids, names)!, /You have no one to call\./);
  assert.equal(teamLine("di", map, ids, names), "", "no one to call: no line, no Agent tool");
  assert.match(teamLine("bo", map, ids, names), /^Your reports: DI \(di\)\.\nYour peers: CY \(cy\)\.\n.*Agent tool.*\nYou report only by ending your turn/);
});
