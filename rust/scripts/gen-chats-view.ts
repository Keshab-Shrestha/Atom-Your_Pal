// ADR-278 Phase 2: the fixture of the native `chats.list` (rust/crates/ark-runtime/src/chats.rs). Runs the TypeScript store on fixed inputs and
// writes `chats-view.db`, `chats-view-state.json` (what runtime.ts writes to data/ui-state.json) and `chats-view.json` (the `chats` event as
// `sendChats` in island.ts and `islandChats.list` in runtime.ts build it, for each current chat). Run from the repository root:
// node rust/scripts/gen-chats-view.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openMemoryStore } from "../../services/memory/src/store.ts";
import { chatWriter } from "../../apps/mac/src/chat-owner.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures");
const dbFile = join(dir, "chats-view.db");
for (const ext of ["", "-wal", "-shm"]) rmSync(dbFile + ext, { force: true });
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 1, 9, 0, tick++));
const store = openMemoryStore({ path: dbFile, now });
const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i}` }) as const);
const folder = mkdtempSync(join(tmpdir(), "ark-proj-"));
const project = store.projects.add({ name: "Site", folder });
store.projects.setModel(project.id, { provider: "claude-plan", model: "claude-sonnet-4" });
for (const id of ["plain-1", "plain-2", "pinned-1", "archived-1", "telegram", "routine-7", "proj-1", "proj-2", "own-model"]) store.chats.save(id, turns(2));
store.chats.setProject("proj-1", project.id);
store.chats.setProject("proj-2", project.id);
store.chats.setFlags("pinned-1", { pinned: true }, 0);
store.chats.setFlags("archived-1", { archived: true }, 0);
store.chats.setModel("own-model", { provider: "codex", model: "gpt-5" });
store.chats.setAccess("plain-2", "ask-changes");
store.chats.setReasoning("own-model", "codex", "gpt-5", "high");

const projectItems = store.projects.list().map((p) => ({ id: p.id, name: p.name, folderLabel: folder, missing: false, archived: p.archived, chatCount: store.projects.chatCount(p.id), web: p.web, ...(p.provider && p.model ? { provider: p.provider, model: p.model } : {}) }));
const reasoning = [
  { provider: "claude-plan", model: "claude-sonnet-4", levels: ["low", "high"], default: "low" },
  { provider: "codex", model: "gpt-5", levels: ["low", "high"], default: "low" },
  { provider: "claude-plan", model: "claude-opus-4", levels: [], default: "off", note: "Thinking levels are unavailable for this model. Refresh the model catalog in Settings." },
];
const state = { current: { provider: "claude-plan", model: "claude-opus-4" }, reasoning, projects: projectItems };
const cap = (provider: string, model: string) => reasoning.find((r) => r.provider === provider && r.model === model) ?? { provider, model, levels: [], default: provider === "codex" ? "low" : "off", note: "x" };

const TELEGRAM_CHAT = "telegram";
const list = () => {
  const byId = new Map<string, ReturnType<typeof store.chats.list>[number]>();
  for (const c of store.chats.list({ projectId: null, limit: 50, archived: false })) byId.set(c.id, c);
  for (const p of store.projects.list()) for (const c of store.chats.list({ projectId: p.id, limit: 50, archived: false })) byId.set(c.id, c);
  const summaries = [...byId.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return [...new Map([...summaries, ...store.chats.list({ pinned: true, limit: 500 }), ...store.chats.list({ archived: true, limit: 500 })].map((c) => [c.id, c])).values()]
    .map((c) => ({ id: c.id, title: c.id === TELEGRAM_CHAT ? "Telegram" : c.title, updatedAt: c.updatedAt.toISOString(), messages: c.messages, ...(c.projectId ? { projectId: c.projectId } : {}), ...(c.pinned ? { pinned: true as const } : {}), ...(c.archived ? { archived: true as const } : {}), ...(c.flagsVersion ? { flagsVersion: c.flagsVersion } : {}) }));
};
const event = (current: string) => {
  const own = current ? store.chats.model(current) ?? (() => { const p = store.chats.project(current); const pr = p ? store.projects.get(p) : undefined; return pr?.provider && pr.model ? { provider: pr.provider, model: pr.model } : undefined; })() : undefined;
  const currentProjectId = current ? store.chats.project(current) : undefined;
  const reasoningOf = (id: string) => {
    const choice = store.chats.model(id) ?? state.current;
    const own2 = (() => { const p = store.chats.project(id); const pr = p ? store.projects.get(p) : undefined; return store.chats.model(id) ?? (pr?.provider && pr.model ? { provider: pr.provider, model: pr.model } : undefined); })();
    const c = own2 ?? state.current;
    void choice;
    const capability = cap(c.provider, c.model);
    const selected = store.chats.reasoning(id, c.provider, c.model);
    return { ...capability, ...(selected ? { selected } : {}), effective: selected ?? capability.default };
  };
  return {
    type: "chats",
    chats: list().map((c) => (chatWriter(c.id) ? { ...c, readOnly: true as const } : c)),
    current,
    ...(own ? { currentProvider: own.provider, currentModel: own.model } : {}),
    projects: projectItems,
    ...(currentProjectId ? { currentProjectId } : {}),
    ...(current ? { access: store.chats.access(current) } : {}),
    ...(current ? { reasoning: reasoningOf(current) } : {}),
  };
};
const events = ["", "plain-1", "plain-2", "own-model", "proj-1", "telegram"].map((current) => ({ current, event: event(current) }));
store.close();
rmSync(folder, { recursive: true, force: true });
writeFileSync(join(dir, "chats-view-state.json"), `${JSON.stringify(state)}\n`);
writeFileSync(join(dir, "chats-view.json"), `${JSON.stringify({ source: "apps/mac/src/island.ts sendChats, runtime.ts islandChats", events }, null, 1)}\n`);
console.log(`chats-view: ${events.length} events`);
