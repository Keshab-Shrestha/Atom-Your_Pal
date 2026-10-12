import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { createHubCommands } from "./hub-commands.ts";
import { HubError, type HubClient } from "./skill-hub.ts";

// B3.5, ADR-102: the six skill.hub.* commands joined to the store, with a stub client (no network).

const SHA = "e".repeat(40);
const SHA2 = "f".repeat(40);
const secretUrl = "https://secret.example/found-in-skill";
const text = (body = "Steps.") => `---\nname: x\ndescription: Does a thing.\n---\n\n${body}\nSee ${secretUrl}\n`;

function setup(over: Partial<Record<keyof HubClient, unknown>> = {}) {
  const skillsDir = mkdtempSync(join(tmpdir(), "zeno-skills-"));
  const store = openHelperStore({ path: ":memory:", home: mkdtempSync(join(tmpdir(), "zeno-home-")), skillsDir });
  const logs: string[] = [];
  const state = { head: SHA, body: "Steps." };
  const client = {
    read: async () => "",
    searchHub: async () => [{ name: "pdf-tools", description: "PDFs.", repo: "anthropics/skills", path: "skills/pdf-tools/SKILL.md", sha: SHA, source: 0 }],
    fetchSkill: async (_s: number, path: string, fresh?: boolean) => ({ repo: "anthropics/skills", path, sha: fresh ? state.head : SHA, text: text(state.body) }),
    ...over,
  } as unknown as HubClient;
  const hub = createHubCommands({ store, client, log: { info: (e: string, f?: unknown) => void logs.push(JSON.stringify([e, f])) } });
  return { hub, store, skillsDir, logs, state };
}

test("search keeps the last results for the list; preview, approve install; payload shows pending and installed", async () => {
  const { hub, store, skillsDir } = setup();
  assert.equal(hub.payload(), undefined, "nothing to show: the key is left out");
  await hub.search("pdf");
  assert.equal(hub.payload()!.results[0]!.name, "pdf-tools");
  await hub.preview(0, "skills/pdf-tools/SKILL.md");
  const p = hub.payload()!;
  assert.deepEqual(p.pending.map((x) => [x.kind, x.name, x.sha]), [["new", "pdf-tools", SHA]]);
  assert.ok(p.pending[0]!.flags.some((f) => f.kind === "url"));
  assert.equal(existsSync(join(skillsDir, "pdf-tools")), false);
  hub.approve(p.pending[0]!.id);
  assert.deepEqual(hub.payload()!.installed, [{ name: "pdf-tools", repo: "anthropics/skills", path: "skills/pdf-tools/SKILL.md", sha: SHA }]);
  assert.deepEqual(hub.payload()!.pending, []);
  assert.deepEqual(store.skillHubInstalled().map((i) => i.name), ["pdf-tools"]);
});

test("a network failure is a plain message in the payload; a search without hits says so", async () => {
  const { hub } = setup({ searchHub: async () => { throw new HubError("GitHub's limit for requests without an account is reached. Try again later."); } });
  await hub.search("pdf");
  assert.match(hub.payload()!.message!, /limit/);
  const empty = setup({ searchHub: async () => [] });
  await empty.hub.search("zzz");
  assert.equal(empty.hub.payload()!.message, "No skill has that in its name.");
  await empty.hub.search("zzz");
  assert.deepEqual(empty.hub.payload()!.results, []);
});

test("a store refusal (a HelperError) is thrown to the caller, not hidden as a message", async () => {
  const { hub } = setup({ fetchSkill: async (_s: number, path: string) => ({ repo: "anthropics/skills", path, sha: SHA, text: "a​b" }) });
  await assert.rejects(hub.preview(0, "skills/pdf-tools/SKILL.md"), /hidden characters/);
  assert.equal(hub.payload(), undefined);
  await assert.rejects(async () => hub.approve(99), /No skill from the hub waits/);
  await assert.rejects(async () => hub.reject(99), /No skill from the hub waits/);
});

test("update: no change is a message; a change is a pending update; uninstall removes it", async () => {
  const { hub, state, skillsDir } = setup();
  await hub.preview(0, "skills/pdf-tools/SKILL.md");
  hub.approve(hub.payload()!.pending[0]!.id);
  await hub.update("pdf-tools");
  assert.equal(hub.payload()!.message, "pdf-tools is up to date.");
  state.head = SHA2;
  state.body = "New steps.";
  await hub.update("pdf-tools");
  const [u] = hub.payload()!.pending;
  assert.deepEqual([u!.kind, u!.sha, hub.payload()!.message], ["update", SHA2, undefined]);
  hub.reject(u!.id);
  hub.uninstall("pdf-tools");
  assert.equal(existsSync(join(skillsDir, "pdf-tools")), false);
  assert.equal(hub.payload(), undefined);
});

test("update of an unknown skill is a message", async () => {
  const { hub } = setup();
  await hub.update("nope");
  assert.match(hub.payload()!.message!, /not a skill from the hub/);
});

test("logs carry ids, names, repo and sha only: never the skill text, a found URL or the query", async () => {
  const { hub, logs } = setup();
  await hub.search("my private query");
  await hub.preview(0, "skills/pdf-tools/SKILL.md");
  hub.approve(hub.payload()!.pending[0]!.id);
  await hub.update("pdf-tools");
  hub.uninstall("pdf-tools");
  const all = logs.join("\n");
  assert.ok(logs.length >= 5);
  assert.ok(!all.includes("secret.example") && !all.includes("Steps.") && !all.includes("private query"), all);
  assert.match(all, /pdf-tools/);
});
