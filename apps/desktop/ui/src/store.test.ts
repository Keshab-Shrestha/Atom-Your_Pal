import { test } from "node:test";
import assert from "node:assert/strict";
import { attachWhy, effectiveModel, initialState, reduce, sendBlock, settingsWhy, type Action, type AppState } from "./store.ts";

const ev = (event: object): Action => ({ kind: "event", event: event as never });
const run = (actions: Action[], from: AppState = initialState) => actions.reduce(reduce, from);

const ready = ev({ type: "ready", protocol: 1, provider: "claude", model: "Claude Sonnet 5.5", microphone: "x", voice: false });
const chats = ev({ type: "chats", current: "c1", chats: [{ id: "c1", title: "One", updatedAt: "2026-10-24T00:00:00Z", messages: 0 }, { id: "c2", title: "Two", updatedAt: "2026-10-23T00:00:00Z", messages: 0, readOnly: true }] });

test("a typed turn adds the user's text and the reply in order, with distinct ids", () => {
  const s = run([ev({ type: "chat.opened", id: "c1", messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] }), ev({ type: "transcript", text: "next" }), ev({ type: "reply", text: "ok" })]);
  assert.deepEqual(s.messages.map((m) => [m.role, m.text]), [["user", "hi"], ["assistant", "hello"], ["user", "next"], ["assistant", "ok"]]);
  assert.equal(new Set(s.messages.map((m) => m.id)).size, 4);
});

test("opening a chat replaces the shown turns and records which chat is open", () => {
  const s = run([ev({ type: "transcript", text: "old" }), ev({ type: "chat.opened", id: "c2", messages: [{ role: "assistant", text: "only reply" }] })]);
  assert.equal(s.openChatId, "c2");
  assert.deepEqual(s.messages.map((m) => m.text), ["only reply"]);
});

test("a new conversation clears the turns until the chats list names the new chat", () => {
  const s = run([ev({ type: "chat.opened", id: "c1", messages: [{ role: "user", text: "x" }] }), ev({ type: "conversation.reset" })]);
  assert.deepEqual(s.messages, []);
  assert.equal(s.openChatId, undefined);
});

test("a model error ends the thinking state and keeps its words; a notice has no stage", () => {
  const thinking = run([ev({ type: "state", state: "thinking" })]);
  assert.equal(thinking.loop, "thinking");
  const failed = reduce(thinking, ev({ type: "error", stage: "model", message: "No internet." }));
  assert.equal(failed.loop, "idle");
  assert.deepEqual(failed.problem, { stage: "model", message: "No internet." });
  const note = reduce(initialState, ev({ type: "notice", kind: "no_speech", message: "Speak closer." }));
  assert.deepEqual(note.problem, { message: "Speak closer." });
});

test("when the runtime stops, the turn in flight and the ready data are forgotten", () => {
  const live = run([ready, ev({ type: "state", state: "speaking" }), { kind: "runtime", status: { state: "running", pid: 1 } }]);
  assert.equal(live.ready?.model, "Claude Sonnet 5.5");
  const down = reduce(live, { kind: "runtime", status: { state: "restarting", afterSeconds: 2 } });
  assert.equal(down.ready, undefined);
  assert.equal(down.loop, "idle");
});

test("sending is blocked, with a reason, until the link, runtime and ready event are all there", () => {
  assert.match(sendBlock(initialState)!, /lost its connection/);
  const linked = run([{ kind: "link", link: "live" }, { kind: "runtime", status: { state: "running", pid: 1 } }, chats]);
  assert.equal(sendBlock(linked), "ATOM is starting.");
  assert.equal(sendBlock(reduce(linked, ready)), undefined);
  const restarting = reduce(linked, { kind: "runtime", status: { state: "restarting", afterSeconds: 4 } });
  assert.match(sendBlock(restarting)!, /restarts in 4 s/);
  const config = reduce(linked, { kind: "runtime", status: { state: "configError", message: "ATOM_ANTHROPIC_API_KEY is missing." } });
  assert.equal(sendBlock(config), "ATOM_ANTHROPIC_API_KEY is missing.");
});

test("a chat written by another surface cannot be typed into", () => {
  const s = run([{ kind: "link", link: "live" }, { kind: "runtime", status: { state: "running", pid: 1 } }, ready, ev({ type: "chats", current: "c2", chats: [{ id: "c2", title: "Telegram", updatedAt: "2026-10-23T00:00:00Z", messages: 1, readOnly: true }] })]);
  assert.match(sendBlock(s)!, /Telegram or the local API/);
});

