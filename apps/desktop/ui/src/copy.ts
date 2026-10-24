// What goes on the clipboard, and the quote that "Reply to this" adds to a draft. Pure functions, ports of MarkdownCopy.swift (ADR-143/144),
// MarkdownHTML.swift, HiddenCharacters and ComposerQuote (ADR-149/151). No DOM, no clipboard: `clipboard.ts` writes what these return.

import { parseBlocks, parseInline, type Align, type Block, type Inline } from "./markdown.ts";

export interface ClipContent {
  text: string;
  /** A second representation; a destination app chooses which one it takes. */
  html?: string;
  /** Spreadsheet-friendly text. */
  tabular?: string;
}

export type ReplyFormat = "markdown" | "plain" | "rich";
export type TableFormat = "markdown" | "tsv" | "csv";

/** Inline marks removed, text kept: the words a reader sees. */
export function plainInline(text: string): string {
  const walk = (nodes: Inline[]): string => nodes.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : walk(n.children))).join("");
  return walk(parseInline(text));
}

/** Markdown is the default (the reply button and Copy last reply). Plain removes the marks; rich adds an HTML flavour. */
export function replyContent(text: string, format: ReplyFormat = "markdown"): ClipContent {
  if (format === "markdown") return { text };
  const blocks = parseBlocks(text);
  return format === "plain" ? { text: plainBlocks(blocks) } : { text: plainBlocks(blocks), html: blocks.map(htmlOf).join("") };
}

function plainBlocks(blocks: Block[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
        case "heading":
          return plainInline(block.text);
        case "code":
          return block.text; // code characters are literal, never read as marks
        case "list":
          return block.items
            .map((item, index) => {
              const task = item.checked === undefined ? "" : item.checked ? "[x] " : "[ ] ";
              const marker = (block.number !== undefined ? `${block.number + index}. ` : task === "" ? "• " : "") + task;
              const children = plainBlocks(item.children);
              const nested = children === "" ? "" : `\n${children.split("\n").map((l) => `  ${l}`).join("\n")}`;
              return marker + plainInline(item.text) + nested;
            })
            .join("\n");
        case "quote":
          return plainBlocks(block.children);
        case "rule":
          return "────────";
        case "table":
          return [block.header, ...block.rows].map((row) => row.map(plainInline).join("\t")).join("\n");
      }
    })
    .join("\n\n");
}

