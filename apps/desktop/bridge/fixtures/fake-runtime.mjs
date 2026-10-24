// A stand-in for `apps/mac/src/main.ts --island` that speaks the same JSON lines, for the bridge tests and for `pnpm --filter @atom/desktop demo`.
// It needs no API keys and keeps two canned chats in memory. Not a model: replies are fixed text. Never ship it as the runtime.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
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
    { id: "chat-proj", title: "Project chat", updatedAt: "2026-10-20T08:00:00Z", messages: 1, projectId: "p1" },
  ];
  const meta = {}; // id -> { pinned, archived, version }
  // Models, thinking and access, as the real runtime offers them (docs/island-protocol.md, ADR-097/180/181).
  const providers = [
    { id: "claude-plan", name: "Claude (my plan)", available: true, models: [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }, { id: "claude-opus-5-5", name: "Claude Opus 5.5" }, { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" }] },
    { id: "codex", name: "Codex", available: true, models: [{ id: "codex-default", name: "Codex default" }, { id: "gpt-5.5", name: "GPT 5.5" }] },
    { id: "gemini-cli", name: "Gemini CLI", available: true, models: [{ id: "gemini-default", name: "Gemini default" }] },
  ];
  const defaults = { provider: "claude-plan", model: "claude-sonnet-5-5" };
  const own = {}; // chat id -> { provider?, model?, efforts: {"provider/model": level}, access }
  const ownOf = (id) => (own[id] ??= { efforts: {}, access: "checked" });
  const sendInfo = () => out({ type: "info", ...defaults, providers });
  const effectiveOf = (id) => ({ provider: ownOf(id).provider ?? defaults.provider, model: ownOf(id).model ?? defaults.model });
  const reasoningOf = (id) => {
    const { provider, model } = effectiveOf(id);
    const levels = provider === "gemini-cli" ? [] : provider === "codex" ? ["low", "medium", "high"] : ["low", "medium", "high", "xhigh"];
    const selected = ownOf(id).efforts[`${provider}/${model}`];
    return { provider, model, levels, default: "medium", ...(selected ? { selected } : {}), effective: selected ?? "medium", ...(levels.length === 0 ? { note: "This provider has no thinking levels." } : {}) };
  };
  const validModel = (id) => typeof id === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(id);
  const refuse = (message) => { settle("failed"); settingsError(message); };
  const settingsError = (message) => out({ type: "error", stage: "settings", message });
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
  history["chat-proj"] = [{ role: "assistant", text: "I can read this project's folder." }];
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
  // ---- the journal of accepted requests (ADR-157). It lives in a file named for the parent (the bridge), so it survives this process being restarted. ----
  const journalFile = join(tmpdir(), `atom-fake-journal-${process.ppid}.json`);
  const journal = new Map(existsSync(journalFile) ? JSON.parse(readFileSync(journalFile, "utf8")) : []);
  for (const r of journal.values()) if (r.state === "prepared" || r.state === "running") r.state = "interrupted"; // a restart interrupts what was in flight
  const saveJournal = () => writeFileSync(journalFile, JSON.stringify([...journal]));
  saveJournal();
  const REPLY_CHUNK = 100; // small, so reading a long reply in parts can be tried
  let attempt; // the journal record of the turn in flight
  const receipt = (r) => out({ type: "foreground.receipt", id: r.id, chat: r.chat, state: r.state, archived: r.archived });
  const settle = (state, reply = "", archived = false) => {
    if (!attempt) return;
    Object.assign(attempt, { state, updatedAt: new Date().toISOString(), archived, reply });
    saveJournal();
    receipt(attempt);
    attempt = undefined;
  };
  const summary = (r) => { const { text, files, notes, reply, answers, signature, ...rest } = r; return { ...rest, hasReply: reply.length > 0, answerCount: answers.length }; };
  const foreground = (command) => {
    const respond = (extra) => out({ type: "foreground.recovery", request: command.request, ...extra });
    if (command.type === "foreground.list") return respond({ ok: true, attempts: [...journal.values()].filter((r) => !r.dismissed).map(summary), known: (command.pending ?? []).filter((id) => journal.has(id)), knownAnswers: [] });
    const r = journal.get(command.id);
    if (command.type === "foreground.read") {
      if (!r || r.dismissed) return respond({ ok: false, error: "That recovery record is no longer available." });
      const chunk = r.reply.slice(command.offset, command.offset + REPLY_CHUNK);
      const { dismissed, signature, ...rest } = r;
      return respond({ ok: true, record: { ...rest, dismissed, reply: chunk, offset: command.offset, ...(command.offset + chunk.length < r.reply.length ? { nextOffset: command.offset + chunk.length } : {}) } });
    }
    if (command.type === "foreground.dismiss") {
      if (!r || r.state === "prepared" || r.state === "running") return respond({ ok: false, error: "That attempt is still running or is unavailable. Stop it before dismissing." });
      Object.assign(r, { dismissed: true, text: "", files: [], reply: "", answers: [] }); // the prompt and reply are cleared; the id remains so an old delivery cannot run again
      saveJournal();
      return respond({ ok: true });
    }
  };
  const finishTurn = (reply, step, unsaved = false) => {
    if (step) out({ type: "computer.step", text: step });
    if (!unsaved) history[current].push({ role: "assistant", text: reply });
    out({ type: "reply", text: reply });
    out({ type: "turn.complete", speechMs: 0, transcriptionMs: 0, modelMs: 20 });
    out({ type: "computer.end" });
    state = "idle";
    out({ type: "state", state: "idle" });
    // A reply saved with the chat is linked to it (archived); an unsaved one is kept in the journal for review.
    settle("completed", unsaved ? reply : "", !unsaved);
    sendChats();
  };
  const listed = () =>
    chats.map((c) => ({ ...c, ...(metaOf(c.id).pinned ? { pinned: true } : {}), ...(metaOf(c.id).archived ? { archived: true } : {}), flagsVersion: metaOf(c.id).version }))
      .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true)); // pins sort first, the rest keep their order
  const sendChats = () => {
    const mine = current ? ownOf(current) : undefined;
    out({
      type: "chats", chats: listed(), current,
      ...(mine?.provider ? { currentProvider: mine.provider, currentModel: mine.model } : {}),
      ...(current ? { reasoning: reasoningOf(current), access: mine.access } : {}),
      ...(chats.find((c) => c.id === current)?.projectId ? { currentProjectId: chats.find((c) => c.id === current).projectId } : {}),
    });
  };
  out({ type: "ready", protocol: 1, provider: "fake", model: "Fake model", microphone: "none", voice: false });
  sendInfo();
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
    else if (command.type === "model.refresh") sendInfo();
    else if (command.type === "chat.model") {
      const id = command.id === "" ? current : command.id;
      if (!chats.some((c) => c.id === id) || chats.find((c) => c.id === id).readOnly) return settingsError("This chat is written from another surface. It can be read here only.");
      if (command.provider === "" && command.model === "") { delete ownOf(id).provider; delete ownOf(id).model; return sendChats(); }
      const provider = providers.find((p) => p.id === command.provider);
      if (!provider || !provider.available) return settingsError("That provider is not available.");
      if (!validModel(command.model)) return settingsError("A model id has 1 to 100 letters, digits, dots, underscores, colons or hyphens.");
      ownOf(id).provider = command.provider;
      ownOf(id).model = command.model;
      if (ownOf(id).access !== "checked" && command.provider === "gemini-cli") ownOf(id).access = "checked";
      sendChats();
    } else if (command.type === "chat.reasoning") {
      if (command.id !== current || state !== "idle") return settingsError("Finish or stop the active turn before changing thinking.");
      const r = reasoningOf(current);
      if (command.provider !== r.provider || command.model !== r.model) return settingsError("The chat's model changed. Try again.");
      if (command.effort !== "" && !r.levels.includes(command.effort)) return settingsError("That thinking level is not offered for this model.");
      if (command.effort === "") delete ownOf(current).efforts[`${r.provider}/${r.model}`];
      else ownOf(current).efforts[`${r.provider}/${r.model}`] = command.effort;
      sendChats();
    } else if (command.type === "chat.access") {
      if (command.id !== current || state !== "idle" || chats.find((c) => c.id === current)?.readOnly) return settingsError("Finish or stop the active turn before changing access.");
      if (ownOf(current).access !== command.expected) return settingsError("The chat's access changed. Try again.");
      if (effectiveOf(current).provider === "gemini-cli" && command.mode !== "checked") return settingsError("Chat only, Ask before changes and Full access require Claude or Codex.");
      if (command.mode === "full") {
        pending = { id: `a${++asks}`, access: "full" };
        return out({ type: "approval.request", id: pending.id, accessChange: true, summary: "Turn on Full access for this chat", reason: "Full access skips routine file, command and plugin prompts in this chat only.\nProtected actions still ask or refuse." });
      }
      ownOf(current).access = command.mode;
      sendChats();
    } else if (command.type === "chat.rename") {
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
      if (p.access) { // a host confirmation for Full access: no turn is running
        out({ type: "approval.closed", id: p.id });
        if (command.approved === true) { ownOf(current).access = p.access; sendChats(); }
        return;
      }
      // A review-bearing request can only be approved with its own token, as in the real runtime.
      const approved = command.approved === true && (!p.review || command.reviewToken === p.review);
      out({ type: "approval.closed", id: p.id });
      clearTimeout(turnTimer);
      finishTurn(approved
        ? `Allowed. Answer received: rememberFile=${command.rememberFile === true}, reviewToken=${command.reviewToken ?? "none"}.`
        : "Declined. I did not do it.", approved ? "Clicking Send" : undefined);
    } else if (command.type === "talk.cancel") {
      if (state === "idle" && pending?.access) { out({ type: "approval.closed", id: pending.id }); pending = undefined; return; }
      if (state === "idle") return;
      if (pending) out({ type: "approval.closed", id: pending.id });
      pending = undefined;
      clearTimeout(turnTimer);
      out({ type: "computer.end" });
      state = "idle";
      out({ type: "state", state: "idle" });
      settle("stopped");
    } else if (command.type === "foreground.ack") {
      const r = journal.get(command.id);
      if (r && r.state === "completed" && r.archived) { Object.assign(r, { dismissed: true, text: "", files: [], reply: "", answers: [] }); saveJournal(); } // only a completion already saved with the chat may be scrubbed
    } else if (command.type === "foreground.list" || command.type === "foreground.read" || command.type === "foreground.dismiss") {
      foreground(command);
    } else if (command.type === "text.send") {
      if (metaOf(current).archived) return out({ type: "error", stage: "model", message: "This chat is archived. Unarchive it to continue." });
      // A text.send interrupts a turn in progress, like talking does: what waited for approval is declined (docs/island-protocol.md).
      if (state !== "idle") {
        clearTimeout(turnTimer);
        if (pending) out({ type: "approval.closed", id: pending.id });
        pending = undefined;
        out({ type: "computer.end" });
        state = "idle";
        out({ type: "state", state: "idle" });
        settle("stopped");
      }
      // An identified request (ADR-157): the host commits it, and answers with a receipt, before any attachment check or model call.
      if (command.request) {
        if (command.chat !== current) return settingsError("Recovery storage or the source chat is unavailable. Your input remains held; refresh Recovery before retrying.");
        const signature = createHash("sha256").update(JSON.stringify([current, command.text, command.files ?? []])).digest("hex"); // a fingerprint, as in the real journal: the words are not kept in it
        const earlier = journal.get(command.request);
        if (earlier) {
          if (earlier.signature !== signature) return settingsError("The request could not be saved or its delivery id conflicts. No new model request was sent. Review Recovery or free storage, then retry explicitly.");
          return receipt(earlier); // the same delivery again: its receipt, no second run
        }
        attempt = { id: command.request, chat: current, text: command.text, files: command.files ?? [], notes: [], source: "text", provider: effectiveOf(current).provider, model: effectiveOf(current).model, state: "prepared", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false, dismissed: false, reply: "", answers: [], signature };
        journal.set(command.request, attempt);
        saveJournal();
        receipt(attempt);
      }
      // Files (ADR-113): checked first, as the real runtime does; a refusal says why and sends nothing.
      const attached = [];
      if (Array.isArray(command.files) && command.files.length > 0) {
        if (chats.find((c) => c.id === current)?.projectId) return refuse("Attachments are not available in project chats.");
        const TYPES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".txt", ".md", ".csv", ".json", ".ts", ".py", ".log"]);
        for (const given of command.files) {
          const label = basename(String(given));
          if (!isAbsolute(given)) return refuse("A file needs its full path.");
          let info;
          try { info = statSync(given); } catch { return refuse(`${label} was not found.`); }
          if (!info.isFile()) return refuse(`${label} is not a file.`);
          if (info.size === 0) return refuse(`${label} is empty.`);
          if (info.size > 10 * 1024 * 1024) return refuse(`${label} is over 10 MB, too big to attach.`);
          if (/^\.env|^id_rsa|\.pem$|\.key$/i.test(label)) return refuse(`${label} looks like a secret or a key file, so ATOM will not read it.`);
          const ext = extname(label).toLowerCase();
          if (ext && !TYPES.has(ext)) return refuse(`${label}: ATOM reads text, code, PDFs and images (png, jpg, gif, webp).`);
          attached.push({ name: label, path: given, text: ext === ".txt" ? readFileSync(given, "utf8") : "" });
        }
      }
      if (attached.length > 0) command.text = [command.text, ...attached.map((a) => `[Attached: ${a.name} — ${a.path}]`)].filter(Boolean).join("\n");
      history[current].push({ role: "user", text: command.text });
      out({ type: "transcript", text: command.text });
      state = "thinking";
      out({ type: "state", state: "thinking" });
      if (attempt) { attempt.state = "running"; saveJournal(); receipt(attempt); }
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
      if (/crash the runtime/.test(command.text)) {
        turnTimer = setTimeout(() => process.exit(1), 150); // the process dies mid-turn; the bridge starts it again and the journal marks the request interrupted
        return;
      }
      if (/unsaved reply/.test(command.text)) {
        turnTimer = setTimeout(() => finishTurn("A long reply that was not saved with the chat. ".repeat(6), undefined, true), 100);
        return;
      }
      if (/take a moment/.test(command.text)) {
        turnTimer = setTimeout(() => finishTurn(`Done waiting: ${command.text}`), 700);
        return;
      }
      if (/fail please/.test(command.text)) {
        turnTimer = setTimeout(() => {
          out({ type: "error", stage: "model", message: "No internet." });
          state = "idle";
          out({ type: "state", state: "idle" });
          settle("failed");
        }, 500);
        return;
      }
      if (/work slowly/.test(command.text)) {
        out({ type: "computer.step", text: "Typing in TextEdit" });
        turnTimer = setTimeout(() => finishTurn("Finished slowly.", "Typing in TextEdit"), 600_000);
        return;
      }
      turnTimer = setTimeout(() => finishTurn(attached.length > 0 ? `Received ${attached.length} file${attached.length === 1 ? "" : "s"}: ${attached.map((a) => `${a.name} (${a.text.length > 0 ? a.text.length + " characters" : "binary"})`).join(", ")}.` : `You said: ${command.text}`), 30);
    }
  });
}
