import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { webFetchProblem } from "./web-guard.ts";

// Watch for me (2026-11-04, idea from atticus-mac "watch"). The user asks ARK to keep an eye on a public page. ARK reads the page
// on a timer with plain code, no model and no tokens, and tells the user once when the condition holds: the page changed, a phrase
// appeared, or a phrase went away. The page text never goes to a model or to the log; the notice names the host and the user's own phrase.
// A watch fires once, then stops. Pages that rewrite themselves on every load (clocks, ads) will look "changed": use a phrase instead.

export type WatchMode = "change" | "contains" | "missing";
export type WatchState = "watching" | "fired" | "stopped";

export interface Watch {
  id: string;
  url: string;
  mode: WatchMode;
  /** The phrase for `contains` and `missing`. */
  text?: string;
  everyMinutes: number;
  createdAt: string;
  lastCheckAt?: string;
  /** `change`: a hash of the page text at the first read. */
  baseline?: string;
  state: WatchState;
  firedAt?: string;
  /** What the notice said, or why the watch stopped. */
  message?: string;
  /** Reads that failed in a row. */
  failures: number;
}

export const MAX_WATCHES = 10;
export const MIN_EVERY_MINUTES = 5;
export const MAX_EVERY_MINUTES = 1440;
export const DEFAULT_EVERY_MINUTES = 30;
export const MAX_PHRASE_CHARS = 100;
export const MAX_FAILURES = 5;

const MODES: readonly string[] = ["change", "contains", "missing"];
const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return "the page"; } };
const fold = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

/** A watch from the model or the window, checked. Throws a sentence for the user or the model. */
export function checkWatchInput(input: Record<string, unknown>, existing: readonly Watch[], now: Date): Watch {
  const raw = typeof input.url === "string" ? input.url.trim() : "";
  const problem = webFetchProblem(raw);
  if (problem) throw new Error(problem);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.port) throw new Error("A watch reads public https pages on the standard port only.");
  url.hash = "";
  const mode = input.mode === undefined ? "change" : input.mode;
  if (typeof mode !== "string" || !MODES.includes(mode)) throw new Error('"mode" is change, contains or missing.');
  let text: string | undefined;
  if (mode !== "change") {
    text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim() : "";
    if (!text || text.length > MAX_PHRASE_CHARS) throw new Error(`"text" is the phrase to look for, 1 to ${MAX_PHRASE_CHARS} characters.`);
  }
  const every = input.everyMinutes === undefined ? DEFAULT_EVERY_MINUTES : input.everyMinutes;
  if (typeof every !== "number" || !Number.isInteger(every) || every < MIN_EVERY_MINUTES || every > MAX_EVERY_MINUTES) {
    throw new Error(`"everyMinutes" is a whole number from ${MIN_EVERY_MINUTES} to ${MAX_EVERY_MINUTES}.`);
  }
  if (existing.filter((w) => w.state === "watching").length >= MAX_WATCHES) throw new Error(`ARK watches at most ${MAX_WATCHES} pages at once. Remove one first.`);
  return { id: randomUUID().slice(0, 8), url: url.href, mode: mode as WatchMode, ...(text ? { text } : {}), everyMinutes: every, createdAt: now.toISOString(), state: "watching", failures: 0 };
}

/** The watches that are due: still watching, and never read or last read at least `everyMinutes` ago. */
export function dueWatches(list: readonly Watch[], now: Date): Watch[] {
  return list.filter((w) => w.state === "watching" && (!w.lastCheckAt || now.getTime() - new Date(w.lastCheckAt).getTime() >= w.everyMinutes * 60_000));
}

/** One read of the page text against the watch. Pure. */
export function judge(watch: Watch, page: string): { fired: boolean; baseline?: string; message?: string } {
  const host = hostOf(watch.url);
  if (watch.mode === "change") {
    const now = hashOf(fold(page));
    if (!watch.baseline) return { fired: false, baseline: now };
    return now === watch.baseline ? { fired: false } : { fired: true, message: `${host} changed.` };
  }
  const found = fold(page).includes(fold(watch.text ?? ""));
  if (watch.mode === "contains" && found) return { fired: true, message: `"${watch.text}" now appears on ${host}.` };
  if (watch.mode === "missing" && !found) return { fired: true, message: `"${watch.text}" is gone from ${host}.` };
  return { fired: false };
}

export interface WatchStore {
  list(): Watch[];
  add(watch: Watch): Watch[];
  /** Replaces the watch with the same id. */
  put(watch: Watch): void;
  remove(id: string): Watch[];
}

