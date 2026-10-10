import type { Tool } from "../engine.ts";
import type { Osascript } from "./media.ts";
import { execFile } from "node:child_process";

const defaultOsascript: Osascript = (script) =>
  new Promise((resolve, reject) =>
    execFile("/usr/bin/osascript", ["-e", script], { timeout: 10_000 }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout.trim()),
    ),
  );

/** Text as an AppleScript string literal. */
export function appleScriptString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Plain text as the HTML Notes stores: escaped, one <div> per line. */
export function noteHtml(title: string, body: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = body.split(/\n/).map((l) => `<div>${esc(l) || "<br>"}</div>`);
  return `<div><b>${esc(title)}</b></div>${lines.join("")}`;
}

/**
 * ADR-070: "take a note" goes into Apple Notes, in the default account's Notes folder. Adding only: ZENO never reads,
 * changes or deletes notes. ZENO_NOTES=0 turns it off.
 */
export function createNoteTools(options: { osascript?: Osascript } = {}): Tool[] {
  const run = options.osascript ?? defaultOsascript;
  return [
    {
      capability: { title: "Notes", examples: ["Take a note: buy milk", "Write down that I parked on level 3"] },
      spec: {
        name: "note_add",
        description:
          "Saves a new note in Apple Notes. Use it when the user says take a note, note down, or write down something. " +
          "Keep the user's words; give it a short title.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "A short title, a few words." },
            text: { type: "string", description: "The note itself, in the user's words." },
          },
          required: ["text"],
        },
      },
      async run(input) {
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!text) throw new Error("the note is empty");
        if (text.length > 20_000) throw new Error("the note is too long");
        const title = (typeof input.title === "string" && input.title.trim()) || text.split(/[.\n]/)[0]!.slice(0, 60);
        await run(`tell application "Notes" to make new note with properties {body:${appleScriptString(noteHtml(title, text))}}`);
        return `Saved a note in Notes: "${title}".`;
      },
    },
  ];
}
