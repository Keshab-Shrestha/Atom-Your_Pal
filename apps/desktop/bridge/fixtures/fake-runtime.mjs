// A stand-in for `apps/mac/src/main.ts --island` that speaks the same JSON lines, for the bridge tests and for `pnpm --filter @atom/desktop demo`.
// It needs no API keys and keeps two canned chats in memory. Not a model: replies are fixed text. Never ship it as the runtime.
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
  ];
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
  const sendChats = () => out({ type: "chats", chats, current });
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
    else if (command.type === "chat.new") {
      const id = `chat-${chats.length + 1}`;
      chats.unshift({ id, title: "New chat", updatedAt: new Date().toISOString(), messages: 0 });
      history[id] = [];
      current = id;
      out({ type: "conversation.reset" });
      sendChats();
    }
    else if (command.type === "chat.open" && history[command.id]) {
      current = command.id;
      out({ type: "chat.opened", id: command.id, messages: history[command.id] });
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
