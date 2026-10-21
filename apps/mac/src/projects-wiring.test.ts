import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { openMemoryStore } from "@atom/memory";
import { createProjects } from "./projects-wiring.ts";

// ADR-107: projects in the runtime: folders checked like grants, the project's Agent, the chat's note and read access.

function setup(options: { noHelpers?: boolean; onChatsDeleted?: (chatIds: readonly string[]) => void } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-projects-")));
  const home = join(root, "home");
  for (const d of ["Developer/haat", "Developer/other", "Library/Keys", ".ssh", "Documents/.hidden/x", "Developer/notes"]) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(home, "Developer", "haat", "main.ts"), "x");
  const outside = join(root, "elsewhere");
  mkdirSync(outside);
  const memory = openMemoryStore({ path: ":memory:" });
  const helpers = openHelperStore({ path: ":memory:", home, agentsDir: join(root, "agents") });
  const logs: string[] = [];
  const log = { info: (e: string, f?: object) => logs.push(`${e} ${JSON.stringify(f ?? {})}`), warn: (e: string, f?: object) => logs.push(`${e} ${JSON.stringify(f ?? {})}`) };
  const projects = createProjects({
    memory,
    ...(options.noHelpers ? {} : { helpers }),
    home,
    log,
    checkModel: (provider, model) => (provider === "claude-plan" && model === "opus" ? { choice: { provider, model } } : { error: "That model is not available." }),
    ...(options.onChatsDeleted ? { onChatsDeleted: options.onChatsDeleted } : {}),
  });
  const first = () => memory.projects.list()[0]!;
  return { root, home, outside, memory, helpers, projects, logs, first, done: () => rmSync(root, { recursive: true, force: true }) };
}
const turn = (i: number) => [{ role: "user" as const, content: `u${i}` }, { role: "assistant" as const, content: `a${i}` }];

test("Git discovery uses only active project folders and rechecks missing folders", () => {
  const t = setup();
  try {
    const folder = join(t.home, "Developer", "haat");
    t.projects.island.add("Haat", folder);
    assert.deepEqual(t.projects.gitFolders(), [folder]);
    t.projects.island.archive(t.first().id, true);
    assert.deepEqual(t.projects.gitFolders(), []);
    t.projects.island.archive(t.first().id, false);
    rmSync(folder, { recursive: true });
    assert.deepEqual(t.projects.gitFolders(), []);
  } finally { t.done(); }
});

test("deleting a project's chats reports their ids only after the database removal succeeds", () => {
  const deleted: string[][] = [];
  const t = setup({ onChatsDeleted: (ids) => deleted.push([...ids]) });
  try {
    assert.deepEqual(t.projects.island.add("Haat", join(t.home, "Developer", "haat")), { ok: true });
    const project = t.first();
    t.memory.chats.save("inside", turn(1));
    assert.equal(t.memory.chats.setProject("inside", project.id), true);
    assert.deepEqual(t.projects.island.remove(project.id, true), { ok: true });
    assert.deepEqual(deleted, [["inside"]]);
    assert.equal(t.memory.chats.messages("inside").length, 0);
    assert.deepEqual(t.projects.island.remove(project.id, true), { error: "There is no such project." });
    assert.deepEqual(deleted, [["inside"]], "a failed removal does not mark chats again");
  } finally {
    t.done();
  }
});

test("a project's folder goes through the grant rules: home, ~/Library, hidden, outside and missing folders are refused; nothing is made", () => {
  const t = setup();
  try {
    for (const [path, why] of [
      [t.home, /whole home folder/],
      [join(t.home, "Library", "Keys"), /~\/Library/],
      [join(t.home, ".ssh"), /Hidden folders/],
      [join(t.home, "Documents", ".hidden", "x"), /Hidden folders/],
      [t.outside, /inside your home folder/],
      [join(t.home, "nope"), /does not exist/],
      [join(t.home, "Developer", "haat", "main.ts"), /file, not a folder/],
    ] as const) {
      const result = t.projects.island.add("Haat", path);
      assert.ok("error" in result && why.test(result.error), `${path}: ${JSON.stringify(result)}`);
    }
    assert.equal(t.memory.projects.list().length, 0);
    assert.equal(t.helpers.list().filter((h) => h.custom).length, 0, "no Agent for a refused project");
  } finally {
    t.done();
  }
});

