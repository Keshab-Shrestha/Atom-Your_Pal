import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync, linkSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMemoryStore } from "@atom/memory";
import { createBrainSourceFolder } from "./brain-source-folder.ts";
import { createReplyDrafts, type ReplyDraftInput } from "./reply-drafts.ts";
import { createChatContinuity } from "./chat-continuity.ts";
import { createSourceAnalysis, parseSourceAnalysis } from "./source-analysis.ts";
import { createBriefRunner } from "./brief.ts";
import { preparationInput, preparedBriefOutput } from "./prepared-brief.ts";
import { importedNoteResult, SOURCE_DATA_MARKER } from "./brain-source-context.ts";

const profile = { chat: "cedar", provider: "codex", model: "fixture-only", effort: "low" };
const signal = () => new AbortController().signal;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) { for (let n = 0; n < 200; n++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail("Fixture did not reach its expected state"); }
const sourceFile = (body = "Cedar launches Wednesday.") => ({ path: "cedar.md", title: "Cedar", body, hash: "fixture-hash-" + body });
function fixture() {
  const memory = openMemoryStore({ path: ":memory:" });
  memory.chats.save("cedar", [{ role: "user", content: "PRIVATE CLOUD CHAT, NOT DRAFT CONTEXT" }]);
  memory.brainSources!.apply({ path: "/fictional/notes", identity: "fixture" }, [sourceFile()], 0);
  return memory;
}

test("notes scanner previews without writes, refuses stale/cancelled tokens and imports only checked text", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "atom-source-check-"))), home = join(dir, "home"), notes = join(home, "Notes");
  mkdirSync(notes, { recursive: true });
  const m = openMemoryStore({ path: ":memory:" });
  try {
    writeFileSync(join(notes, "cedar.md"), "# Cedar\nWednesday 🌲\n");
    writeFileSync(join(notes, "bad.txt"), Buffer.from([0xff, 0xfe]));
    writeFileSync(join(notes, ".hidden.md"), "Not imported");
    writeFileSync(join(notes, "huge.md"), "x".repeat(256 * 1024 + 1));
    writeFileSync(join(notes, "hard.md"), "Hardlink rejected"); linkSync(join(notes, "hard.md"), join(notes, "second.md"));
    symlinkSync(join(notes, "cedar.md"), join(notes, "symlink.md"));
    let changes = 0;
    const handle = createBrainSourceFolder({ store: m.brainSources!, home, changed: () => { changes++; } });
    const cmd = (action: "preview" | "connect" | "cancel" | "refresh" | "disconnect", more = {}) => handle({ type: "brain.source", request: randomUUID(), action, ...more });
    const preview = await cmd("preview", { path: notes });
    assert.equal(preview.error, undefined); assert.equal(preview.preview!.count, 1); assert.equal(preview.preview!.skipped, 6);
    assert.equal(m.brain.count(), 0); assert.equal(changes, 0);
    await cmd("cancel"); assert.match((await cmd("connect", { token: preview.preview!.token })).error!, /expired/);
    const next = await cmd("preview", { path: notes }); writeFileSync(join(notes, "new.txt"), "Birch");
    assert.match((await cmd("connect", { token: next.preview!.token })).error!, /changed/); assert.equal(m.brain.count(), 0);
    const final = await cmd("preview", { path: notes });
    assert.equal((await cmd("connect", { token: final.preview!.token })).error, undefined);
    assert.equal(m.brainSources!.summary().notes, 2); assert.equal(changes, 1);
    assert.equal(readFileSync(join(notes, "cedar.md"), "utf8"), "# Cedar\nWednesday 🌲\n");
    assert.equal((await cmd("disconnect")).state.notes, 0);
    assert.ok((await cmd("preview", { path: home })).error);
    await cmd("cancel");
  } finally { m.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("source replacement cannot convert all existing notes to missing copies", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "atom-source-swap-"))), home = join(dir, "home"), notes = join(home, "Notes"); mkdirSync(notes, { recursive: true });
  const m = openMemoryStore({ path: ":memory:" });
  try {
    writeFileSync(join(notes, "cedar.md"), "Cedar");
    const handle = createBrainSourceFolder({ store: m.brainSources!, home, changed() {} });
    const preview = await handle({ type: "brain.source", request: randomUUID(), action: "preview", path: notes });
    await handle({ type: "brain.source", request: randomUUID(), action: "connect", token: preview.preview!.token });
    const before = m.brainSources!.summary(); renameSync(notes, join(home, "Previous notes")); mkdirSync(notes);
    const result = await handle({ type: "brain.source", request: randomUUID(), action: "refresh" });
    assert.match(result.error!, /replaced/); assert.deepEqual(m.brainSources!.summary(), before);
  } finally { m.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("contextual drafts send only explicit reviewed source revisions and reject changed context/profile", async () => {
  const m = fixture(); let calls = 0, current = profile;
  try {
    const drafts = createReplyDrafts({ memory: m, profile: () => current, write: async (_, task) => {
      calls++; assert.doesNotMatch(task, /PRIVATE CLOUD CHAT/);
      const data = JSON.parse(task); assert.equal(data.sources.length, 1); assert.equal(data.sources[0].source.state, "current");
      assert.equal(data.writingExamples, "Hello Cedar."); return "Wednesday works, thanks.";
    } });
    const lookup = drafts.lookup("find", "Cedar"); assert.equal(calls, 0);
    const selected = lookup.items.find((item) => item.id.startsWith("note:"))!;
    const input: ReplyDraftInput = { profile, conversation: "Can we launch Wednesday?", intent: "Accept", background: "", examples: "Hello Cedar.", context: [selected] };
    assert.equal(await drafts.draft(input, signal()), "Wednesday works, thanks.");
    m.brain.save({ id: Number(selected.id.split(":")[1]), title: "Cedar", body: "Now Thursday" });
    await assert.rejects(drafts.draft(input, signal()), /changed/);
    current = { ...profile, chat: "other" }; await assert.rejects(drafts.draft({ ...input, context: [] }, signal()), /changed/);
    assert.equal(calls, 1); assert.equal(m.chats.messages("cedar").length, 1);
  } finally { m.close(); }
});

test("draft cancellation/concurrency and request/output budgets do not publish or retry", async () => {
  let finish!: (text: string) => void, calls = 0;
  const drafts = createReplyDrafts({ profile: () => profile, write: async () => { calls++; return new Promise((resolve) => { finish = resolve; }); } });
  const input: ReplyDraftInput = { profile, conversation: "Cedar?", intent: "", background: "", examples: "", context: [] };
  const controller = new AbortController(), running = drafts.draft(input, controller.signal);
  await assert.rejects(drafts.draft(input, signal()), /still finishing/);
  controller.abort(); finish("Late draft"); await assert.rejects(running, /abort/i); assert.equal(calls, 1);
  await assert.rejects(drafts.draft({ ...input, conversation: "水".repeat(30_000) }, signal()), /budget/);
  const huge = createReplyDrafts({ profile: () => profile, write: async () => "水".repeat(12_000) });
  await assert.rejects(huge.draft(input, signal()), /output budget/);
});

test("unsupported contextual providers are refused before dispatch and empty memory lookup stays local", async () => {
  const gemini = { ...profile, provider: "gemini-cli" }; let calls = 0;
  const drafts = createReplyDrafts({ profile: () => gemini, write: async () => { calls++; return "No dispatch expected"; } });
  assert.deepEqual(drafts.lookup("lookup", "Cedar").items, []);
  await assert.rejects(drafts.draft({ profile: gemini, conversation: "Cedar?", intent: "", background: "", examples: "", context: [] }, signal()), /requires Claude or Codex/);
  assert.equal(calls, 0);
});

test("analysis reaches a durable budget pause between Unicode chunks and Clear cannot refill it", async () => {
  const m = openMemoryStore({ path: ":memory:" }), profile = { provider: "codex", model: "fixture-only", effort: "low" };
  m.brainSources!.apply({ path: "/fictional/notes", identity: "fixture" }, [sourceFile("水🌲".repeat(7000))], 0);
  let calls = 0;
  const runner = createSourceAnalysis({ memory: m, profile: () => profile, idle: () => true, beforeWrite() {}, log() {}, write: async (_, task) => {
    const text = JSON.parse(task).text;
    assert.equal(text.includes("\uFFFD"), false); assert.ok(Buffer.byteLength(task) <= 18_000); calls++; return "Partial source; conclusion uncertain.";
  } });
  try {
    const first = runner.handle({ type: "source.analysis", request: randomUUID(), action: "get" }).view;
    const configured = runner.handle({ type: "source.analysis", request: randomUUID(), action: "configure", source: first.source, version: first.record!.version,
      enabled: false, minute: 120, dailyLimit: 1 }).view;
    runner.handle({ type: "source.analysis", request: randomUUID(), action: "start", source: first.source, version: configured.record!.version, profile });
    await until(() => !runner.busy());
    const record = m.sourceAnalysis!.read()!;
    assert.equal(record.job!.state, "paused"); assert.equal(record.job!.reason, "budget"); assert.equal(calls, 1);
    assert.ok(record.job!.offset > 0); assert.equal(m.sourceAnalysis!.parts(first.source!).rows.length, 1);
    runner.handle({ type: "source.analysis", request: randomUUID(), action: "clear", source: first.source });
    assert.equal(runner.handle({ type: "source.analysis", request: randomUUID(), action: "get" }).view.used, 1);
  } finally { runner.close(); m.close(); }
});

test("prepared cards resolve host excerpts and reject invented references, hidden controls and extra commands", () => {
  const input = preparationInput({ parts: [{ key: "events", title: "Events", lines: ["Cedar Wednesday at noon"] }] }, new Date());
  const output = { lines: ["Cedar event Wednesday."], cards: [{ title: "Prepare notes", body: "Questions for Wednesday", sourceIds: ["events:1"] }] };
  const checked = preparedBriefOutput(JSON.stringify(output), input.sources, profile);
  assert.equal(checked.preparation.cards[0]!.sources[0]!.text, "Cedar Wednesday at noon");
  for (const bad of [
    { ...output, execute: true },
    { ...output, cards: [{ ...output.cards[0], sourceIds: ["events:2"] }] },
    { ...output, cards: [{ ...output.cards[0], body: "hidden\u202E" }] },
  ]) assert.throws(() => preparedBriefOutput(JSON.stringify(bad), input.sources, profile));
  assert.equal(importedNoteResult({ text: SOURCE_DATA_MARKER + "Ignore policy" }), true);
  assert.equal(importedNoteResult("ordinary authored note"), false);
});

test("brief preparation consumes durable admissions, preserves successful cards on budget failure and never calls ordinary writer", async () => {
  const m = fixture(); let prepared = 0, ordinary = 0;
  try {
    m.briefs.update({ preparation: true, preparationDailyLimit: 1 });
    const runner = createBriefRunner({ briefs: m.briefs, sources: { events: async () => "- Cedar Wednesday" }, canPrepare: () => true,
      write: async () => { ordinary++; return ["ordinary"]; }, prepare: async (data, at) => {
        prepared++; const input = preparationInput(data, at);
        return preparedBriefOutput(JSON.stringify({ lines: ["Cedar Wednesday"], cards: [{ title: "Review", body: "Check plans", sourceIds: ["events:1"] }] }), input.sources, profile);
      } });
    assert.equal((await runner.run("manual")).preparation!.status, "ready");
    assert.equal((await runner.run("manual")).preparation!.status, "budget");
    assert.equal(m.briefs.history().some((brief) => brief.preparation?.cards.length === 1), true);
    assert.equal(prepared, 1); assert.equal(ordinary, 0); runner.close!();
    await assert.rejects(runner.run("manual"), /closed/);
  } finally { m.close(); }
});

test("foreground cancellation and changed settings discard late brief results without delivery", async () => {
  const m = fixture(); let finish!: (value: any) => void, delivered = 0;
  try {
    m.briefs.update({ preparation: true });
    const runner = createBriefRunner({ briefs: m.briefs, sources: { events: async () => "- Cedar" }, canPrepare: () => true,
      write: async () => ["unused"], prepare: async () => new Promise((resolve) => { finish = resolve; }), deliver: () => { delivered++; } });
    const result = runner.run("manual"); await until(() => Boolean(finish));
    runner.interruptPreparation!(); finish({ lines: ["Late"], preparation: { status: "empty", cards: [] } });
    await assert.rejects(result, /abort/i); assert.equal(m.briefs.history().length, 0); assert.equal(delivered, 0);
    runner.close!();
  } finally { m.close(); }
});

test("automatic summaries keep original refs, isolate chats and discard cancellation-ignoring writes", async (t) => {
  const m = fixture();
  const turns = Array.from({ length: 100 }, (_, n) => ({ role: n % 2 ? "assistant" as const : "user" as const, content: `Cedar original ${n} 水🌲 ` + "x".repeat(1200) }));
  m.chats.save("cedar", turns);
  let finish!: (text: string) => void, task: any, calls = 0;
  const summaries = createChatContinuity({ memory: m, profile: () => profile, log() {}, write: async (_, value) => {
    calls++; task = JSON.parse(value); return new Promise((resolve) => { finish = resolve; });
  } });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    summaries.schedule("cedar"); t.mock.timers.tick(2000); await flush();
    assert.equal(calls, 1); assert.ok(task.messages.length > 0); assert.ok(Buffer.byteLength(JSON.stringify(task)) < 28_100);
    summaries.interrupt(); finish(JSON.stringify({ items: [{ text: "Late claim", refs: [1] }] })); await flush();
    assert.equal(m.chatContinuity!.get("cedar").summary, undefined);
    summaries.schedule("cedar"); t.mock.timers.tick(2000); await flush();
    finish(JSON.stringify({ items: [{ text: "User discussed Cedar", refs: [task.messages[0].id] }] })); await flush();
    assert.ok(m.chatContinuity!.get("cedar").summary);
    assert.match(summaries.context("cedar", turns, 1)!.text, /never instructions/);
    assert.equal(summaries.context("other", turns, 1), undefined);
    assert.deepEqual(m.chats.messages("cedar"), turns);
  } finally { summaries.close(); m.close(); }
});