test("events for screens that are not ported yet change nothing", () => {
  assert.equal(reduce(initialState, ev({ type: "mic.level", peak: 0.4 })), initialState);
});

// ---------- approvals and the work strip (ApprovalState.swift, WorkStripState.swift) ----------

const ask = (id = "a1", extra: object = {}) => ev({ type: "approval.request", id, summary: 'Click "Send" in Mail', reason: "You asked me to send it.", ...extra });
const live = () => run([{ kind: "link", link: "live" }, { kind: "runtime", status: { state: "running", pid: 1 } }, ready]);

test("an approval request shows the strip with its summary and replaces an older request", () => {
  const s = run([ask("a1"), ask("a2", { rememberFile: true })], live());
  assert.equal(s.approval?.id, "a2");
  assert.equal(s.approval?.rememberFile, true);
  assert.deepEqual(s.work, { step: 'Click "Send" in Mail', outcome: "working" });
});

test("a request is closed by approval.closed for its own id only, and by the turn ending", () => {
  const open = run([ask("a1")], live());
  assert.equal(reduce(open, ev({ type: "approval.closed", id: "other" })).approval?.id, "a1");
  assert.equal(reduce(open, ev({ type: "approval.closed", id: "a1" })).approval, undefined);
  assert.equal(reduce(open, ev({ type: "state", state: "idle" })).approval, undefined);
  assert.equal(reduce(open, ev({ type: "conversation.reset" })).approval, undefined);
  assert.equal(reduce(open, ev({ type: "error", stage: "model", message: "No internet." })).approval, undefined);
});

test("an error about another command does not end the turn, drop the request or turn the strip red", () => {
  const open = run([ask("a1")], live());
  for (const stage of ["settings", "protocol"]) {
    const s = reduce(open, ev({ type: "error", stage, message: "bad command" }));
    assert.equal(s.approval?.id, "a1", stage);
    assert.equal(s.work?.outcome, "working", stage);
  }
});

test("the strip says how the turn ended, once, and a new request clears it at once", () => {
  const working = run([ev({ type: "computer.step", text: "Typing in TextEdit. Then more." })], live());
  assert.deepEqual(working.work, { step: "Typing in TextEdit", outcome: "working" });
  const done = reduce(working, ev({ type: "computer.end" }));
  assert.equal(done.work?.outcome, "done");
  assert.equal(reduce(done, ev({ type: "error", stage: "model", message: "x" })).work?.outcome, "done", "an ended strip is not rewritten");
  assert.equal(reduce(working, ev({ type: "error", stage: "model", message: "x" })).work?.outcome, "failed");
  assert.equal(reduce(done, ev({ type: "state", state: "listening" })).work, undefined);
  assert.equal(reduce(done, { kind: "workHide" }).work, undefined);
});

test("Stop clears the request and marks a working strip stopped; answering clears the request", () => {
  const open = run([ask("a1")], live());
  const stopped = reduce(open, { kind: "stopped" });
  assert.equal(stopped.approval, undefined);
  assert.equal(stopped.work?.outcome, "stopped");
  assert.equal(reduce(open, { kind: "answered" }).approval, undefined);
  const finished = run([ev({ type: "computer.step", text: "x" }), ev({ type: "computer.end" })], live());
  assert.equal(reduce(finished, { kind: "stopped" }).work?.outcome, "done", "Stop does not rewrite a finished strip");
});

test("a runtime that stops takes its questions with it", () => {
  const open = run([ask("a1")], live());
  const down = reduce(open, { kind: "runtime", status: { state: "restarting", afterSeconds: 1 } });
  assert.equal(down.approval, undefined);
  assert.equal(down.work, undefined);
});

test("a file review keeps no text and no token", () => {
  const s = run([ask("a1", { fileReview: { path: "/tmp/a", before: "x", after: "y", token: "tok" } })], live());
  assert.deepEqual(s.approval, { id: "a1", summary: 'Click "Send" in Mail', reason: "You asked me to send it.", review: true });
});

test("a running turn does not block the composer: the message is queued (2g), and only a send-now ends the turn", () => {
  const busy = run([ev({ type: "state", state: "thinking" })], live());
  assert.equal(sendBlock(busy), undefined);
});

test("each turn the runtime begins is counted once, however the states are batched", () => {
  const s = run([ev({ type: "state", state: "thinking" }), ev({ type: "state", state: "speaking" }), ev({ type: "state", state: "idle" }), ev({ type: "state", state: "thinking" }), ev({ type: "state", state: "idle" })], live());
  assert.equal(s.turnsStarted, 2);
});

// ---------- chat flags (pin, archive) and Undo ----------