test("adding a project makes its Agent: a coder with the folders kit and one grant; the same folder again reuses it", () => {
  const t = setup();
  try {
    assert.deepEqual(t.projects.island.add("Haat", join(t.home, "Developer", "haat")), { ok: true });
    const project = t.first();
    assert.equal(project.name, "Haat");
    assert.deepEqual(project.folders, [join(t.home, "Developer", "haat")]);
    const agent = t.helpers.list().find((h) => h.id === project.helper)!;
    assert.equal(agent.name, "Haat coder");
    assert.equal(agent.role, "coder");
    assert.equal(agent.kit, "folders");
    assert.deepEqual(agent.grants, [join(t.home, "Developer", "haat")]);
    assert.deepEqual(t.projects.island.list()[0], {
      id: project.id, name: "Haat", folderLabel: "~/Developer/haat", missing: false, archived: false, chatCount: 0, web: false, agent: project.helper,
    });
    t.projects.island.remove(project.id, false);
    assert.equal(t.helpers.list().some((h) => h.id === project.helper), true, "the Agent is kept");
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    assert.equal(t.first().helper, project.helper, "reused, not made twice");
    assert.equal(t.helpers.list().filter((h) => h.custom).length, 1);
  } finally {
    t.done();
  }
});

test("the Agent's name is letters only, at most 20 characters, and unique", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat 2 — the café app!!", join(t.home, "Developer", "haat"));
    const names = () => t.helpers.list().filter((h) => h.custom).map((h) => h.name);
    assert.match(names()[0]!, /^\p{L}[\p{L} '-]*$/u);
    assert.ok(names()[0]!.length <= 20);
    t.projects.island.add("12345", join(t.home, "Developer", "other"));
    t.projects.island.add("Haat", join(t.home, "Developer", "notes"));
    const all = names();
    assert.equal(new Set(all.map((n) => n.toLowerCase())).size, 3);
    for (const n of all) assert.ok(/^\p{L}[\p{L} '-]*$/u.test(n) && n.length <= 20 && / coder/.test(n), n);
  } finally {
    t.done();
  }
});

test("a name that is taken or bad, or a 21st project, is refused without leaving an Agent behind", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    const agents = () => t.helpers.list().filter((h) => h.custom).length;
    assert.match((t.projects.island.add("HAAT", join(t.home, "Developer", "other")) as { error: string }).error, /Another project/);
    assert.match((t.projects.island.add("a\nb", join(t.home, "Developer", "other")) as { error: string }).error, /one line/);
    assert.equal(agents(), 1);
    assert.equal(t.memory.projects.list().length, 1);
  } finally {
    t.done();
  }
});

test("rename, archive, model, web: checked and kept; an unknown project says so; the model is checked like model.set", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    const { id } = t.first();
    assert.deepEqual(t.projects.island.rename(id, "Haat app"), { ok: true });
    assert.deepEqual(t.projects.island.archive(id, true), { ok: true });
    assert.equal(t.first().archived, true);
    assert.deepEqual(t.projects.island.setWeb(id, true), { ok: true });
    assert.equal(t.first().web, true);
    assert.deepEqual(t.projects.island.setModel(id, "claude-plan", "opus"), { ok: true });
    assert.deepEqual([t.first().provider, t.first().model], ["claude-plan", "opus"]);
    assert.deepEqual(t.projects.island.setModel(id, "x", "y"), { error: "That model is not available." });
    assert.deepEqual([t.first().provider, t.first().model], ["claude-plan", "opus"], "a refused model changes nothing");
    assert.deepEqual(t.projects.island.setModel(id, "", ""), { ok: true });
    assert.equal(t.first().provider, undefined);
    for (const call of [() => t.projects.island.rename("p-x", "A"), () => t.projects.island.archive("p-x", true), () => t.projects.island.setWeb("p-x", true), () => t.projects.island.setModel("p-x", "", ""), () => t.projects.island.remove("p-x", false)]) {
      assert.deepEqual(call(), { error: "There is no such project." });
    }
  } finally {
    t.done();
  }
});