// ---------- HTML flavour ----------

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Bold, italic and `code` only; anything else stays as the text it is. */
function htmlInline(s: string): string {
  let out = escapeHtml(s);
  for (const [pattern, template] of [[/`([^`]+)`/g, "<code>$1</code>"], [/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"], [/\*([^*]+)\*/g, "<em>$1</em>"]] as const) {
    out = out.replace(pattern, template);
  }
  return out;
}

const lineBreaks = (html: string) => html.replace(/\n/g, "<br>");

export function htmlOf(block: Block): string {
  switch (block.kind) {
    case "paragraph":
      return `<p>${lineBreaks(htmlInline(block.text))}</p>`;
    case "heading":
      return `<h${block.level}>${htmlInline(block.text)}</h${block.level}>`;
    case "list": {
      const tag = block.number === undefined ? "ul" : "ol";
      const start = block.number !== undefined && block.number !== 1 ? ` start="${block.number}"` : "";
      const items = block.items
        .map((item) => `<li>${item.checked === undefined ? "" : item.checked ? "☑ " : "☐ "}${lineBreaks(htmlInline(item.text))}${item.children.map(htmlOf).join("")}</li>`)
        .join("");
      return `<${tag}${start}>${items}</${tag}>`;
    }
    case "quote":
      return `<blockquote>${block.children.map(htmlOf).join("")}</blockquote>`;
    case "rule":
      return "<hr>";
    case "code":
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    case "table": {
      const cell = (text: string, tag: string, index: number) => {
        const align = block.alignment[index];
        const style = align && align !== "none" ? ` style="text-align:${align}"` : "";
        return `<${tag}${style}>${htmlInline(text.replace(/\\\|/g, "|"))}</${tag}>`;
      };
      const head = `<tr>${block.header.map((c, i) => cell(c, "th", i)).join("")}</tr>`;
      const body = block.rows.map((row) => `<tr>${row.map((c, i) => cell(c, "td", i)).join("")}</tr>`).join("");
      return `<table border="1" cellspacing="0" cellpadding="4">${head}${body}</table>`;
    }
  }
}

export function htmlOfReply(text: string): string {
  return parseBlocks(text).map(htmlOf).join("");
}

// ---------- tables ----------

export function tableContent(header: string[], rows: string[][], alignment: Align[] = [], format: TableFormat): ClipContent {
  const columns = header.length;
  const padded = rows.map((r) => [...r.slice(0, columns), ...Array<string>(Math.max(0, columns - r.length)).fill("")]);
  if (format === "markdown") {
    const row = (cells: string[]) => `| ${cells.map(markdownCell).join(" | ")} |`;
    const marks = header.map((_, i) => ({ none: "---", left: ":---", center: ":---:", right: "---:" })[alignment[i] ?? "none"]);
    return { text: [row(header), row(marks), ...padded.map(row)].join("\n"), html: htmlOf({ kind: "table", header, rows: padded, alignment }) };
  }
  const delimiter = format === "tsv" ? "\t" : ",";
  const text = [header, ...padded].map((cells) => cells.map((c) => separatedCell(plainInline(c), delimiter)).join(delimiter)).join("\r\n");
  return format === "tsv" ? { text, tabular: text } : { text };
}

function markdownCell(text: string): string {
  const line = text.replace(/\r\n|\n|\r/g, " ");
  let out = "";
  let escaped = false;
  for (const c of line) {
    if (c === "|" && !escaped) out += "\\";
    out += c;
    escaped = c === "\\" ? !escaped : false;
  }
  // A trailing odd backslash must not escape the table's closing separator.
  return escaped ? `${out}\\` : out;
}

function separatedCell(text: string, delimiter: string): string {
  return text.includes(delimiter) || /["\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// ---------- quoting ----------

/** Removes a narrow set of invisible display controls (ADR-149): not a prompt-injection or authorization boundary. */
export function stripHidden(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = "";
  for (const cluster of graphemes(text)) {
    const points = [...cluster].map((c) => c.codePointAt(0)!);
    const flag = points[0] === 0x1f3f4 && points[points.length - 1] === 0xe007f; // tagged flag emoji stay whole
    for (const [i, value] of points.entries()) {
      const hidden =
        value === 0 || value === 0x061c || value === 0x200b || value === 0x200e || value === 0x200f || value === 0x2060 || value === 0xfeff ||
        (value >= 0x202a && value <= 0x202e) || (value >= 0x2066 && value <= 0x2069) ||
        (!flag && (value === 0xe0001 || (value >= 0xe0020 && value <= 0xe007f)));
      if (hidden) removed += 1;
      else out += String.fromCodePoint(value);
      void i;
    }
  }
  return { text: out, removed };
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;
function graphemes(text: string): string[] {
  return segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : [...text];
}

const PREVIEW_CHARS = 600;
const PREVIEW_LINES = 8;
/** Every line-break character the Swift reader counts (CR LF, LF, CR, VT, FF, NEL, LS, PS). */
const NEWLINES = "\\r\\n|[\\n\\r\\u000b\\u000c\\u0085" + String.fromCharCode(0x2028, 0x2029) + "]";
const isNewline = (g: string) => new RegExp(`^(?:${NEWLINES})$`).test(g);

/** The first 600 characters and 8 lines, ending in an ellipsis; undefined when the whole text fits (UserMessagePreview). */
export function collapsed(text: string): string | undefined {
  const all = graphemes(text);
  let characters = 0;
  let lines = 1;
  let end = 0;
  while (end < all.length && characters < PREVIEW_CHARS) {
    if (isNewline(all[end]!)) {
      if (lines === PREVIEW_LINES) break;
      lines += 1;
    }
    characters += 1;
    end += 1;
  }
  return end < all.length ? `${all.slice(0, end).join("")}…` : undefined;
}

/** The draft with a quote of the reply appended; undefined when there is nothing to quote (ComposerQuote). */
export function quoteAppending(reply: string, draft: string): string | undefined {
  const clean = stripHidden(reply).text.trim();
  if (clean === "") return undefined;
  const excerpt = collapsed(clean) ?? clean;
  const quote = excerpt.split(new RegExp(NEWLINES)).map((line) => `> ${line}`).join("\n");
  const separator = draft === "" || draft.endsWith("\n\n") ? "" : draft.endsWith("\n") ? "\n" : "\n\n";
  return `${draft}${separator}${quote}\n\n`;
}

/** "Reply to this" refuses when the combined draft would pass this many characters (ADR-151). */
export const MAX_QUOTED_DRAFT = 4000;