const flagsAnswer = (request: string, extra: object = {}) =>
  ev({ type: "chat.control", action: "flags", id: "c1", request, ok: true, metadata: { pinned: true, archived: false, version: 4, previousPinned: false, previousArchived: false }, ...extra });

test("a flags answer for our own request becomes an Undo with the previous flags and the new version", () => {
  const s = run([{ kind: "mutating", mutation: { request: "r1", done: "Pinned “One”" } }, flagsAnswer("r1")], live());
  assert.equal(s.mutation, undefined);
  assert.deepEqual(s.undo, { id: "c1", pinned: false, archived: false, version: 4, said: "Pinned “One”", undoable: true });
});

test("an answer for another request, or another action, is ignored", () => {
  const waiting = run([{ kind: "mutating", mutation: { request: "r1", done: "x" } }], live());
  assert.equal(reduce(waiting, flagsAnswer("other")), waiting);
  assert.equal(reduce(waiting, ev({ type: "chat.control", action: "inspect", id: "c1", request: "r1", ok: true })), waiting);
});

test("a refused change shows the runtime's words and leaves no Undo", () => {
  const s = run([{ kind: "mutating", mutation: { request: "r1", done: "x" } }, ev({ type: "chat.control", action: "flags", id: "c1", request: "r1", ok: false, error: "Finish or stop the active turn before changing this chat." })], live());
  assert.equal(s.mutation, undefined);
  assert.equal(s.undo, undefined);
  assert.equal(s.problem?.message, "Finish or stop the active turn before changing this chat.");
});

test("a new change drops the old Undo; a timeout reports an unconfirmed change; a stopped runtime forgets the wait", () => {
  const withUndo = run([{ kind: "mutating", mutation: { request: "r1", done: "x" } }, flagsAnswer("r1")], live());
  const next = reduce(withUndo, { kind: "mutating", mutation: { request: "r2", done: "y" } });
  assert.equal(next.undo, undefined);
  assert.match(reduce(next, { kind: "mutationTimeout", request: "r2" }).problem!.message, /did not confirm/);
  assert.equal(reduce(next, { kind: "mutationTimeout", request: "r1" }), next, "a timeout for an old request does nothing");
  assert.equal(reduce(next, { kind: "runtime", status: { state: "restarting", afterSeconds: 1 } }).mutation, undefined);
});

test("an archived chat cannot be typed into until it is unarchived", () => {
  const s = run([ev({ type: "chats", current: "c1", chats: [{ id: "c1", title: "Old", updatedAt: "2026-10-01T00:00:00Z", messages: 2, archived: true }] })], live());
  assert.match(sendBlock(s)!, /archived/);
});

test("the answer to an Undo only confirms: it cannot be undone again", () => {
  const s = run([{ kind: "mutating", mutation: { request: "r1", done: "Undone", undoing: true } }, flagsAnswer("r1")], live());
  assert.equal(s.undo?.undoable, false);
  assert.equal(s.undo?.said, "Undone");
});

// ---------- fork, edit and retry ----------

const op = (extra: object = {}) => ({ stage: "inspecting" as const, kind: "fork" as const, chatId: "c1", through: 2 as number | "all", request: "r1", ...extra });
const inspected = (request = "r1", extra: object = {}) => ev({ type: "chat.control", action: "inspect", id: "c1", request, ok: true, revision: "a".repeat(64), info: { messages: 6 }, ...extra });
const forked = (request: string, extra: object = {}) => ev({ type: "chat.control", action: "fork", id: "c1", request, ok: true, branch: { id: "fork-x", kind: "fork", draft: "", created: true }, ...extra });

test("saved numbers from chat.opened are kept; live turns have none", () => {
  const s = run([ev({ type: "chat.opened", id: "c1", messages: [{ role: "user", text: "a", seq: 1 }, { role: "assistant", text: "b", seq: 2 }] }), ev({ type: "transcript", text: "c" })]);
  assert.deepEqual(s.messages.map((m) => m.seq), [1, 2, undefined]);
});

test("an inspect answer moves a fork on with the revision and size; the fork's answer ends it with its draft", () => {
  const started = run([{ kind: "branchStart", op: op() }], live());
  const ready = reduce(started, inspected());
  assert.deepEqual(ready.branch, op({ stage: "ready", revision: "a".repeat(64), count: 6 }));
  const sent = reduce(ready, { kind: "forkSent", request: "r2" });
  assert.equal(sent.branch?.stage, "forking");
  assert.equal(sent.branch?.request, "r2");
  const done = reduce(sent, forked("r2", { branch: { id: "fork-r2", kind: "edit", draft: "Rename the files", created: true } }));
  assert.equal(done.branch, undefined);
  assert.deepEqual(done.branchResult, { kind: "fork", draft: "Rename the files", created: true });
  assert.equal(reduce(done, { kind: "branchAck" }).branchResult, undefined);
});

