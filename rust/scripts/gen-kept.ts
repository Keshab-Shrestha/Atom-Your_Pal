// ADR-278: the fixture of native `memory.keepChat` (rust/crates/ark-runtime/src/kept_keep.rs): the rows the TypeScript chat index writes for one chat, with the
// plain digest and with a model digest that lacks one heading. From the repository root: node rust/scripts/gen-kept.ts
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatSections, fallbackDigest, digestBrief, openChatIndex } from "../../services/memory/src/chat-index.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "kept.json");
const messages = Array.from({ length: 19 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: i === 4 ? `${"long word ".repeat(150)}end` : `Message ${i}: Keshab likes green tea, tea cats and café ${i}.  Extra   spaces.`, createdAt: new Date() }));
messages.push({ role: "system", content: "skipped", createdAt: new Date() }, { role: "user", content: "   ", createdAt: new Date() });
const now = new Date("2026-11-13T00:00:00.000Z");
const dump = (db: DatabaseSync) => ({
  chats: db.prepare("SELECT chat_id, title, summary, messages, kept_at, vec IS NULL AS no_vec FROM kept_chats").all(),
  sections: db.prepare("SELECT chat_id, seq, heading, body FROM kept_sections ORDER BY id").all(),
  lines: db.prepare("SELECT section_id, seq, role, text FROM kept_lines ORDER BY id").all(),
  fts: db.prepare("SELECT text, level, ref FROM kept_fts ORDER BY rowid").all(),
});
const cases: Record<string, unknown> = {};
for (const [name, digestOf] of [["plain", (t: string, s: ReturnType<typeof chatSections>) => fallbackDigest(t, s)], ["model", () => ({ summary: "  A chat about tea.  ", headings: ["Tea talk", "  "] })]] as const) {
  const db = new DatabaseSync(":memory:");
  const index = openChatIndex(db, () => now);
  const sections = chatSections(messages as never);
  await index.keep("c1", "Tea chat", messages as never, digestOf("Tea chat", sections), undefined);
  cases[name] = dump(db);
}
const sections = chatSections(messages as never);
writeFileSync(out, JSON.stringify({ messages: messages.map((m) => [m.role, m.content]), cases, brief: digestBrief("Tea chat", sections), plain: fallbackDigest("Tea chat", sections) }, null, 1));
console.log("wrote", out);
