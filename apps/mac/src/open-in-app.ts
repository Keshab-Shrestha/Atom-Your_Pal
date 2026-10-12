// ADR-081/082, Task 3.14: a finished report opens in its worker's app, by code. A browser opens the top sources as
// tabs (http and https only); Notes gets the report as a new note; any other app opens the report as a text file.

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { webSources, type Report } from "@atom/helpers";
import { appleScriptString, noteHtml } from "@atom/tool-engine";

export const BROWSERS: readonly string[] = [
  "Safari", "Brave Browser", "Google Chrome", "Arc", "Firefox", "Microsoft Edge", "Chromium", "Opera", "Vivaldi", "Orion", "Zen Browser", "Dia",
];
export const MAX_TABS = 5;

export interface OpenDeps {
  /** `open -a <app> <args…>`. */
  open(app: string, args: string[]): Promise<void>;
  osascript(script: string): Promise<void>;
  /** Where reports for other apps are written. */
  reportsDir: string;
}

export const defaultOpenDeps = (reportsDir: string): OpenDeps => ({
  open: (app, args) =>
    new Promise((resolve, reject) => execFile("/usr/bin/open", ["-a", app, ...args], { timeout: 10_000 }, (e) => (e ? reject(new Error(`${app} could not open it.`)) : resolve()))),
  osascript: (script) =>
    new Promise((resolve, reject) => execFile("/usr/bin/osascript", ["-e", script], { timeout: 10_000 }, (e, _o, err) => (e ? reject(new Error(err.trim() || e.message)) : resolve()))),
  reportsDir,
});

/** The report as plain text, with its sources at the end. */
export function reportText(report: Pick<Report, "title" | "summary" | "body" | "sources">): string {
  const sources = webSources(report.sources).map((s) => `- ${s.title}: ${s.url}`);
  return [report.title, report.summary, report.body, ...(sources.length ? [`Sources:\n${sources.join("\n")}`] : [])].join("\n\n");
}

/** Opens a task's report in `app`; returns what happened, in words. Throws with words for the user. */
export async function openInApp(app: string, taskId: number, report: Pick<Report, "title" | "summary" | "body" | "sources">, deps: OpenDeps): Promise<string> {
  if (BROWSERS.includes(app)) {
    const urls = webSources(report.sources).slice(0, MAX_TABS).map((s) => s.url);
    if (!urls.length) throw new Error("The report has no web sources to open.");
    await deps.open(app, urls);
    return `Opened ${urls.length === 1 ? "the source" : `${urls.length} sources`} in ${app}.`;
  }
  if (app === "Notes") {
    const body = reportText(report).split("\n\n").slice(1).join("\n\n"); // the title is the note's first line
    await deps.osascript(`tell application "Notes" to make new note with properties {body:${appleScriptString(noteHtml(report.title, body))}}`);
    return "Saved the report in Notes.";
  }
  mkdirSync(deps.reportsDir, { recursive: true });
  const file = join(deps.reportsDir, `task-${taskId}.txt`);
  writeFileSync(file, `${reportText(report)}\n`);
  await deps.open(app, [file]);
  return `Opened the report in ${app}.`;
}