test("answers for another request, the wrong stage or a refusal change nothing or end the fork with the runtime's words", () => {
  const started = run([{ kind: "branchStart", op: op() }], live());
  assert.equal(reduce(started, inspected("other")), started);
  assert.equal(reduce(started, forked("r1")), started, "a fork answer cannot arrive before the inspect");
  const refused = reduce(started, ev({ type: "chat.control", action: "inspect", id: "c1", request: "r1", ok: false, error: "That chat is not saved yet. Send a message first." }));
  assert.equal(refused.branch, undefined);
  assert.equal(refused.problem?.message, "That chat is not saved yet. Send a message first.");
});

test("a fork that times out says it may still exist; a stopped runtime forgets the fork", () => {
  const sent = run([{ kind: "branchStart", op: op() }, inspected(), { kind: "forkSent", request: "r2" }], live());
  assert.match(reduce(sent, { kind: "branchTimeout", request: "r2" }).problem!.message, /may still have been created/);
  assert.equal(reduce(sent, { kind: "branchTimeout", request: "old" }), sent);
  assert.equal(reduce(sent, { kind: "runtime", status: { state: "restarting", afterSeconds: 1 } }).branch, undefined);
});

test("sending waits while a chat is being copied", () => {
  assert.match(sendBlock(run([{ kind: "branchStart", op: op() }], live()))!, /copying the chat/);
});

// ---------- model, thinking and access ----------

const info = ev({ type: "info", provider: "claude-plan", model: "claude-sonnet-5-5", providers: [{ id: "claude-plan", name: "Claude", available: true, models: [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }] }] });
const reasoning = { provider: "claude-plan", model: "claude-opus-5-5", levels: ["low", "high"], default: "low", effective: "low" };

test("the default model comes from info; the chat's own model, thinking and access come from the chats event and replace each other with it", () => {
  const withDefault = run([info], live());
  assert.deepEqual(effectiveModel(withDefault), { provider: "claude-plan", model: "claude-sonnet-5-5" });
  const own = reduce(withDefault, ev({ type: "chats", current: "c1", chats: [], currentProvider: "codex", currentModel: "gpt-5.5", reasoning, access: "chat-only" }));
  assert.deepEqual(effectiveModel(own), { provider: "codex", model: "gpt-5.5" });
  assert.equal(own.settings.access, "chat-only");
  assert.deepEqual(own.settings.reasoning, reasoning);
  const back = reduce(own, ev({ type: "chats", current: "c1", chats: [] }));
  assert.deepEqual(effectiveModel(back), { provider: "claude-plan", model: "claude-sonnet-5-5" }, "a chat on the default has no own model");
  assert.equal(back.settings.access, undefined);
});

test("thinking and access wait for a ready, idle, writable chat, and say why", () => {
  const chat = ev({ type: "chats", current: "c1", chats: [{ id: "c1", title: "One", updatedAt: "2026-10-24T00:00:00Z", messages: 1 }] });
  assert.equal(settingsWhy(run([chat], live())), undefined);
  assert.match(settingsWhy(initialState)!, /not ready/);
  assert.match(settingsWhy(run([chat, ev({ type: "state", state: "thinking" })], live()))!, /stop the active turn/);
  const shared = run([ev({ type: "chats", current: "c2", chats: [{ id: "c2", title: "Telegram", updatedAt: "2026-10-24T00:00:00Z", messages: 1, readOnly: true }] })], live());
  assert.match(settingsWhy(shared)!, /another surface/);
});

// ---------- attachments ----------

test("accepted turns and errors are counted, so a send with files can tell which one came back", () => {
  const s = run([ev({ type: "transcript", text: "hi" }), ev({ type: "error", stage: "settings", message: "x.txt looks like a secret or a key file, so ATOM will not read it." }), ev({ type: "error", stage: "model", message: "No internet." })], live());
  assert.equal(s.transcripts, 1);
  assert.equal(s.errors, 2);
});

test("a project chat takes no attachments", () => {
  assert.equal(attachWhy(live()), undefined);
  const project = run([ev({ type: "chats", current: "c1", currentProjectId: "p1", chats: [{ id: "c1", title: "P", updatedAt: "2026-10-24T00:00:00Z", messages: 1, projectId: "p1" }] })], live());
  assert.equal(attachWhy(project), "Project chats take no attachments.");
});