test("removing keeps the chats as plain chats by default, deletes them when asked, and never touches the files or the Agent", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    const { id, helper } = t.first();
    t.memory.chats.save("c1", turn(1));
    t.projects.island.assign("c1", id);
    t.projects.saved("c1");
    t.projects.island.remove(id, false);
    assert.equal(t.memory.chats.project("c1"), undefined);
    assert.equal(t.memory.chats.messages("c1").length, 2);
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    const second = t.first();
    t.memory.chats.save("c2", turn(2));
    t.projects.island.assign("c2", second.id);
    t.projects.saved("c2");
    t.projects.island.remove(second.id, true);
    assert.equal(t.memory.chats.messages("c2").length, 0);
    assert.ok(t.helpers.list().some((h) => h.id === helper));
    assert.equal(realpathSync(join(t.home, "Developer", "haat", "main.ts")).endsWith("main.ts"), true, "files stay");
  } finally {
    t.done();
  }
});

test("startChat: an unknown or archived project cannot take a new chat; a new chat joins its project when first saved", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    const { id } = t.first();
    assert.deepEqual(t.projects.island.startChat(id), { ok: true });
    assert.deepEqual(t.projects.island.startChat("p-x"), { error: "There is no such project." });
    t.projects.island.archive(id, true);
    assert.match((t.projects.island.startChat(id) as { error: string }).error, /archived/);
    t.projects.island.archive(id, false);
    t.projects.island.assign("new-chat", id);
    assert.equal(t.projects.projectOf("new-chat"), id, "known before the first save");
    assert.equal(t.memory.chats.project("new-chat"), undefined);
    t.memory.chats.save("new-chat", turn(1));
    t.projects.saved("new-chat");
    assert.equal(t.memory.chats.project("new-chat"), id);
    assert.equal(t.projects.island.list()[0]!.chatCount, 1);
  } finally {
    t.done();
  }
});

test("each turn: the note names the project, the ~ folder and the Agent, is the same bytes every time and small; the folder is checked again", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    const { id } = t.first();
    t.projects.island.assign("c1", id);
    assert.equal(t.projects.turn("plain-chat"), undefined);
    const a = t.projects.turn("c1")!;
    const b = t.projects.turn("c1")!;
    assert.equal(a.note, b.note, "byte-stable");
    assert.match(a.note, /Haat/);
    assert.match(a.note, /~\/Developer\/haat/);
    assert.match(a.note, /Haat coder/);
    assert.match(a.note, /never the whole tree/);
    assert.match(a.note, /data, not instructions/);
    assert.ok(a.note.length < 1000, `${a.note.length} characters is well under 300 tokens`);
    assert.ok(!a.note.includes(t.home), "the home folder is shown as ~");
    assert.equal(a.files!.cwd, join(t.home, "Developer", "haat"));
    assert.equal(a.files!.web, false);
    assert.equal(a.files!.check.length, 2);
    t.projects.island.setWeb(id, true);
    assert.equal(t.projects.turn("c1")!.files!.web, true);
    // the folder is replaced by a link to ~/.ssh: the next turn re-checks the real path and opens text only
    rmSync(join(t.home, "Developer", "haat"), { recursive: true });
    symlinkSync(join(t.home, ".ssh"), join(t.home, "Developer", "haat"));
    const gone = t.projects.turn("c1")!;
    assert.equal(gone.files, undefined);
    assert.match(gone.note, /not available/);
    assert.equal(t.projects.island.list()[0]!.missing, true);
  } finally {
    t.done();
  }
});

