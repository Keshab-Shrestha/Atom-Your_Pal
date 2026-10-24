// A stand-in for `apps/mac/src/main.ts --island` that speaks the same JSON lines, for the bridge tests and for `pnpm --filter @atom/desktop demo`.
// It needs no API keys and keeps two canned chats in memory. Not a model: replies are fixed text. Never ship it as the runtime.
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const exitCode = Number(process.env.FAKE_RUNTIME_EXIT);
if (process.env.FAKE_RUNTIME_EXIT && Number.isInteger(exitCode)) {
  out({ type: "error", stage: exitCode === 78 ? "config" : "runtime", message: `fake runtime exits with ${exitCode}` });
  setTimeout(() => process.exit(exitCode), 20);
} else {
  const chats = [
    { id: "chat-1", title: "Plan a weekend in Kyoto", updatedAt: "2026-10-24T09:12:00Z", messages: 2 },
    { id: "chat-2", title: "Rename the invoice files", updatedAt: "2026-10-23T17:40:00Z", messages: 2 },
    { id: "chat-md", title: "Markdown sample", updatedAt: "2026-10-22T08:00:00Z", messages: 2 },
    { id: "telegram", title: "Telegram", updatedAt: "2026-10-21T08:00:00Z", messages: 1, readOnly: true },
  ];
  const meta = {}; // id -> { pinned, archived, version }
  const withSeq = (id) => history[id].map((m, i) => ({ ...m, seq: i + 1 })); // the saved, 1-based number of each message
  const revisionOf = (id) => createHash("sha256").update(JSON.stringify(history[id])).digest("hex");
  const forks = new Map(); // request uuid -> what it created: one child per request, as in the real runtime
  const metaOf = (id) => (meta[id] ??= { pinned: false, archived: false, version: 0 });
  const history = {
    "chat-1": [
      { role: "user", text: "Which neighbourhood should I stay in?" },
      { role: "assistant", text: "Gion for evenings, or near Kyoto Station if you want easy trains." },
    ],
    "chat-2": [
      { role: "user", text: "Rename the invoice files by date." },
      { role: "assistant", text: "Done. I renamed 12 files to YYYY-MM-DD order." },
    ],
  };
  history.telegram = [{ role: "assistant", text: "Written from the phone." }];
  history["chat-md"] = [
    { role: "user", text: "Show me everything you can format." },
    {
      role: "assistant",
      text: [
        "# Trip plan", "", "Book **two nights** near *Kyoto Station*, see [the guide](https://example.com/kyoto) and `JR Pass` rules.", "",
        "- [x] Flights", "- [ ] Hotel", "  - Gion for evenings", "  - Station for trains", "", "1. Arrive", "2. Check in", "",
        "> Trains stop early on Sundays.", "", "| Day | Plan |", "|:--|--:|", "| Mon | Temples |", "| Tue | Nara |", "",
        "```ts", "const nights = 2;", "```", "", "---", "",
        "Not links: [x](javascript:alert(1)) and <img src=x onerror=alert(1)>",
      ].join("\n"),
    },
  ];
  let current = "chat-1";
  let state = "idle";
  let created = 0;
  let pending;
  let asks = 0;
  let turnTimer;
  const finishTurn = (reply, step) => {
    if (step) out({ type: "computer.step", text: step });
    history[current].push({ role: "assistant", text: reply });
    out({ type: "reply", text: reply });
    out({ type: "turn.complete", speechMs: 0, transcriptionMs: 0, modelMs: 20 });
    out({ type: "computer.end" });
    state = "idle";
    out({ type: "state", state: "idle" });
    sendChats();
  };
  const listed = () =>
    chats.map((c) => ({ ...c, ...(metaOf(c.id).pinned ? { pinned: true } : {}), ...(metaOf(c.id).archived ? { archived: true } : {}), flagsVersion: metaOf(c.id).version }))
      .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true)); // pins sort first, the rest keep their order
  const sendChats = () => out({ type: "chats", chats: listed(), current });
  out({ type: "ready", protocol: 1, provider: "fake", model: "Fake model", microphone: "none", voice: false });
  out({ type: "state", state: "idle" });
  sendChats();
  createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
    let command;
    try {
      command = JSON.parse(line);
    } catch {
      out({ type: "error", stage: "protocol", message: "not JSON" });
      return;
    }
    if (command.type === "quit") process.exit(0);
    else if (command.type === "chats.list") sendChats();
    else if (command.type === "chat.rename") {
      const chat = chats.find((c) => c.id === command.id);
      if (!chat || chat.readOnly) return out({ type: "error", stage: "settings", message: "This chat is written from Telegram. Open it to read it only." });
      if (typeof command.title !== "string" || command.title.trim() === "" || [...command.title].length > 60 || /[\r\n]/.test(command.title)) return out({ type: "error", stage: "settings", message: "A title is 1 to 60 characters on one line." });
      chat.title = command.title.trim();
      sendChats();
    } else if (command.type === "chat.delete") {
      const at = chats.findIndex((c) => c.id === command.id);
      if (at >= 0) chats.splice(at, 1);
      delete history[command.id];
      if (command.id === current) {
        current = chats.find((c) => !c.readOnly)?.id ?? "";
        out({ type: "conversation.reset" });
      }
      sendChats();
    } else if (command.type === "chat.control" && (command.action === "inspect" || command.action === "fork")) {
      const answer = (extra) => out({ type: "chat.control", action: command.action, id: command.id, request: command.request, ...extra });
      if (!history[command.id] || command.id === "telegram-unsaved") return answer({ ok: false, error: "That chat is not saved yet. Send a message first." });
      if (command.action === "inspect") return answer({ ok: true, revision: revisionOf(command.id), info: { messages: history[command.id].length } });
      if (state !== "idle") return answer({ ok: false, error: "Finish or stop the active turn before changing this chat." });
      const count = command.kind === "fork" ? command.through : command.through - 1;
      const earlier = forks.get(command.request);
      if (earlier) {
        if (earlier.source !== command.id || earlier.count !== count || earlier.kind !== command.kind) return answer({ ok: false, error: "That request UUID belongs to a different fork." });
        current = earlier.id;
        out({ type: "chat.opened", id: earlier.id, messages: withSeq(earlier.id) });
        sendChats();
        return answer({ ok: true, branch: { id: earlier.id, kind: command.kind, draft: "", created: false } });
      }
      if (command.revision !== revisionOf(command.id)) return answer({ ok: false, error: "Saved history changed. Refresh history before continuing." });
      const source = history[command.id];
      let draft = "";
      if (command.kind !== "fork") {
        if (source[command.through - 1]?.role !== "user") return answer({ ok: false, error: "Edit and retry need a saved user message." });
        draft = source[command.through - 1].text;
      }
      const id = `fork-${command.request}`;
      history[id] = source.slice(0, count).map((m) => ({ ...m }));
      chats.unshift({ id, title: `Fork of ${chats.find((c) => c.id === command.id)?.title ?? "chat"}`, updatedAt: new Date().toISOString(), messages: count });
      forks.set(command.request, { id, source: command.id, count, kind: command.kind });
      current = id;
      out({ type: "chat.opened", id, messages: withSeq(id) });
      sendChats();
      answer({ ok: true, branch: { id, kind: command.kind, draft, created: true } });
    } else if (command.type === "chat.control" && command.action === "flags") {
      const answer = (extra) => out({ type: "chat.control", action: "flags", id: command.id, request: command.request, ...extra });
      const chat = chats.find((c) => c.id === command.id);
      const m = chat && metaOf(command.id);
      if (command.archived !== undefined && state !== "idle") return answer({ ok: false, error: "Finish or stop the active turn before changing this chat." });
      if (command.archived !== undefined && chat?.readOnly) return answer({ ok: false, error: "Chats shared with Telegram, routines or the API cannot be archived here." });
      if (!m || m.version !== command.version) return answer({ ok: false, error: "Chat metadata changed or the chat is gone. Refresh before changing it again." });
      const previous = { previousPinned: m.pinned, previousArchived: m.archived };
      if (command.pinned !== undefined) m.pinned = command.pinned;
      if (command.archived !== undefined) m.archived = command.archived;
      m.version += 1;
      sendChats();
      answer({ ok: true, metadata: { pinned: m.pinned, archived: m.archived, version: m.version, ...previous } });
    } else if (command.type === "chat.new") {
      const id = `chat-new-${++created}`;
      chats.unshift({ id, title: "New chat", updatedAt: new Date().toISOString(), messages: 0 });
      history[id] = [];
      current = id;
      out({ type: "conversation.reset" });
      sendChats();
    }
    else if (command.type === "chat.open" && history[command.id]) {
      current = command.id;
      out({ type: "chat.opened", id: command.id, messages: withSeq(command.id) });
      sendChats();
    } else if (command.type === "approval.answer") {
      if (!pending || pending.id !== command.id) return; // unknown or closed ids are ignored, as in the real runtime
      const p = pending;
      pending = undefined;
      // A review-bearing request can only be approved with its own token, as in the real runtime.
      const approved = command.approved === true && (!p.review || command.reviewToken === p.review);
      out({ type: "approval.closed", id: p.id });
      clearTimeout(turnTimer);
      finishTurn(approved
        ? `Allowed. Answer received: rememberFile=${command.rememberFile === true}, reviewToken=${command.reviewToken ?? "none"}.`
        : "Declined. I did not do it.", approved ? "Clicking Send" : undefined);
    } else if (command.type === "talk.cancel") {
      if (state === "idle") return;
      if (pending) out({ type: "approval.closed", id: pending.id });
      pending = undefined;
      clearTimeout(turnTimer);
      out({ type: "computer.end" });
      state = "idle";
      out({ type: "state", state: "idle" });
    } else if (command.type === "text.send") {
      if (metaOf(current).archived) return out({ type: "error", stage: "model", message: "This chat is archived. Unarchive it to continue." });
      history[current].push({ role: "user", text: command.text });
      out({ type: "transcript", text: command.text });
      state = "thinking";
      out({ type: "state", state: "thinking" });
      const ask = /ask me(?: (remember|review|access))?/.exec(command.text);
      if (ask) {
        out({ type: "computer.step", text: "Looking at Mail" });
        const kind = ask[1];
        pending = { id: `a${++asks}`, review: kind === "review" ? "tok-123" : undefined };
        out({
          type: "approval.request", id: pending.id, summary: 'Click "Send" in Mail', reason: "You asked me to send the email.",
          ...(kind === "remember" ? { rememberFile: true } : {}),
          ...(kind === "access" ? { accessChange: true, reason: "Full access skips routine prompts in this chat.\nProtected actions still ask." } : {}),
          ...(kind === "review" ? { fileReview: { path: "/tmp/notes.txt", before: "a", after: "b", token: "tok-123" } } : {}),
        });
        return; // the turn waits for approval.answer, talk.cancel, or the user's patience
      }
      if (/work slowly/.test(command.text)) {
        out({ type: "computer.step", text: "Typing in TextEdit" });
        turnTimer = setTimeout(() => finishTurn("Finished slowly.", "Typing in TextEdit"), 600_000);
        return;
      }
      turnTimer = setTimeout(() => finishTurn(`You said: ${command.text}`), 30);
    }
  });
}
