import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Apps (2026-11-05, Keshab: "everything is a plugin where I can create and run new apps within ARK"; idea from DeepSeek Harness).
// An app is one HTML file the agent writes, run by the window in a locked-down web view: no network, no files, no other app's data.
// It talks to ARK only through a small bridge (`window.ark`): its own notes (storage) and, if the user allowed it, a question to ARK.
// The user approves every new app, every change and every removal on a card. The code runs only in the web view, never in the runtime.
// Phase 1: one HTML file with inline CSS and JavaScript. Tools for apps, network hosts and sharing come later, each behind a card.

export interface AppPermissions {
  /** The app may ask ARK a question (one small model call, no tools). */
  ask: boolean;
}

export interface AppManifest {
  id: string;
  name: string;
  description: string;
  permissions: AppPermissions;
  /** Counts up with each change. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArkApp {
  manifest: AppManifest;
  html: string;
}

export const MAX_APPS = 30;
export const MAX_NAME = 40;
export const MAX_DESCRIPTION = 200;
export const MAX_HTML_BYTES = 200_000;
export const MAX_KEYS = 64;
export const MAX_KEY_CHARS = 100;
export const MAX_VALUE_BYTES = 16_000;
export const MAX_STORAGE_BYTES = 256_000;
export const MAX_PROMPT_CHARS = 2_000;
/** An app may ask ARK this many times a minute. */
export const ASKS_PER_MINUTE = 6;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const validAppId = (id: unknown): id is string => typeof id === "string" && ID.test(id);
const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "app";

/** Anything in the page that reaches outside it. The web view blocks all of it, so an app that tries would only look broken: say so now. */
const OUTSIDE = [
  /<(?:script|img|iframe|link|source|video|audio|embed|object)\b[^>]*\b(?:src|href|data)\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i,
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bnavigator\.sendBeacon\b|\bimportScripts\b/,
  /<form\b[^>]*\baction\s*=/i,
  /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i,
];

const text = (value: unknown, max: number, what: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${what} is required.`);
  const v = value.replace(/\s+/g, " ").trim();
  if (v.length > max) throw new Error(`${what} is at most ${max} characters.`);
  return v;
};

export interface CheckedApp { id?: string; name: string; description: string; html: string; permissions: AppPermissions }

/** An app from the model, checked. Throws a sentence the model can act on. */
export function checkAppInput(input: Record<string, unknown>): CheckedApp {
  const name = text(input.name, MAX_NAME, "The name");
  const description = text(input.description, MAX_DESCRIPTION, "The description");
  const html = typeof input.html === "string" ? input.html : "";
  if (!html.trim()) throw new Error('"html" is the whole page: one HTML file.');
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error(`The page is over ${MAX_HTML_BYTES / 1000} KB. Make it smaller.`);
  if (OUTSIDE.some((re) => re.test(html))) {
    throw new Error("The page reaches outside itself (an address, fetch, a form action or a redirect). Apps run with no network: put all CSS, JavaScript and images inline (images as data: addresses), and use window.ark for notes and questions.");
  }
  const id = input.id === undefined ? undefined : input.id;
  if (id !== undefined && !validAppId(id)) throw new Error('"id" is an app id from the list.');
  return { ...(id ? { id } : {}), name, description, html, permissions: { ask: input.ask === true } };
}

export interface AppStore {
  list(): AppManifest[];
  get(id: string): ArkApp | undefined;
  /** Creates (no id) or replaces (id) an app. Returns the manifest. Throws when the limit is reached or the id is unknown. */
  save(app: CheckedApp, now?: Date): AppManifest;
  remove(id: string): boolean;
  storageGet(id: string, key: string): string | undefined;
  storageSet(id: string, key: string, value: string): void;
  storageRemove(id: string, key: string): void;
  storageKeys(id: string): string[];
}

/** Held in memory; `dir` (when given) keeps `<dir>/<id>/{manifest.json,index.html,storage.json}`. A damaged app folder is skipped. */
export function createAppStore(dir?: string): AppStore {
  const apps = new Map<string, ArkApp>();
  const storage = new Map<string, Record<string, string>>();
  const write = (path: string, data: string) => { const temp = `${path}.tmp`; writeFileSync(temp, data, { mode: 0o600 }); renameSync(temp, path); };
  if (dir) {
    try {
      for (const id of readdirSync(dir)) {
        if (!validAppId(id)) continue;
        try {
          const manifest = JSON.parse(readFileSync(join(dir, id, "manifest.json"), "utf8")) as AppManifest;
          if (manifest.id !== id || typeof manifest.name !== "string") continue;
          apps.set(id, { manifest: { ...manifest, permissions: { ask: manifest.permissions?.ask === true } }, html: readFileSync(join(dir, id, "index.html"), "utf8") });
          try { storage.set(id, JSON.parse(readFileSync(join(dir, id, "storage.json"), "utf8")) as Record<string, string>); } catch { /* no notes yet */ }
        } catch { /* a damaged folder */ }
      }
    } catch { /* no folder yet */ }
  }
  const persistApp = (id: string) => {
    if (!dir) return;
    try {
      const app = apps.get(id)!;
      mkdirSync(join(dir, id), { recursive: true, mode: 0o700 });
      write(join(dir, id, "manifest.json"), JSON.stringify(app.manifest, null, 2));
      write(join(dir, id, "index.html"), app.html);
    } catch { /* kept in memory this session */ }
  };
  const persistStorage = (id: string) => {
    if (!dir) return;
    try { mkdirSync(join(dir, id), { recursive: true, mode: 0o700 }); write(join(dir, id, "storage.json"), JSON.stringify(storage.get(id) ?? {})); } catch { /* kept in memory */ }
  };
  const bytes = (record: Record<string, string>) => Object.entries(record).reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.byteLength(v), 0);

  return {
    list: () => [...apps.values()].map((a) => a.manifest).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => apps.get(id),
    save(app, now = new Date()) {
      const stamp = now.toISOString();
      if (app.id) {
        const old = apps.get(app.id);
        if (!old) throw new Error(`No app has the id ${JSON.stringify(app.id)}. Use action list.`);
        const manifest: AppManifest = { ...old.manifest, name: app.name, description: app.description, permissions: app.permissions, version: old.manifest.version + 1, updatedAt: stamp };
        apps.set(app.id, { manifest, html: app.html });
        persistApp(app.id);
        return manifest;
      }
      if (apps.size >= MAX_APPS) throw new Error(`ARK keeps at most ${MAX_APPS} apps. Remove one first.`);
      let id = slug(app.name);
      for (let n = 2; apps.has(id); n++) id = `${slug(app.name).slice(0, 36)}-${n}`;
      const manifest: AppManifest = { id, name: app.name, description: app.description, permissions: app.permissions, version: 1, createdAt: stamp, updatedAt: stamp };
      apps.set(id, { manifest, html: app.html });
      persistApp(id);
      return manifest;
    },
    remove(id) {
      if (!apps.delete(id)) return false;
      storage.delete(id);
      if (dir && validAppId(id)) { try { rmSync(join(dir, id), { recursive: true, force: true }); } catch { /* gone from memory at least */ } }
      return true;
    },
    storageGet: (id, key) => storage.get(id)?.[key],
    storageSet(id, key, value) {
      if (!apps.has(id)) throw new Error("That app is gone.");
      if (!key || key.length > MAX_KEY_CHARS) throw new Error(`A key is 1 to ${MAX_KEY_CHARS} characters.`);
      if (typeof value !== "string" || Buffer.byteLength(value) > MAX_VALUE_BYTES) throw new Error(`A value is a string of at most ${MAX_VALUE_BYTES / 1000} KB.`);
      const current = { ...(storage.get(id) ?? {}) };
      if (!(key in current) && Object.keys(current).length >= MAX_KEYS) throw new Error(`An app keeps at most ${MAX_KEYS} notes.`);
      current[key] = value;
      if (bytes(current) > MAX_STORAGE_BYTES) throw new Error(`An app keeps at most ${MAX_STORAGE_BYTES / 1000} KB of notes.`);
      storage.set(id, current);
      persistStorage(id);
    },
    storageRemove(id, key) {
      const current = { ...(storage.get(id) ?? {}) };
      if (!(key in current)) return;
      delete current[key];
      storage.set(id, current);
      persistStorage(id);
    },
    storageKeys: (id) => Object.keys(storage.get(id) ?? {}).sort(),
  };
}

/** What an app may do through the bridge. `args` come from the page, so every one is checked here. */
export type BridgeOp = "storage.get" | "storage.set" | "storage.remove" | "storage.list" | "ask";
export const BRIDGE_OPS: readonly BridgeOp[] = ["storage.get", "storage.set", "storage.remove", "storage.list", "ask"];

export interface BridgeOptions {
  store: AppStore;
  /** One small model call with no tools; the prompt is data. */
  ask(prompt: string, signal?: AbortSignal): Promise<string>;
  now?: () => number;
}

/** The host side of `window.ark`: runs one call from one app and returns its JSON value, or throws a sentence the page shows. */
export function createBridge(options: BridgeOptions) {
  const { store, now = Date.now } = options;
  const asked = new Map<string, number[]>();
  return async function call(appId: string, op: string, args: { key?: unknown; value?: unknown; prompt?: unknown }, signal?: AbortSignal): Promise<unknown> {
    const app = store.get(appId);
    if (!app) throw new Error("This app was removed.");
    if (!BRIDGE_OPS.includes(op as BridgeOp)) throw new Error(`ark.${op} is not something apps can do.`);
    if (op === "storage.list") return store.storageKeys(appId);
    if (op === "ask") {
      if (!app.manifest.permissions.ask) throw new Error("This app is not allowed to ask ARK. Ask the user to allow it.");
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt || prompt.length > MAX_PROMPT_CHARS) throw new Error(`A question is 1 to ${MAX_PROMPT_CHARS} characters.`);
      const recent = (asked.get(appId) ?? []).filter((t) => now() - t < 60_000);
      if (recent.length >= ASKS_PER_MINUTE) throw new Error(`An app may ask ARK ${ASKS_PER_MINUTE} times a minute. Try again soon.`);
      asked.set(appId, [...recent, now()]);
      return options.ask(prompt, signal);
    }
    const key = typeof args.key === "string" ? args.key : "";
    if (op === "storage.get") return store.storageGet(appId, key) ?? null;
    if (op === "storage.remove") { store.storageRemove(appId, key); return null; }
    store.storageSet(appId, key, args.value as string);
    return null;
  };
}

/** The tool: list, read, create, update (by id) and remove. Each change and removal waits for the user's card. */
export function createAppTool(options: {
  store: AppStore;
  approve(request: { summary: string; reason: string; reasonMax?: number }, signal?: AbortSignal): Promise<boolean>;
  changed?(): void;
  onChange?(event: { app: string; action: "create" | "update" | "remove" }): void;
}) {
  const describe = (a: CheckedApp) => `${a.description} ${a.permissions.ask ? "It may ask ARK questions (a small model call each)." : "It cannot ask ARK anything."} It runs in a sandbox with no network and no files, and keeps its own notes. ${Math.round(Buffer.byteLength(a.html) / 1000)} KB of code.`;
  return {
    spec: {
      name: "app",
      description:
        "Make, change or remove a small app that runs inside ARK's window. action list; action read {id} (returns the HTML, to edit it); action create {name, description, html, ask?}; action update {id, name, description, html, ask?}; action remove {id}. " +
        "An app is ONE complete HTML file with all CSS and JavaScript inline. It runs in a sandbox: no network (no fetch, no external scripts, fonts or images; use data: images), no files, no other app's data. " +
        "Inside the page, window.ark offers: await ark.storage.get(key) (string or null), ark.storage.set(key, string), ark.storage.remove(key), ark.storage.list() (keys); values are strings, so use JSON.stringify. " +
        "With ask:true the app may also await ark.ask(question) for a short text answer from ARK. Design for a small window, support light and dark with prefers-color-scheme, and make buttons large and labelled. The user approves every create, update and remove.",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: { type: "string", description: "list, read, create, update or remove" },
          id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, html: { type: "string" }, ask: { type: "boolean" },
        },
        required: ["action"],
      },
    },
    capability: { title: "Make an app", examples: ["Make me a habit tracker app", "Build a small timer app that keeps my last 5 sessions"] },
    async run(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
      const action = input.action;
      if (action === "list") {
        const list = options.store.list();
        return list.length ? list.map((m) => `${m.id}: ${m.name} (v${m.version}) — ${m.description}`).join("\n") : "ARK has no apps yet.";
      }
      if (action === "read") {
        const app = typeof input.id === "string" ? options.store.get(input.id) : undefined;
        return app ? `${app.manifest.name} (v${app.manifest.version}), ask ${app.manifest.permissions.ask}:\n${app.html}` : "No app has that id. Use action list.";
      }
      if (action === "remove") {
        const app = typeof input.id === "string" ? options.store.get(input.id) : undefined;
        if (!app) return "No app has that id. Use action list.";
        const ok = await options.approve({ summary: `Remove the app: ${app.manifest.name}`, reason: "The app and its notes are deleted.", reasonMax: 300 }, signal);
        if (!ok) return "The user did not approve. Nothing was removed. Tell the user in one short sentence.";
        options.store.remove(app.manifest.id);
        options.changed?.();
        options.onChange?.({ app: app.manifest.id, action: "remove" });
        return "The app is removed. Tell the user in one short sentence.";
      }
      if (action !== "create" && action !== "update") return "action is list, read, create, update or remove.";
      let checked: CheckedApp;
      try {
        checked = checkAppInput({ ...input, id: action === "update" ? input.id : undefined });
        if (action === "update" && !checked.id) throw new Error('update needs the "id" of an app from the list.');
      } catch (error) { return `The app is not valid: ${error instanceof Error ? error.message : "unknown problem"} Fix it and call app again.`; }
      const ok = await options.approve({ summary: `${action === "create" ? "Add" : "Update"} an app: ${checked.name.slice(0, 40)}`, reason: describe(checked), reasonMax: 500 }, signal);
      if (!ok) return "The user did not approve the app. Nothing was saved. Tell the user in one short sentence.";
      let manifest: AppManifest;
      try { manifest = options.store.save(checked); } catch (error) { return `The app was not saved: ${error instanceof Error ? error.message : "unknown problem"}`; }
      options.changed?.();
      options.onChange?.({ app: manifest.id, action: action as "create" | "update" });
      return `The app "${manifest.name}" (id ${manifest.id}) is on the Apps page. Tell the user in one short sentence.`;
    },
  };
}