// ---------- recovery ----------

const attempt = (id: string, extra: object = {}) => ({ id, chat: "c1", source: "text", state: "interrupted", createdAt: "2026-10-24T10:00:00Z", updatedAt: "2026-10-24T10:00:01Z", archived: false, dismissed: false, hasReply: false, answerCount: 0, ...extra });
const listed = (request: string, extra: object = {}) => ev({ type: "foreground.recovery", request, ok: true, attempts: [attempt("a1")], known: [], knownAnswers: [], ...extra });

test("a list answer is taken only for the request that asked, and counts once", () => {
  const asked = run([{ kind: "recoveryAsk", what: "listing", request: "r1" }], live());
  assert.equal(reduce(asked, listed("other")), asked);
  const done = reduce(asked, listed("r1", { known: ["k1"] }));
  assert.equal(done.recovery.listing, undefined);
  assert.deepEqual([done.recovery.attempts.length, done.recovery.known, done.recovery.listed], [1, ["k1"], 1]);
});

test("reading shows one record; a refusal shows its words; starting to read clears the old record", () => {
  const record = { ...attempt("a1"), text: "Do it", files: [], notes: [], answers: [], reply: "partial", offset: 0 };
  const s = run([{ kind: "recoveryAsk", what: "reading", request: "r2" }, ev({ type: "foreground.recovery", request: "r2", ok: true, record })], live());
  assert.equal(s.recovery.record?.text, "Do it");
  const again = reduce(s, { kind: "recoveryAsk", what: "reading", request: "r3" });
  assert.equal(again.recovery.record, undefined);
  const refused = reduce(again, ev({ type: "foreground.recovery", request: "r3", ok: false, error: "That recovery record is no longer available." }));
  assert.equal(refused.recovery.notice, "That recovery record is no longer available.");
});

test("a record that is no longer listed leaves the screen", () => {
  const record = { ...attempt("gone"), text: "x", files: [], notes: [], answers: [], reply: "", offset: 0 };
  const s = run([{ kind: "recoveryAsk", what: "reading", request: "r1" }, ev({ type: "foreground.recovery", request: "r1", ok: true, record }), { kind: "recoveryAsk", what: "listing", request: "r2" }, listed("r2")], live());
  assert.equal(s.recovery.record, undefined);
});

test("dismissing clears the open record; a timeout says nothing was resent", () => {
  const record = { ...attempt("a1"), text: "x", files: [], notes: [], answers: [], reply: "", offset: 0 };
  const open = run([{ kind: "recoveryAsk", what: "reading", request: "r1" }, ev({ type: "foreground.recovery", request: "r1", ok: true, record }), { kind: "recoveryAsk", what: "dismissing", request: "r2" }], live());
  const afterListed = reduce(open, { kind: "recoveryAsk", what: "listing", request: "rl" });
  const withList = reduce(afterListed, listed("rl", { attempts: [attempt("a1"), attempt("a2")] }));
  const dismissing = reduce(reduce(withList, { kind: "recoveryAsk", what: "reading", request: "rr" }), ev({ type: "foreground.recovery", request: "rr", ok: true, record }));
  const dismissed = reduce(reduce(dismissing, { kind: "recoveryAsk", what: "dismissing", request: "rd" }), ev({ type: "foreground.recovery", request: "rd", ok: true }));
  assert.deepEqual(dismissed.recovery.attempts.map((a) => a.id), ["a2"], "the dismissed record leaves the list at once");
  assert.equal(reduce(open, ev({ type: "foreground.recovery", request: "r2", ok: true })).recovery.record, undefined);
  const timedOut = reduce(open, { kind: "recoveryTimeout", request: "r2" });
  assert.match(timedOut.recovery.notice!, /nothing is resent automatically/);
  assert.equal(timedOut.recovery.dismissing, undefined);
  assert.equal(reduce(open, { kind: "recoveryTimeout", request: "old" }), open);
});

test("each receipt is kept with a count, so one is acted on once", () => {
  const a = reduce(live(), ev({ type: "foreground.receipt", id: "d1", chat: "c1", state: "running", archived: false }));
  const b = reduce(a, ev({ type: "foreground.receipt", id: "d1", chat: "c1", state: "completed", archived: true }));
  assert.deepEqual([a.receipt?.n, b.receipt?.n, b.receipt?.state, b.receipt?.archived], [1, 2, "completed", true]);
});

