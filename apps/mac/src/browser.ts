// ADR-098 item 4: a browser for workers with the browser grant. Playwright's MCP server runs ZENO's own Chromium with
// its own profile in data/browser-profile (never Keshab's browser). Every browser tool call passes `browserCheck`, in
// code: the first visit to each site and the first typing or submit on each site ask Keshab on ATOM's card; uploads
// only from the agent's granted folders; files the browser saves stay in data/. The log gets tool names and origins,
// never typed text.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isInside, realish } from "@zeno/helpers";

/** The MCP server's name: its tools are `mcp__zeno-browser__browser_*`. Keshab's own servers may not use it. */
export const BROWSER_SERVER = "zeno-browser";

/** The Agent SDK config that starts Playwright's MCP server for one agent's run. */
export function browserServer(dataDir: string, helper: string): Record<string, unknown> {
  const cli = join(dirname(createRequire(import.meta.url).resolve("@playwright/mcp/package.json")), "cli.js");
  return {
    type: "stdio",
    command: process.execPath,
    args: [
      cli,
      "--browser", "chromium", // Playwright's own Chromium (Chrome for Testing), not the Chrome Keshab uses
      "--user-data-dir", join(dataDir, "browser-profile", helper), // one profile per agent; logins stay in it
      "--output-dir", join(dataDir, "browser-files", helper), // downloads and screenshots stay in data/
      "--no-webmcp", // no tools that pages register
    ],
  };
}

/** The browser tools a run may use. Others (run code, evaluate, network, storage) are refused. */
const TOOLS = new Set([
  "navigate", "navigate_back", "click", "hover", "drag", "drop", "type", "fill_form", "select_option", "press_key",
  "handle_dialog", "file_upload", "snapshot", "find", "take_screenshot", "wait_for", "tabs", "close", "resize",
]);
/** Tools that need no approval for the page the browser is on (they do not act on it). */
const NO_PAGE = new Set(["navigate", "tabs", "close", "wait_for", "resize"]);
/** Keys that move around a page; any other key may type or submit. */
const MOVE_KEYS = /^(Arrow(Up|Down|Left|Right)|Page(Up|Down)|Home|End|Tab|Shift\+Tab|Escape)$/;
// ponytail: a click is a submit when its words look like one; a "Next" that submits slips through. Upgrade: ask on every click.
const SUBMIT_WORDS = /submit|sign ?in|log ?in|sign ?up|register|buy|purchase|pay|checkout|check out|place order|order now|send|post|publish|delete|remove|confirm|subscribe|transfer|book now|reserve|apply/i;

export interface BrowserCheckOptions {
  /** The agent's name, for the approval card. */
  name: string;
  /** The agent's granted folders (uploads come only from these). */
  grants: string[];
  approve(request: { summary: string; reason: string }): Promise<boolean>;
  /** For the log: the tool, the site's origin and the verdict. Never typed text or full addresses. */
  onCheck?(event: { tool: string; origin?: string; verdict: "allowed" | "refused" | "declined" }): void;
}

const originOf = (url: string): string | undefined => {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : undefined;
  } catch {
    return undefined;
  }
};

/** All text in a tool result (MCP content blocks, or a plain string). */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("\n");
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text;
    if ("content" in v) return textOf(v.content);
  }
  return "";
}

/**
 * One run's browser policy: `check` for each call (why it is refused, or the line for the task's thread), and `seen`
 * for each result (the page the browser is on, and the last snapshot for clicks). Answers last for the run.
 */