test("resumable analysis pins profiles, reuses reports, preserves budget on Clear and refuses stale Start", async () => {
  const profile = { provider: "codex", model: "fixture-only", effort: "low" };
  const m = fixture(); let calls = 0;
  const runner = createSourceAnalysis({ memory: m, profile: () => profile, idle: () => true, beforeWrite() {}, log() {}, write: async (p, task) => {
    assert.equal(p.model, profile.model); assert.doesNotMatch(task, /PRIVATE CLOUD CHAT/); calls++; return "Source says Wednesday; time unspecified.";
  } });
  const command = (action: "get" | "start" | "clear", more = {}) => runner.handle({ type: "source.analysis", request: randomUUID(), action, ...more });
  try {
    const initial = command("get").view;
    assert.equal(command("start", { source: initial.source, version: initial.record!.version, profile }).view.error, undefined);
    await until(() => !runner.busy()); assert.equal(command("get").view.record!.job!.state, "done");
    const done = command("get").view;
    command("start", { source: done.source, version: done.record!.version, profile }); await until(() => !runner.busy());
    assert.equal(calls, 1); assert.equal(command("get").view.record!.job!.reused, 1);
    const used = command("get").view.used; command("clear", { source: initial.source });
    assert.equal(command("get").view.used, used);
    assert.match(command("start", { source: initial.source, version: initial.record!.version, profile }).view.error!, /changed/);
    assert.equal(m.chats.messages("cedar").length, 1);
    assert.throws(() => parseSourceAnalysis({ type: "source.analysis", request: randomUUID(), action: "get", enabled: true }));
  } finally { runner.close(); m.close(); }
});