test("closing the view drops the open record and notice", () => {
  const s = run([{ kind: "recoveryOpen", open: true }, { kind: "recoveryNotice", notice: "x" }, { kind: "recoveryOpen", open: false }], live());
  assert.deepEqual([s.recovery.open, s.recovery.notice, s.recovery.record], [false, undefined, undefined]);
});

test("reading another part of the open record keeps it on screen; reading a different record clears it first", () => {
  const record = { ...attempt("a1"), text: "x", files: [], notes: [], answers: [], reply: "part one", offset: 0, nextOffset: 8 };
  const open = run([{ kind: "recoveryAsk", what: "reading", request: "r1" }, ev({ type: "foreground.recovery", request: "r1", ok: true, record })], live());
  assert.equal(reduce(open, { kind: "recoveryAsk", what: "reading", request: "r2", keep: true }).recovery.record?.reply, "part one");
  assert.equal(reduce(open, { kind: "recoveryAsk", what: "reading", request: "r2" }).recovery.record, undefined);
});

test("the picker's skills come from helpers and its commands from commands; each replaces the last, unusable names are left out", () => {
  const s = run([
    ev({ type: "helpers", helpers: [], apps: [], skills: [{ name: "pdf", description: "PDFs", source: "yours" }, { name: "two words", description: "x" }] }),
    ev({ type: "commands", commands: [{ name: "review", description: "Review a file.", hint: "[file]" }, { name: "", description: "no name" }] }),
  ]);
  assert.deepEqual(s.slash.skills, [{ name: "pdf", description: "PDFs" }]);
  assert.deepEqual(s.slash.commands, [{ name: "review", description: "Review a file.", hint: "[file]" }]);
  // A helpers event without skills (nothing to show) keeps what was known; a new commands list replaces the old.
  const t = run([ev({ type: "helpers", helpers: [], apps: [] }), ev({ type: "commands", commands: [] })], s);
  assert.deepEqual(t.slash.skills, [{ name: "pdf", description: "PDFs" }]);
  assert.deepEqual(t.slash.commands, []);
});

// ---- the chat brief editor ----
const REQ = "11111111-1111-4111-8111-111111111111";
const REQ2 = "22222222-2222-4222-8222-222222222222";
const briefInspected = (request: string, brief: { text: string; version: number }, id = "c1") => ev({ type: "chat.control", action: "inspect", id, request, ok: true, brief, revision: "r".repeat(64), info: { messages: 2 } });
const briefSaved = (request: string, brief: { text: string; version: number }, id = "c1") => ev({ type: "chat.control", action: "brief", id, request, ok: true, brief });
const briefOpened = (): AppState => run([{ kind: "briefOpen", chatId: "c1", request: REQ }]);

test("the brief editor loads the saved brief once per answer, and only for its own request and chat", () => {
  assert.equal(run([briefInspected(REQ, { text: "x", version: 1 })]).brief, undefined, "nothing is open: nothing is kept");
  const s = run([briefInspected("33333333-3333-4333-8333-333333333333", { text: "x", version: 1 })], briefOpened());
  assert.equal(s.brief?.saved, undefined, "another request is not ours");
  const t = run([briefInspected(REQ, { text: "x", version: 1 }, "c2")], briefOpened());
  assert.equal(t.brief?.saved, undefined, "another chat is not ours");
  const u = run([briefInspected(REQ, { text: "Plan", version: 3 })], briefOpened());
  assert.deepEqual(u.brief?.saved, { text: "Plan", version: 3 });
  assert.equal(u.brief?.loads, 1);
  assert.equal(u.brief?.doing, undefined);
  const again = run([briefInspected(REQ, { text: "Other", version: 4 })], u);
  assert.equal(again.brief?.saved?.version, 3, "an answer nobody waits for changes nothing");
});

test("a failed load says why and keeps nothing", () => {
  const s = run([ev({ type: "chat.control", action: "inspect", id: "c1", request: REQ, ok: false, error: "That chat is not saved yet. Send a message first." })], briefOpened());
  assert.equal(s.brief?.note, "That chat is not saved yet. Send a message first.");
  assert.equal(s.brief?.result, "problem");
  assert.equal(s.brief?.saved, undefined);
  assert.equal(run([{ kind: "briefTimeout", request: REQ }], briefOpened()).brief?.result, "problem", "no answer in time is said, not waited for");
});

