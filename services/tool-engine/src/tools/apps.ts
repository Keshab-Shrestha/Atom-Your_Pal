import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import type { Tool } from "../engine.ts";
import { appBlock } from "../computer/policy.ts";

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
}

async function installedApps(): Promise<string[]> {
  const home = process.env.HOME ? [`${process.env.HOME}/Applications`] : [];
  const names = new Set<string>();
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
        if (blocked) throw new Error(blocked);
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
          properties: { url: { type: "string", description: "A full http or https address." } },
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
        await exec("/usr/bin/open", [url.href]);
        return `Opened ${url.hostname}.`;
      },
    },
  ];
}