/** Held in memory; `path` is read once and rewritten after each change (mode 0600). Unreadable reads as none. */
export function createWatchStore(path?: string): WatchStore {
  let items: Watch[] = [];
  if (path) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(parsed)) items = parsed.filter((w): w is Watch => Boolean(w) && typeof w.id === "string" && typeof w.url === "string" && MODES.includes(w.mode));
    } catch { /* none yet, or damaged */ }
  }
  const persist = () => {
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.tmp`;
      writeFileSync(temp, JSON.stringify(items), { mode: 0o600 });
      renameSync(temp, path);
    } catch { /* the watch still runs this session */ }
  };
  return {
    list: () => [...items],
    add(watch) { items = [...items, watch]; persist(); return [...items]; },
    put(watch) { items = items.map((w) => (w.id === watch.id ? watch : w)); persist(); },
    remove(id) { items = items.filter((w) => w.id !== id); persist(); return [...items]; },
  };
}

export interface WatchRunner {
  /** Reads every due watch, one after another. Returns how many were read. */
  tick(now?: Date): Promise<number>;
}

/** The runner: `read` fetches the page text (a public https read); `notify` is told once per watch when it fires or stops. */
export function createWatchRunner(options: {
  store: WatchStore;
  read(url: string, signal?: AbortSignal): Promise<string>;
  notify(event: { id: string; kind: "fired" | "stopped"; message: string }): void;
  changed?(): void;
  log?(event: string, fields: Record<string, unknown>): void;
}): WatchRunner {
  let running = false;
  return {
    async tick(now = new Date()) {
      if (running) return 0;
      running = true;
      let read = 0;
      try {
        for (const watch of dueWatches(options.store.list(), now)) {
          read += 1;
          let next: Watch = { ...watch, lastCheckAt: now.toISOString() };
          try {
            const page = await options.read(watch.url);
            const verdict = judge(watch, page);
            next = { ...next, failures: 0, ...(verdict.baseline ? { baseline: verdict.baseline } : {}) };
            if (verdict.fired) {
              next = { ...next, state: "fired", firedAt: now.toISOString(), message: verdict.message! };
              options.notify({ id: watch.id, kind: "fired", message: verdict.message! });
            }
          } catch (error) {
            next = { ...next, failures: watch.failures + 1 };
            if (next.failures >= MAX_FAILURES) {
              const message = `ARK stopped watching ${hostOf(watch.url)}: ${error instanceof Error ? error.message.slice(0, 160) : "the page could not be read"}`;
              next = { ...next, state: "stopped", message };
              options.notify({ id: watch.id, kind: "stopped", message });
            }
          }
          options.store.put(next);
          options.log?.("watch.read", { id: watch.id, state: next.state });
        }
        if (read) options.changed?.();
      } finally {
        running = false;
      }
      return read;
    },
  };
}

export function createWatchTool(options: {
  store: WatchStore;
  approve(request: { summary: string; reason: string; reasonMax?: number }, signal?: AbortSignal): Promise<boolean>;
  changed?(): void;
  onCreated?(event: { watch: string; mode: WatchMode }): void;
}) {
  return {
    spec: {
      name: "watch",
      description:
        "Watch a public https page for the user, with no model and no cost while it waits. action create {url, mode?: change|contains|missing, text? (the phrase, for contains and missing), everyMinutes? (5 to 1440, default 30)}; " +
        "action list; action remove {id}. ARK reads the page on a timer, tells the user once when it changed, a phrase appeared, or a phrase went away, then stops. " +
        "It reads no logged-in pages and runs no scripts. A page that rewrites itself on every load looks changed: use a phrase. The user approves each new watch.",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: { type: "string", description: "create, list or remove" },
          url: { type: "string" },
          mode: { type: "string" },
          text: { type: "string" },
          everyMinutes: { type: "number" },
          id: { type: "string" },
        },
        required: ["action"],
      },
    },
    capability: { title: "Watch a page", examples: ["Tell me when the visa appointment page says slots are open", "Watch this page and tell me if it changes"] },
    async run(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
      const list = options.store.list();
      if (input.action === "list") {
        return list.length ? list.map((w) => `${w.id}: ${w.state} · ${w.mode}${w.text ? ` "${w.text}"` : ""} · ${w.url} · every ${w.everyMinutes} min${w.message ? ` · ${w.message}` : ""}`).join("\n") : "ARK watches no pages.";
      }
      if (input.action === "remove") {
        const id = typeof input.id === "string" ? input.id : "";
        if (!list.some((w) => w.id === id)) return `No watch has the id ${JSON.stringify(id)}. Use action list.`;
        options.store.remove(id);
        options.changed?.();
        return "The watch is removed. Tell the user in one short sentence.";
      }
      if (input.action !== "create") return "action is create, list or remove.";
      let watch: Watch;
      try { watch = checkWatchInput(input, list, new Date()); }
      catch (error) { return `The watch is not valid: ${error instanceof Error ? error.message : "unknown problem"} Fix it and call watch again.`; }
      const what = watch.mode === "change" ? "changes" : watch.mode === "contains" ? `shows "${watch.text}"` : `loses "${watch.text}"`;
      const ok = await options.approve({ summary: `Watch ${hostOf(watch.url)} until it ${what}`, reason: `ARK reads ${watch.url} every ${watch.everyMinutes} minutes with no model, and tells you once.`, reasonMax: 400 }, signal);
      if (!ok) return "The user did not approve the watch. Nothing was set up. Tell the user in one short sentence.";
      options.store.add(watch);
      options.changed?.();
      options.onCreated?.({ watch: watch.id, mode: watch.mode });
      return `ARK now watches ${hostOf(watch.url)} (id ${watch.id}) and will tell the user once. Tell the user in one short sentence.`;
    },
  };
}