test("a save is confirmed by its own answer, which carries the new version; a refusal keeps the old one", () => {
  const loaded = run([briefInspected(REQ, { text: "Plan", version: 3 })], briefOpened());
  const saving = run([{ kind: "briefSave", request: REQ2, text: "Plan 2", version: 3 }], loaded);
  assert.equal(saving.brief?.doing?.what, "saving");
  const done = run([briefSaved(REQ2, { text: "Plan 2", version: 4 })], saving);
  assert.deepEqual(done.brief?.saved, { text: "Plan 2", version: 4 });
  assert.equal(done.brief?.result, "saved");
  assert.equal(done.brief?.loads, 1, "a save does not replace the draft");
  const refused = run([ev({ type: "chat.control", action: "brief", id: "c1", request: REQ2, ok: false, error: "The brief changed or the chat is gone. Reload its current brief before saving again." })], saving);
  assert.deepEqual(refused.brief?.saved, { text: "Plan", version: 3 });
  assert.match(refused.brief?.note ?? "", /Reload its current brief/);
});

test("a save with no answer is unconfirmed; asking again with the same request is answered once, and a late answer still counts", () => {
  const loaded = run([briefInspected(REQ, { text: "Plan", version: 3 })], briefOpened());
  const waiting = run([{ kind: "briefSave", request: REQ2, text: "Plan 2", version: 3 }, { kind: "briefTimeout", request: REQ2 }], loaded);
  assert.deepEqual(waiting.brief?.unconfirmed, { request: REQ2, text: "Plan 2", version: 3 });
  assert.equal(waiting.brief?.doing, undefined);
  const late = run([briefSaved(REQ2, { text: "Plan 2", version: 4 })], waiting);
  assert.equal(late.brief?.unconfirmed, undefined);
  assert.equal(late.brief?.saved?.version, 4);
  const retried = run([{ kind: "briefSave", request: REQ2, text: "Plan 2", version: 3 }], waiting);
  assert.equal(retried.brief?.unconfirmed, undefined);
  assert.equal(retried.brief?.doing?.request, REQ2);
});

test("reloading the saved brief says so, and closing forgets everything", () => {
  const loaded = run([briefInspected(REQ, { text: "Plan", version: 3 })], briefOpened());
  const reloading = run([{ kind: "briefReload", request: REQ2 }], loaded);
  assert.equal(reloading.brief?.doing?.what, "reloading");
  const back = run([briefInspected(REQ2, { text: "Newer", version: 5 })], reloading);
  assert.equal(back.brief?.note, "Loaded the saved brief.");
  assert.equal(back.brief?.loads, 2);
  assert.equal(run([{ kind: "briefClose" }], back).brief, undefined);
});

test("a fork's inspect answer is not mistaken for the editor's, and the editor's is not taken by the fork", () => {
  const s = run([{ kind: "briefOpen", chatId: "c1", request: REQ }, briefInspected("44444444-4444-4444-8444-444444444444", { text: "z", version: 9 })]);
  assert.equal(s.brief?.saved, undefined);
});

// ---- saved history and what a chat remembers ----
const H1 = "55555555-5555-4555-8555-555555555555";
const H2 = "66666666-6666-4666-8666-666666666666";
const page = (request: string, extra: object = {}, id = "c1") => ev({ type: "chat.control", action: "page", id, request, ok: true, revision: "a".repeat(64), page: { messages: [{ seq: 1, role: "user", offset: 0, text: "hi" }, { seq: 2, role: "assistant", offset: 0, text: "hello" }], nextMessage: 3, nextOffset: 0, ...extra } });
const askPage = (request: string, cursor = { message: 1, offset: 0 }, previous: { message: number; offset: number }[] = []): Action => ({ kind: "historyAsk", chatId: "c1", request, cursor, previous });

test("a history page replaces the one on screen, with where Next goes and the revision it was read at", () => {
  const s = run([askPage(H1), page(H1)]);
  assert.equal(s.history?.page?.parts.length, 2);
  assert.deepEqual(s.history?.page?.next, { message: 3, offset: 0 });
  assert.equal(s.history?.page?.revision, "a".repeat(64));
  assert.equal(s.history?.reading, undefined);
  assert.deepEqual(s.history?.cursor, { message: 1, offset: 0 });
  const last = run([askPage(H2, { message: 3, offset: 0 }, [{ message: 1, offset: 0 }]), page(H2, { nextMessage: undefined, messages: [{ seq: 3, role: "user", offset: 0, text: "more" }] })], s);
  assert.equal(last.history?.page?.next, undefined, "the last page has no Next");
  assert.deepEqual(last.history?.previous, [{ message: 1, offset: 0 }], "Previous goes back to where it came from");
});