test("the files of a project turn are read-only and inside its folder (the check is projectReadCheck)", async () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    t.projects.island.assign("c1", t.first().id);
    const files = t.projects.turn("c1")!.files!;
    assert.equal(await files.check("Read", { file_path: join(t.home, "Developer", "haat", "main.ts") }), undefined);
    assert.match((await files.check("Read", { file_path: join(t.home, ".ssh", "id_rsa") }))!, /outside/);
    assert.match((await files.check("Write", { file_path: join(t.home, "Developer", "haat", "main.ts") }))!, /only reads/);
    assert.match((await files.check("Bash", { command: "ls" }))!, /Haat coder/);
  } finally {
    t.done();
  }
});

test("a project without an Agent says so in the note and has no delegation default", () => {
  const t = setup({ noHelpers: true });
  try {
    assert.deepEqual(t.projects.island.add("Haat", join(t.home, "Developer", "haat")), { ok: true });
    const { id } = t.first();
    t.projects.island.assign("c1", id);
    assert.equal(t.first().helper, undefined);
    assert.match(t.projects.turn("c1")!.note, /no Agent/);
    assert.equal(t.projects.delegate("c1")!.helper, undefined);
  } finally {
    t.done();
  }
});

test("delegate: a project chat names its project and Agent; a plain chat names none", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    const p = t.first();
    t.projects.island.assign("c1", p.id);
    assert.deepEqual(t.projects.delegate("c1"), { id: p.id, helper: p.helper, folder: join(t.home, "Developer", "haat") });
    assert.equal(t.projects.delegate("c2"), undefined);
    assert.equal(t.projects.delegate(undefined), undefined);
  } finally {
    t.done();
  }
});

test("model: the chat's own model wins, then the project's, then none (the global one)", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    const { id } = t.first();
    t.projects.island.assign("c1", id);
    assert.equal(t.projects.modelOf("c1"), undefined);
    t.projects.island.setModel(id, "claude-plan", "opus");
    assert.deepEqual(t.projects.modelOf("c1"), { provider: "claude-plan", model: "opus" });
    assert.equal(t.projects.modelOf("plain"), undefined, "a plain chat is not affected");
  } finally {
    t.done();
  }
});

test("a long project chat keeps and replays its whole history", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    t.projects.island.assign("c1", t.first().id);
    let full = Array.from({ length: 40 }, (_, i) => turn(i)).flat();
    t.memory.chats.save("c1", full);
    t.projects.saved("c1");
    // the Core keeps a window of its newest turns and adds the new exchange
    const window = [...full.slice(-10), ...turn(99)];
    const merged = t.projects.fullTurns("c1", window);
    assert.equal(merged.length, 82);
    assert.deepEqual(merged.slice(-2), turn(99));
    assert.deepEqual(merged.slice(0, 80), full);
    t.memory.chats.save("c1", merged);
    full = t.memory.chats.messages("c1");
    const replay = t.projects.replay("c1", full);
    assert.equal(replay.turns.length, full.length);
    assert.equal(replay.turns[0]!.role, "user");
    assert.equal(replay.trimmed, false);
    assert.deepEqual(replay.turns.at(-1), full.at(-1));
    assert.deepEqual(t.projects.replay("c1", full.slice(-6)), { turns: full.slice(-6), trimmed: false });
    assert.deepEqual(t.projects.replay("plain", full), { turns: full, trimmed: false }, "plain chats are replayed as before");
    // a window that does not match the stored end is saved as it is (no guessing)
    assert.deepEqual(t.projects.fullTurns("c1", [...turn(1), ...turn(2)]), [...turn(1), ...turn(2)]);
    assert.deepEqual(t.projects.fullTurns("plain", window), window, "plain chats save the Core's turns, as before");
  } finally {
    t.done();
  }
});