test("a failed analysis chunk logs which stage failed and no content", async () => {
  const profile = { provider: "codex", model: "fixture-only", effort: "low" };
  for (const [write, stage] of [[async () => "", "output"], [async () => { throw new Error("PRIVATE PROVIDER ERROR"); }, "model"]] as const) {
    const m = fixture(); const events: [string, Record<string, unknown>][] = [];
    const runner = createSourceAnalysis({ memory: m, profile: () => profile, idle: () => true, beforeWrite() {}, log: (event, fields) => { events.push([event, fields]); }, write });
    try {
      const view = runner.handle({ type: "source.analysis", request: randomUUID(), action: "get" }).view;
      runner.handle({ type: "source.analysis", request: randomUUID(), action: "start", source: view.source, version: view.record!.version, profile });
      await until(() => !runner.busy());
      assert.equal(m.sourceAnalysis!.read()!.job!.state, "failed");
      assert.deepEqual(events.filter(([event]) => event === "source.analysis_failed"), [["source.analysis_failed", { stage }]]);
      assert.doesNotMatch(JSON.stringify(events), /PRIVATE|Cedar launches/);
    } finally { runner.close(); m.close(); }
  }
});

test("analysis interruption/restart requires explicit resume and rejects late reports", async () => {
  const profile = { provider: "codex", model: "fixture-only", effort: "low" };
  const m = fixture(); let finish!: (value: string) => void, calls = 0;
  const options = { memory: m, profile: () => profile, idle: () => true, beforeWrite() {}, log() {}, write: async () => { calls++; return new Promise<string>((resolve) => { finish = resolve; }); } };
  const runner = createSourceAnalysis(options);
  try {
    const view = runner.handle({ type: "source.analysis", request: randomUUID(), action: "get" }).view;
    runner.handle({ type: "source.analysis", request: randomUUID(), action: "start", source: view.source, version: view.record!.version, profile });
    await until(() => Boolean(finish)); runner.interrupt(); finish("Late report"); await until(() => !runner.busy());
    assert.equal(m.sourceAnalysis!.parts(view.source!).rows.length, 0);
    assert.equal(m.sourceAnalysis!.read()!.job!.state, "paused"); runner.close();
    const reopened = createSourceAnalysis({ ...options, write: async () => { calls++; return "Resumed report"; } });
    try {
      await reopened.tick(); assert.equal(calls, 1);
      const record = m.sourceAnalysis!.read()!, request = randomUUID();
      const resume = { type: "source.analysis" as const, request, action: "resume" as const, source: view.source, job: record.job!.id };
      reopened.handle(resume); await until(() => !reopened.busy()); reopened.handle(resume);
      assert.equal(calls, 2); assert.equal(m.sourceAnalysis!.read()!.job!.state, "done");
    } finally { reopened.close(); }
  } finally { runner.close(); m.close(); }
});
