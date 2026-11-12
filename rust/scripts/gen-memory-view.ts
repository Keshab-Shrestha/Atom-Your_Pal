// ADR-278 Phase 2: the fixture of the native `memory.list` (rust/crates/ark-runtime/src/memory.rs). Runs the TypeScript store on fixed
// inputs and writes `memory-view.db` and `memory-view.json` (the `memory` event as `apps/mac/src/runtime.ts` and `kept-chats.ts` build it,
// and the fact hashes of `services/memory/src/suggestions.ts`). Run from the repository root: node rust/scripts/gen-memory-view.ts
import { createHash } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openMemoryStore } from "../../services/memory/src/store.ts";
import { foldFact } from "../../services/memory/src/suggestions.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures");
const dbFile = join(dir, "memory-view.db");
for (const ext of ["", "-wal", "-shm"]) rmSync(dbFile + ext, { force: true });
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 1, 9, 0, tick++));
const store = openMemoryStore({ path: dbFile, now });

store.add("Keshab likes green tea.", { source: "text" });
store.add("The cat is called Mochi.", { source: "voice" });
const old = store.add("Old address in Osaka.", { source: "text" });
store.supersede(old.id, "New address in Tokyo.", { source: "voice" });
store.add("A fact that expires.", { source: "text" }, { until: new Date(Date.now() + 86_400_000 * 3650) });
store.saveEpisode("s1", "Planned the Oslo trip.", 4);
store.saveEpisode("s2", "Fixed a bug in the build.", 7);
const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i}` }) as const);
store.chats.save("c-plain", turns(2));
store.chats.save("c-pinned", turns(4));
store.chats.setFlags("c-pinned", { pinned: true }, 0);
store.chats.save("c-gone", turns(2));
store.chats.save("c-archived", turns(2));
store.chats.setFlags("c-archived", { archived: true }, 0);
const digest = { summary: "A kept chat.", headings: ["one"] };
await store.chatIndex.keep("c-plain", "message 0", turns(2), digest);
await store.chatIndex.keep("c-gone", "message 0", turns(2), digest);
store.chats.remove("c-gone");

const owner = "local";
const memories = store.recent(500).map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt.toISOString(), source: m.source }));
const episodes = store.episodes(50).map((e) => ({ id: e.id, summary: e.summary, endedAt: e.endedAt.toISOString(), exchanges: e.exchanges }));
const kept = new Map(store.chatIndex.kept().map((k) => [k.chatId, k]));
const recent = store.chats.list(30);
const chats: Record<string, unknown>[] = recent.map((c) => {
  const k = kept.get(c.id);
  return { id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString(), messages: c.messages, kept: Boolean(k), ...(k ? { keptAt: k.keptAt.toISOString() } : {}) };
});
const listed = new Set(recent.map((c) => c.id));
for (const k of kept.values()) if (!listed.has(k.chatId)) chats.push({ id: k.chatId, title: k.title, messages: k.messages, kept: true, keptAt: k.keptAt.toISOString() });
const event = { type: "memory", enabled: true, count: store.count(), memories, episodes, chats };
const hashOf = (text: string) => createHash("sha256").update(foldFact(text)).digest("hex").slice(0, 32);
const hashes = ["Keshab likes green tea.", "  Éclair  AT   café.。", "ＦＵＬＬ width", "ﬁne", "日本語。", "x", ""].map((text) => ({ text, hash: hashOf(text) }));
store.close();
writeFileSync(join(dir, "memory-view.json"), `${JSON.stringify({ source: "apps/mac/src/runtime.ts, kept-chats.ts, services/memory/src/suggestions.ts", owner, event, hashes }, null, 1)}\n`);
console.log(`memory-view: ${memories.length} memories, ${episodes.length} episodes, ${chats.length} chats`);