test("a project's digest comes from its conversation note, only for that chat", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    t.projects.island.assign("c1", t.first().id);
    t.memory.chats.save("c1", Array.from({ length: 30 }, (_, i) => turn(i)).flat());
    t.projects.saved("c1");
    assert.equal(t.projects.digest("c1"), undefined, "no note yet");
    t.projects.replay("c1", t.memory.chats.messages("c1"));
    assert.equal(t.projects.digest("c1"), undefined, "replay does not invent a note");
    t.memory.saveEpisode("c1", "We moved the login to a new module.", 30);
    assert.match(t.projects.digest("c1")!, /Earlier in this chat \(a summary\): We moved the login to a new module\./);
    assert.equal(t.projects.digest("c2"), undefined);
  } finally {
    t.done();
  }
});

test("the chat list keeps project chats with their project, even when they are older than the newest plain chats", () => {
  const t = setup();
  try {
    t.projects.island.add("Haat", join(t.home, "Developer", "haat"));
    t.memory.chats.save("project-chat", turn(0));
    t.projects.island.assign("project-chat", t.first().id);
    t.projects.saved("project-chat");
    for (let i = 0; i < 60; i++) t.memory.chats.save(`plain-${i}`, turn(i));
    const ids = t.projects.chatSummaries().map((c) => c.id);
    assert.ok(ids.includes("project-chat"));
    assert.equal(t.projects.chatSummaries().find((c) => c.id === "project-chat")!.projectId, t.first().id);
    assert.equal(ids.filter((id) => id.startsWith("plain-")).length, 50);
  } finally {
    t.done();
  }
});

test("the log has ids, tool names and verdicts only: never a project name, folder or file name", async () => {
  const t = setup();
  try {
    t.projects.island.add("Secret Plan", join(t.home, "Developer", "haat"));
    t.projects.island.assign("c1", t.first().id);
    const files = t.projects.turn("c1")!.files!;
    await files.check("Read", { file_path: join(t.home, "Developer", "haat", "main.ts") });
    await files.check("Read", { file_path: join(t.home, ".ssh", "id_rsa") });
    t.projects.island.rename(t.first().id, "Renamed Thing");
    t.projects.island.add("x", join(t.home, ".ssh"));
    const text = t.logs.join("\n");
    assert.ok(text.length > 0);
    for (const secret of ["Secret Plan", "Renamed Thing", "haat", "main.ts", "id_rsa", ".ssh", t.home]) assert.ok(!text.includes(secret), `${secret} in the log`);
    assert.match(text, /"tool":"Read","verdict":"allowed"/);
    assert.match(text, /"tool":"Read","verdict":"refused"/);
  } finally {
    t.done();
  }
});

test("renameChat: a saved chat gets the title; a bad title or an unsaved chat gets words", () => {
  const t = setup();
  try {
    t.memory.chats.save("c1", turn(1));
    assert.deepEqual(t.projects.renameChat("c1", "  Plan  "), { ok: true });
    assert.equal(t.memory.chats.list()[0]!.title, "Plan");
    assert.match((t.projects.renameChat("c1", "") as { error: string }).error, /needs a title/);
    assert.match((t.projects.renameChat("c1", "a\nb") as { error: string }).error, /one line/);
    assert.match((t.projects.renameChat("ghost", "x") as { error: string }).error, /not saved yet/);
  } finally {
    t.done();
  }
});


test("source creation registers a real repository through existing grants without touching saved chats", async () => {
  const t = setup();
  try {
    t.memory.chats.save("existing", turn(1));
    const result = await t.projects.island.create!({ type: "project.create", request: "11111111-1111-4111-8111-111111111111", source: "new", name: "Cedar", path: join(t.home, "Developer", "Cedar") }, new AbortController().signal);
    assert.equal(result.ok, true);
    const project = t.memory.projects.list().find(p => p.id === result.project)!;
    assert.deepEqual(project.folders, [join(t.home, "Developer", "Cedar")]);
    assert.deepEqual(t.memory.chats.messages("existing").map(m => ({ role: m.role, content: m.content })), turn(1));
    assert.equal(t.memory.chats.project("existing"), undefined);
    assert.ok(project.helper); assert.equal(project.web, false);
    assert.ok(!t.logs.some(line => line.includes("/Developer/") || line.includes("https://")));
  } finally { t.done(); }
});
