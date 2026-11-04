import type { ToolCall, ToolRunner } from "@ark/contracts";
import type { Shortcut } from "./computer/learned-shortcuts.ts";

/** A sentence claimed by a shortcut: its name (for the log) and the tool call it stands for. */
export interface ShortcutMatch {
  name: string;
  call: { name: string; input: Record<string, unknown> };
}

/** Longest search text a shortcut takes; anything longer is left to the model. */
const MAX_QUERY = 200;

/** Spoken extras around a command that do not change it. */
const LEAD = /^(?:(?:hey )?ark|please|can you|could you)\s+/;
const TAIL = /\s+please$/;

/** Lower case, no commas or end punctuation, no "please", "ARK" or "Ark". */
function normalize(text: string): string {
  let s = text.toLowerCase().replace(/[,!?]/g, " ").replace(/[.\s]+$/, "").replace(/\s+/g, " ").trim();
  for (let before = ""; before !== s; ) {
    before = s;
    s = s.replace(LEAD, "").replace(TAIL, "");
  }
  return s;
}

/**
 * Learned shortcuts (2026-11-04): the sentence is exactly the goal of one saved computer shortcut (after the same clean-up as the
 * fixed commands). The goal must be two words and eight letters or more, so a short goal like "ok" never claims an ordinary
 * message, and it must belong to one app only. Pure.
 */
export function matchLearned(all: readonly Shortcut[], spoken: string): { app: string; goal: string } | undefined {
  const s = normalize(spoken);
  if (s.length < 8 || !s.includes(" ")) return undefined;
  const found = all.filter((w) => normalize(w.goal) === s);
  const apps = new Set(found.map((w) => w.app.toLowerCase()));
  return found.length > 0 && apps.size === 1 ? { app: found[0]!.app, goal: found[0]!.goal } : undefined;
}

const key = (s: string) => s.replace(/[^a-z0-9]/g, "");

/** Spoken names for apps whose real name differs. */
const APP_ALIASES: Record<string, string> = { macsettings: "System Settings", macossettings: "System Settings", systempreferences: "System Settings" };

/** The installed app named exactly `spoken`, or that name without a trailing " Browser" ("brave" for Brave Browser). */
function exactApp(spoken: string, apps: readonly string[]): string | undefined {
  const k = key(spoken);
  if (!k) return undefined;
  const alias = APP_ALIASES[k];
  if (alias) return apps.find((a) => a === alias);
  return apps.find((a) => key(a.toLowerCase()) === k) ?? apps.find((a) => key(a.toLowerCase().replace(/\s+browser$/, "")) === k);
}

const query = (q: string) => (q.trim() && q.length <= MAX_QUERY ? q.trim() : undefined);

const SETTINGS = /^(?:open|show)(?: the| my| your| ark'?s?| ark'?s?)? settings$/;
const OPEN = /^(?:open|launch|start|switch to)(?: the| my)? (.+?)(?: app)?$/;
const PLAY_PAUSE =
  /^(?:play|pause|resume|unpause|play pause|play\/pause)(?: the)?(?: music| video| song| youtube(?: video)?)?(?: (?:in|on) (?:brave|brave browser|the browser|youtube))?$/;
const YOUTUBE = [/^search(?: for)? (.+) (?:on|in) youtube$/, /^search youtube for (.+)$/];
const GOOGLE = [/^search(?: for)? (.+) (?:on|in) (?:google|chrome)$/, /^search (?:google|chrome) for (.+)$/];

const firstMatch = (patterns: RegExp[], s: string) => patterns.map((re) => re.exec(s)?.[1]).find(Boolean);

/**
 * ADR-071: claims a sentence only when the whole of it fits one fixed command and every slot resolves exactly (an app
 * name must be an installed app). Anything else, including "open Safari and search for cats", is left to the model.
 * Pure: the caller supplies the installed apps.
 */
export function matchShortcut(text: string, context: { apps: readonly string[] }): ShortcutMatch | undefined {
  const s = normalize(text);
  if (SETTINGS.test(s)) return { name: "ark_settings", call: { name: "open_ark_settings", input: {} } };
  if (PLAY_PAUSE.test(s)) return { name: "play_pause", call: { name: "play_pause", input: {} } };

  const youtube = query(firstMatch(YOUTUBE, s) ?? "");
  if (youtube) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(youtube)}`;
    return { name: "search_youtube", call: { name: "open_url", input: { url, same_tab: true } } };
  }
  const google = query(firstMatch(GOOGLE, s) ?? "");
  if (google) return { name: "search_google", call: { name: "open_url", input: { url: `https://www.google.com/search?q=${encodeURIComponent(google)}` } } };

  const spoken = OPEN.exec(s)?.[1];
  const app = spoken ? exactApp(spoken, context.apps) : undefined;
  if (app) return { name: "open_app", call: { name: "open_app", input: { name: app } } };
  return undefined;
}

export interface ShortcutOptions {
  tools: ToolRunner;
  /** Installed app names. A failure leaves "open <app>" to the model. */
  apps: () => Promise<string[]>;
  /** Learned computer shortcuts, if any: a sentence equal to a saved goal replays it, with no model. */
  learned?: () => readonly Shortcut[];
  /** For the log: the shortcut's name, never the sentence. */
  onHit?: (event: { name: string; ms: number }) => void;
  onFallback?: (event: { name: string; reason: string }) => void;
  now?: () => number;
}

/**
 * Runs a claimed sentence through the tool engine (so blocks, checks and logs apply unchanged) and returns the tool's
 * own short reply, or undefined to let the model answer: no match, or the tool failed or refused, so the model can
 * tell the user why.
 */
export function createShortcuts(options: ShortcutOptions): (text: string, signal?: AbortSignal) => Promise<string | undefined> {
  const { tools, now = Date.now } = options;
  return async (text, signal) => {
    const started = now();
    let apps: string[] = [];
    try {
      apps = await options.apps();
    } catch {
      // no app list: "open <app>" cannot match; the other shortcuts still can
    }
    const match = matchShortcut(text, { apps });
    const learned = match ? undefined : matchLearned(options.learned?.() ?? [], text);
    if (!match && !learned) return undefined;
    const name = match?.name ?? "learned";
    const call: ToolCall = match ? { id: `shortcut-${match.name}`, ...match.call } : { id: "shortcut-learned", name: "computer", input: { action: "shortcut", app: learned!.app, goal: learned!.goal } };
    const result = await tools.run(call, signal);
    if (result.isError) {
      options.onFallback?.({ name, reason: "tool_error" });
      return undefined;
    }
    options.onHit?.({ name, ms: now() - started });
    // A replay that stopped is told as it is: the model is not asked to finish it, because some clicks already happened.
    if (learned && /\bstopped\b/.test(result.content)) return `I ran your saved shortcut “${learned.goal}”, but it stopped partway because the screen was not as expected. Nothing more was clicked. Tell me how to continue.`;
    return learned ? `Done: ${learned.goal}.` : result.content;
  };
}