export function browserCheck(options: BrowserCheckOptions) {
  const grants = options.grants.map((g) => realish(g));
  const answers = new Map<string, Promise<boolean>>(); // one question per site and kind, even for calls at once
  let page: string | undefined; // the origin the browser shows now
  let snapshot = "";
  const ask = (key: string, summary: string, reason: string) => {
    if (!answers.has(key)) answers.set(key, options.approve({ summary, reason }));
    return answers.get(key)!;
  };
  const mayOpen = (origin: string) =>
    ask(`open ${origin}`, `${options.name} wants to open ${origin} in its browser`, "Allow for the rest of this task. It uses ZENO's own browser profile, not yours.");
  const maySubmit = (origin: string) =>
    ask(
      `submit ${origin}`,
      `${options.name} wants to type or submit a form on ${origin}`,
      "This may log in, send or buy. Allow typing and submitting on this site for the rest of this task.",
    );

  /** Whether a call types into or submits something on the page. */
  const submits = (tool: string, input: Record<string, unknown>): boolean => {
    if (tool === "type" || tool === "fill_form" || tool === "file_upload") return true;
    if (tool === "drop") return input.data !== undefined;
    if (tool === "press_key") return !MOVE_KEYS.test(String(input.key ?? ""));
    if (tool === "handle_dialog") return input.accept === true;
    if (tool === "click") {
      const target = String(input.target ?? input.ref ?? "");
      const line = target ? (snapshot.split("\n").find((l) => l.includes(`[ref=${target}]`)) ?? "") : "";
      return SUBMIT_WORDS.test(`${String(input.element ?? "")} ${target} ${line}`);
    }
    return false;
  };

  const outsideGrants = (paths: unknown) =>
    Array.isArray(paths) && paths.some((p) => typeof p !== "string" || !grants.some((root) => isInside(root, realish(p))));

  async function check(full: string, input: Record<string, unknown>): Promise<{ deny: string } | { step: string }> {
    const prefix = `mcp__${BROWSER_SERVER}__browser_`;
    const tool = full.startsWith(prefix) ? full.slice(prefix.length) : "";
    const say = (verdict: "allowed" | "refused" | "declined", origin?: string) => options.onCheck?.({ tool, ...(origin ? { origin } : {}), verdict });
    const refuse = (message: string, origin?: string) => (say("refused", origin), { deny: message });
    if (!TOOLS.has(tool)) return refuse("ZENO does not allow that browser tool.");
    if (input.filename !== undefined) return refuse("Do not save browser output to a file. Read it in the reply.");
    if ((tool === "file_upload" || tool === "drop") && outsideGrants(input.paths)) {
      return refuse("Uploads may only come from this agent's granted folders.", page);
    }
    // Opening a site: the address it goes to.
    const to = tool === "navigate" || (tool === "tabs" && input.url !== undefined) ? String(input.url ?? "") : undefined;
    if (to !== undefined) {
      const origin = originOf(to);
      if (!origin && to !== "about:blank") return refuse("The browser opens only http and https addresses.");
      if (origin && !(await mayOpen(origin))) {
        say("declined", origin);
        return { deny: `Keshab did not allow ${origin}. Do the task without that site, or say in the report what is needed.` };
      }
      say("allowed", origin);
      return { step: `Browser: open ${origin ?? "a blank page"}` };
    }
    // Acting on the page it is on (a link or a redirect may have brought it to a new site).
    if (page && !NO_PAGE.has(tool)) {
      if (!(await mayOpen(page))) {
        say("declined", page);
        return { deny: `Keshab did not allow ${page}. Go back or open another site.` };
      }
      if (submits(tool, input) && !(await maySubmit(page))) {
        say("declined", page);
        return { deny: `Keshab did not allow typing or submitting on ${page}. Do the task without it, or say in the report what is needed.` };
      }
    }
    say("allowed", page);
    return { step: `Browser: ${tool.replace(/_/g, " ")}${page ? ` on ${page}` : ""}` };
  }

  /** A browser tool's result: remembers the page's origin (the last "Page URL") and the last page snapshot. */
  function seen(result: unknown): void {
    const text = textOf(result);
    const urls = [...text.matchAll(/- Page URL: (\S+)/g)];
    if (urls.length) page = originOf(urls.at(-1)![1]!);
    if (text.includes("[ref=")) snapshot = text;
  }

  return { check, seen };
}