test("only the awaited page, for its own chat, counts; a refused read keeps the page on screen and says why", () => {
  const shown = run([askPage(H1), page(H1)]);
  assert.equal(run([page(H2)], shown).history?.page?.parts.length, 2, "an unasked page changes nothing");
  assert.equal(run([askPage(H2, { message: 3, offset: 0 }), page(H2, {}, "c2")], shown).history?.reading?.request, H2, "another chat's answer is not ours");
  const refused = run([askPage(H2, { message: 3, offset: 0 }), ev({ type: "chat.control", action: "page", id: "c1", request: H2, ok: false, error: "Saved history changed. Refresh history before continuing." })], shown);
  assert.equal(refused.history?.note, "Saved history changed. Refresh history before continuing.");
  assert.equal(refused.history?.page?.parts.length, 2);
  assert.equal(refused.history?.reading, undefined);
  assert.deepEqual(refused.history?.cursor, { message: 1, offset: 0 }, "the trail does not move on a refusal");
  assert.match(run([askPage(H2), { kind: "historyTimeout", request: H2 }]).history?.note ?? "", /did not arrive/);
  assert.equal(run([{ kind: "historyClose" }], shown).history, undefined);
});

test("what a chat remembers is the answer to its own inspect, and a fork's inspect is not taken for it", () => {
  const info = { messages: 4, archiveBytes: 900, replayBytes: 800, replayBudget: 60000, omitted: 0 };
  const inspect = (request: string, extra: object = {}) => ev({ type: "chat.control", action: "inspect", id: "c1", request, ok: true, revision: "b".repeat(64), info, ...extra });
  const s = run([{ kind: "remembersAsk", chatId: "c1", request: H1 }, inspect(H2), inspect(H1)]);
  assert.equal(s.remembers?.info?.messages, 4);
  assert.equal(s.remembers?.request, undefined);
  const bad = run([{ kind: "remembersAsk", chatId: "c1", request: H1 }, ev({ type: "chat.control", action: "inspect", id: "c1", request: H1, ok: false, error: "That chat is not saved yet. Send a message first." })]);
  assert.equal(bad.remembers?.note, "That chat is not saved yet. Send a message first.");
  assert.match(run([{ kind: "remembersAsk", chatId: "c1", request: H1 }, { kind: "remembersTimeout", request: H1 }]).remembers?.note ?? "", /did not arrive/);
  const again = run([{ kind: "remembersAsk", chatId: "c1", request: H2 }], s);
  assert.equal(again.remembers?.info?.messages, 4, "refreshing keeps what was shown until the new answer arrives");
  assert.equal(run([{ kind: "remembersClose" }], s).remembers, undefined);
});

// ---- the foreground work log ----
const WU = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const workEv = (extra: object = {}, chat = "c1") => ev({ type: "chat.work", chat, turn: WU(1), startedAt: "2026-10-24T00:00:00Z", elapsedMs: 500, state: "working", calls: [{ id: WU(2), tool: "Read", state: "started" }], omitted: 0, questions: [], ...extra });

test("each work snapshot replaces the last and is counted; a snapshot beyond the limits is dropped", () => {
  const a = run([workEv()]);
  assert.equal(a.workLog?.work.calls[0]?.state, "started");
  assert.equal(a.workLog?.n, 1);
  const b = run([workEv({ state: "completed", calls: [{ id: WU(2), tool: "Read", state: "ok", ms: 30 }] })], a);
  assert.equal(b.workLog?.work.state, "completed");
  assert.equal(b.workLog?.n, 2);
  assert.equal(run([workEv({ elapsedMs: -5 })], b).workLog?.n, 2, "an invalid snapshot changes nothing");
});

test("the work log belongs to one chat: another chat or a new one shows none", () => {
  const s = run([workEv()]);
  assert.ok(run([ev({ type: "chat.opened", id: "c1", messages: [] })], s).workLog, "the same chat reopened keeps it");
  assert.equal(run([ev({ type: "chat.opened", id: "c2", messages: [] })], s).workLog, undefined);
  assert.equal(run([ev({ type: "conversation.reset" })], s).workLog, undefined);
});

test("when the window loses the runtime, work in progress is interrupted; finished work is left alone", () => {
  const s = run([workEv()]);
  const cut = run([{ kind: "link", link: "down" }], s);
  assert.equal(cut.workLog?.interrupted, true);
  assert.equal(cut.workLog?.work.calls[0]?.state, "unknown");
  const stopped = run([{ kind: "runtime", status: { state: "restarting", afterSeconds: 2 } }], s);
  assert.equal(stopped.workLog?.interrupted, true);
  const done = run([workEv({ state: "completed" }), { kind: "link", link: "down" }]);
  assert.equal(done.workLog?.interrupted, undefined);
});
