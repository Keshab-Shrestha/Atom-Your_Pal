import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import type { Tool } from "../engine.ts";
import { appBlock } from "../computer/policy.ts";
import { BROWSERS, browserOsascript, lsappinfoFront, tabScript, type FrontApp } from "./front-window.ts";
import type { Osascript } from "./media.ts";

/** Runs a program; resolves with stdout, rejects with its error. */
export type Exec = (file: string, args: string[]) => Promise<string>;

const defaultExec: Exec = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 10_000 }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
    ),
  );

const APP_DIRS = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities"];

export interface AppToolOptions {
  exec?: Exec;
  /** Names of installed apps (without ".app"). Default: the standard Applications folders. */
  listApps?: () => Promise<string[]>;
  /** For `open_url`'s `same_tab`: the app in front (default `lsappinfo`) and the browser's AppleScript. */
  frontApp?: () => Promise<FrontApp | undefined>;
  osascript?: Osascript;
}

/** The most characters a query and a fragment may have in an address `open_url` opens. A search link is far shorter. */
export const MAX_URL_DATA = 300;

/** Apps that may be opened although ATOM never controls them: opening System Settings shows it, nothing more. */
const OPEN_ONLY = new Set(["com.apple.systempreferences"]);

export async function installedApps(): Promise<string[]> {
  const home = process.env.HOME ? [`${process.env.HOME}/Applications`] : [];
  const names = new Set<string>(["Finder"]); // lives in CoreServices, which is otherwise all helpers
  for (const dir of [...APP_DIRS, ...home]) {
    try {
      for (const entry of await readdir(dir)) if (entry.endsWith(".app")) names.add(entry.slice(0, -4));
    } catch {
      // folder missing: fine
    }
  }
  return [...names];
}

const norm = (s: string) => s.toLowerCase().replace(/\.app$/, "").replace(/[^a-z0-9]/g, "");

/** The installed app the user most likely meant: exact name, then a name that starts with or contains it. */
export function matchApp(wanted: string, apps: string[]): string | undefined {
  const w = norm(wanted);
  if (!w) return undefined;
  return (
    apps.find((a) => norm(a) === w) ??
    apps.find((a) => norm(a).startsWith(w)) ??
    apps.find((a) => norm(a).includes(w)) ??
    apps.find((a) => w.includes(norm(a)) && norm(a).length >= 4)
  );
}

/**
 * ADR-066: open (or switch to) an app, or open a web address in the default browser. Always on: it starts apps the
 * way the Dock does, sees nothing on screen and clicks nothing, so it needs no approval. Apps that computer control
 * never touches (terminals, password managers, System Settings, AI agents) are refused here too.
 */
export function createAppTools(options: AppToolOptions = {}): Tool[] {
  const exec = options.exec ?? defaultExec;
  const listApps = options.listApps ?? installedApps;
  const frontApp = options.frontApp ?? lsappinfoFront;
  const osascript = options.osascript ?? browserOsascript;
  return [
    {
      capability: { title: "Open apps and websites", examples: ["Open Safari"] },
      spec: {
        name: "open_app",
        description:
          "Opens an app on this Mac, or brings it to the front if it is already open (e.g. Safari, Notes, Music). Use it whenever the user asks to open, launch or switch to an app.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "The app's name, e.g. \"Safari\"." } },
          required: ["name"],
        },
      },
      async run(input) {
        const wanted = typeof input.name === "string" ? input.name.trim() : "";
        if (!wanted) throw new Error("say which app to open");
        const app = matchApp(wanted, await listApps());
        if (!app) throw new Error(`no app called "${wanted}" is installed`);
        let bundleId: string | undefined;
        try {
          bundleId = (await exec("/usr/bin/osascript", ["-e", `id of app "${app.replace(/["\\]/g, "")}"`])).trim() || undefined;
        } catch {
          // unknown id: the name check below still applies
        }
        const blocked = appBlock(bundleId, app);
        if (blocked && !(bundleId && OPEN_ONLY.has(bundleId))) throw new Error(blocked);
        await exec("/usr/bin/open", ["-a", app]);
        return `Opened ${app}.`;
      },
    },
    {
      capability: { title: "Open apps and websites", examples: ["Go to YouTube", "Search Google for pasta recipes"] },
      spec: {
        name: "open_url",
        description:
          "Opens a web page in the default browser. Use it when the user asks to open or go to a website (e.g. \"open YouTube\" means https://www.youtube.com) or to search the web for something (use a Google search URL).",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "A full http or https address." },
            same_tab: { type: "boolean", description: "true to open it in the browser tab in front when that tab shows the same site (e.g. a YouTube search while YouTube is open)." },
          },
          required: ["url"],
        },
      },
      async run(input) {
        const raw = typeof input.url === "string" ? input.url.trim() : "";
        let url: URL;
        try {
          url = new URL(/^[a-z]+:/i.test(raw) ? raw : `https://${raw}`);
        } catch {
          throw new Error(`"${raw}" is not a web address`);
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("only web pages (http or https) can be opened");
        // 2026-10-16 (security review): a page, a file or an agent report can tell ATOM to open an address, and the address itself can carry
        // data out (https://evil.test/?d=<secret>). No login in the address, and no long query or fragment: ask the user to open that one.
        if (url.username || url.password) throw new Error("an address with a login in it is not opened; ask the user to open it themselves");
        if (url.search.length + url.hash.length > MAX_URL_DATA) throw new Error(`that address carries ${url.search.length + url.hash.length} characters of data after the page name; ask the user to open it themselves`);
        if (input.same_tab === true && (await openInFrontTab(url, frontApp, osascript))) return `Opened ${url.hostname} in this tab.`;
        await exec("/usr/bin/open", [url.href]);
        return `Opened ${url.hostname}.`;
      },
    },
  ];
}

const site = (host: string) => host.replace(/^(www|m)\./, "");

/**
 * Loads `url` in the active tab of the browser in front (Chrome, Arc, Edge or Brave, the browsers `front_window`
 * reads) when that tab shows the same site. False when it does not apply: another app in front, a private window,
 * another site, or the browser cannot be scripted; the caller then opens a new tab.
 */
async function openInFrontTab(url: URL, frontApp: () => Promise<FrontApp | undefined>, osascript: Osascript): Promise<boolean> {
  try {
    const front = await frontApp();
    if (!front?.bundleId || !BROWSERS.has(front.bundleId)) return false;
    const [mode, , address = ""] = (await osascript(tabScript(front.bundleId))).split(String.fromCharCode(31));
    if (mode !== "normal" || site(new URL(address).hostname) !== site(url.hostname)) return false;
    // url.href is percent-encoded, so it holds no quote or backslash; strip them anyway.
    await osascript(`tell application id "${front.bundleId}" to set URL of active tab of front window to "${url.href.replace(/["\\]/g, "")}"`);
    return true;
  } catch {
    return false; // a new tab still does what was asked
  }
}
