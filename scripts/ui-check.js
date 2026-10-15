// The live half of scripts/ui-check.sh: reads the text ATOM's window shows, through Accessibility (no screen
// recording needed), and fails when the window is not up or when raw Markdown reaches the screen (a table drawn as
// `| a | b |`, `**bold**` marks). Read-only: it clicks nothing.
// (System Events cannot read SwiftUI's accessibility labels, so buttons are not checked here.)
// Run with: osascript -l JavaScript scripts/ui-check.js
// The sidebar rows are buttons whose text System Events cannot read; the header text is readable.
const HEADER = ["ATOM"];
const RAW_TABLE_ROW = /^\s*\|.*\|\s*$/;
const RAW_BOLD = /\*\*[^*]+\*\*/;

function run() {
  const p = Application("System Events").processes.byName("ATOM");
  let window;
  try { window = p.windows[0]; window.role(); } catch { return "FAIL no ATOM window (open it, or run scripts/ui-check.sh)"; }

  const texts = [];
  for (const e of window.entireContents()) {
    try { if (e.role() === "AXStaticText") texts.push(String(e.value() ?? "")); } catch {}
  }
  const missing = HEADER.filter((name) => !texts.includes(name));
  if (missing.length) return `FAIL the window lacks: ${missing.join(", ")}`;
  const raw = texts.filter((t) => RAW_TABLE_ROW.test(t) || RAW_BOLD.test(t));
  if (raw.length) return `FAIL raw Markdown on screen:\n  ${raw.slice(0, 5).map((t) => t.slice(0, 80)).join("\n  ")}`;
  return `ok window up with ${texts.length} texts, header present, no raw Markdown`;
}
console.log(run());
