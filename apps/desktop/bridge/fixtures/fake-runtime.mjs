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
  let current = "chat-1";
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
    } else if (command.type === "text.send") {
      history[current].push({ role: "user", text: command.text });
      out({ type: "transcript", text: command.text });
      out({ type: "state", state: "thinking" });
      setTimeout(() => {
        const reply = `You said: ${command.text}`;
        history[current].push({ role: "assistant", text: reply });
        out({ type: "reply", text: reply });
        out({ type: "turn.complete", speechMs: 0, transcriptionMs: 0, modelMs: 20 });
        out({ type: "state", state: "idle" });
        sendChats();
      }, 30);
    }
  });
}
