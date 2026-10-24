// A reply is split into Markdown blocks, then each block's text into inline spans. A port of MarkdownBlocks.swift (same blocks, same
// rules, same limits) plus the inline subset that the Swift view got from the system's Markdown reader. This is a display format, not
// an execution format: the result is plain data, and the renderer builds elements from it, never HTML strings.

export type Align = "none" | "left" | "center" | "right";

export interface ListItem {
  text: string;
  /** A display-only task state; undefined means an ordinary list item. */
  checked?: boolean;
  children: Block[];
}

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; items: ListItem[]; number?: number }
  | { kind: "code"; text: string; language?: string }
  | { kind: "table"; header: string[]; rows: string[][]; alignment: Align[] }
  | { kind: "quote"; children: Block[] }
  | { kind: "rule" };

/** Beyond this depth the source stays visible as a paragraph, without dropping content. */
export const MAX_NESTING = 16;
/** Text longer than this in one block is shown as it is, not scanned for inline marks. */
export const MAX_INLINE_CHARS = 20_000;

const HSPACE = /^[^\S\r\n]+|[^\S\r\n]+$/g;
const trimH = (s: string) => s.replace(HSPACE, "");

export function isRich(text: string): boolean {
  return parseBlocks(text).some((block) => block.kind !== "paragraph");
}

export function parseBlocks(text: string): Block[] {
  return parseLines(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n"), 0);
}

function parseLines(lines: string[], depth: number): Block[] {
  if (depth >= MAX_NESTING) return [{ kind: "paragraph", text: lines.join("\n") }];
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let i = 0;
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = trimH(line);
    const fence = openingFence(trimmed);
    let heading: Block | undefined;
    let marker: Marker | undefined;
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !closesFence(lines[i]!, fence)) body.push(lines[i++]!);
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", text: body.join("\n"), ...(fence.language ? { language: fence.language } : {}) });
    } else if (trimmed === "") {
      flush();
      i += 1;
    } else if (quoteContent(line) !== undefined) {
      flush();
      const quoted: string[] = [];
      for (let c = quoteContent(lines[i] ?? ""); i < lines.length && c !== undefined; c = quoteContent(lines[i] ?? "")) {
        quoted.push(c);
        i += 1;
      }
      blocks.push({ kind: "quote", children: parseLines(quoted, depth + 1) });
    } else if (isRule(trimmed)) {
      flush();
      blocks.push({ kind: "rule" });
      i += 1;
    } else if ((heading = headingOf(trimmed))) {
      flush();
      blocks.push(heading);
      i += 1;
    } else if (isTableRow(trimmed) && i + 1 < lines.length && isDivider(lines[i + 1]!)) {
      flush();
      const header = cells(trimmed);
      const marks = cells(lines[i + 1]!).map((cell): Align => {
        if (cell.startsWith(":") && cell.endsWith(":")) return "center";
        if (cell.startsWith(":")) return "left";
        if (cell.endsWith(":")) return "right";
        return "none";
      });
      const alignment = marks.every((m) => m === "none") ? [] : marks;
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(trimH(lines[i]!))) rows.push(pad(cells(lines[i++]!), header.length));
      blocks.push({ kind: "table", header, rows, alignment });
    } else if ((marker = listMarker(line))) {
      flush();
      const result = parseList(lines, i, marker, depth);
      blocks.push(result.block);
      i = result.next;
    } else {
      paragraph.push(trimmed);
      i += 1;
    }
  }
  flush();
  return blocks;
}

interface Marker {
  indent: number;
  contentIndent: number;
  text: string;
  number?: number;
}

function sameKind(a: Marker, b: Marker) {
  return (a.number === undefined) === (b.number === undefined);
}

function parseList(lines: string[], start: number, first: Marker, depth: number): { block: Block; next: number } {
  const items: ListItem[] = [];
  let index = start;
  for (;;) {
    const marker = index < lines.length ? listMarker(lines[index]!) : undefined;
    if (!marker || marker.indent !== first.indent || !sameKind(marker, first) || isRule(lines[index]!)) break;
    const task = taskText(marker.text);
    let text = task.text;
    const children: string[] = [];
    index += 1;
    while (index < lines.length) {
      const line = lines[index]!;
      const trimmed = trimH(line);
      if (trimmed === "") {
        let next = index + 1;
        while (next < lines.length && trimH(lines[next]!) === "") next += 1;
        if (next >= lines.length) break;
        const sibling = listMarker(lines[next]!);
        if (sibling && sibling.indent === first.indent && sameKind(sibling, first) && !isRule(lines[next]!)) {
          index = next;
          break;
        }
        if (indentation(lines[next]!) < marker.contentIndent) break;
        for (let k = 0; k < next - index; k++) children.push("");
        index = next;
      } else if (indentation(line) >= marker.contentIndent) {
        children.push(removingIndent(line, marker.contentIndent));
        index += 1;
      } else if (
        indentation(line) >= first.indent && children.length === 0 && !listMarker(line) && quoteContent(line) === undefined &&
        !headingOf(trimmed) && !openingFence(trimmed) && !isRule(trimmed) && !isTableRow(trimmed)
      ) {
        // A wrapped unindented sentence belongs to the current item until a new block or a blank line.
        text += `\n${trimmed}`;
        index += 1;
      } else {
        break;
      }
    }
    items.push({ text, ...(task.checked !== undefined ? { checked: task.checked } : {}), children: children.length === 0 ? [] : parseLines(children, depth + 1) });
  }
  return { block: { kind: "list", items, ...(first.number !== undefined ? { number: first.number } : {}) }, next: index };
}

function listMarker(line: string): Marker | undefined {
  const trimmed = line.replace(/^[ \t]+/, "");
  let prefix: number;
  let number: number | undefined;
  if (trimmed.length > 0 && "-*+•".includes(trimmed[0]!)) {
    prefix = 1;
  } else {
    const digits = /^[0-9]+/.exec(trimmed)?.[0] ?? "";
    const mark = trimmed[digits.length];
    if (digits.length === 0 || digits.length > 9 || (mark !== "." && mark !== ")")) return undefined;
    number = Number(digits);
    prefix = digits.length + 1;
  }
  const rest = trimmed.slice(prefix);
  if (rest[0] !== " " && rest[0] !== "\t") return undefined;
  const text = rest.replace(/^[ \t]+/, "");
  const consumed = line.length - text.length;
  return { indent: indentation(line), contentIndent: columns(line.slice(0, consumed)), text, ...(number !== undefined ? { number } : {}) };
}

function taskText(text: string): { text: string; checked?: boolean } {
  for (const [prefix, checked] of [["[ ]", false], ["[x]", true], ["[X]", true]] as const) {
    if (text.startsWith(prefix)) {
      const rest = text.slice(3);
      if (rest === "" || rest[0] === " " || rest[0] === "\t") return { text: rest.replace(/^[ \t]+/, ""), checked };
    }
  }
  return { text };
}

interface Fence {
  mark: string;
  count: number;
  language?: string;
}

function openingFence(line: string): Fence | undefined {
  const mark = line[0];
  if (mark !== "`" && mark !== "~") return undefined;
  let count = 0;
  while (line[count] === mark) count += 1;
  if (count < 3) return undefined;
  const info = trimH(line.slice(count));
  if (mark === "`" && info.includes("`")) return undefined;
  const token = info.split(/\s+/)[0];
  const language = token && token.length <= 48 && /^[A-Za-z0-9_+.#-]+$/.test(token) ? token : undefined;
  return { mark, count, ...(language ? { language } : {}) };
}

function closesFence(line: string, fence: Fence): boolean {
  const text = trimH(line);
  let run = 0;
  while (text[run] === fence.mark) run += 1;
  return run >= fence.count && trimH(text.slice(run)) === "";
}

function quoteContent(line: string): string | undefined {
  let text = line.replace(/^[ \t]+/, "");
  if (text[0] !== ">") return undefined;
  text = text.slice(1);
  if (text[0] === " " || text[0] === "\t") text = text.slice(1);
  return text;
}

function isRule(line: string): boolean {
  const marks = line.replace(/[ \t]/g, "");
  if (marks.length < 3 || !"-*_".includes(marks[0]!)) return false;
  return [...marks].every((c) => c === marks[0]);
}

function headingOf(line: string): Block | undefined {
  let hashes = 0;
  while (line[hashes] === "#") hashes += 1;
  if (hashes < 1 || hashes > 6 || line[hashes] !== " ") return undefined;
  return { kind: "heading", level: hashes, text: trimH(line.slice(hashes)) };
}

function columns(prefix: string): number {
  let count = 0;
  for (const c of prefix) count += c === "\t" ? 4 - (count % 4) : 1;
  return count;
}

function indentation(line: string): number {
  return columns(/^[ \t]*/.exec(line)![0]);
}

function removingIndent(line: string, count: number): string {
  let i = 0;
  let removed = 0;
  while (removed < count && i < line.length && (line[i] === " " || line[i] === "\t")) {
    removed += line[i] === "\t" ? 4 - (removed % 4) : 1;
    i += 1;
  }
  return " ".repeat(Math.max(0, removed - count)) + line.slice(i);
}

function isTableRow(line: string): boolean {
  return line.startsWith("|") && line.slice(1).includes("|");
}

function isDivider(line: string): boolean {
  const text = trimH(line);
  return isTableRow(text) && text.includes("-") && /^[|\-: ]*$/.test(text);
}

function cells(line: string): string[] {
  const text = trimH(line);
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  for (const c of text) {
    if (c === "|" && !escaped) {
      parts.push(current);
      current = "";
    } else {
      current += c;
    }
    escaped = c === "\\" ? !escaped : false;
  }
  parts.push(current);
  if (text.startsWith("|")) parts.shift();
  if (parts[parts.length - 1] === "" && text.endsWith("|")) parts.pop();
  return parts.map(trimH);
}

function pad(row: string[], count: number): string[] {
  return row.length >= count ? row.slice(0, count) : [...row, ...Array<string>(count - row.length).fill("")];
}

// ---------- inline ----------

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

/** Only these may become links. Anything else (javascript:, data:, file:, custom schemes) stays visible as the text it is. */
const SAFE_HREF = /^(?:https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+)$/i;
const MAX_INLINE_DEPTH = 6;

/** Code spans, **bold**, *italic* and _italic_, ~~strike~~ and [links](https://…). Marks that never close stay as typed. */
export function parseInline(text: string, depth = 0): Inline[] {
  if (text.length > MAX_INLINE_CHARS || depth > MAX_INLINE_DEPTH) return [{ kind: "text", text }];
  const out: Inline[] = [];
  let plain = "";
  const emit = () => {
    if (plain) out.push({ kind: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length && /[\\`*_~[\]()#+\-.!|>]/.test(text[i + 1]!)) {
      plain += text[i + 1];
      i += 2;
    } else if (c === "`") {
      let run = 0;
      while (text[i + run] === "`") run += 1;
      const close = findRun(text, "`", run, i + run);
      if (close < 0) {
        plain += "`".repeat(run);
        i += run;
      } else {
        emit();
        out.push({ kind: "code", text: text.slice(i + run, close).replace(/^ (.*[^ ].*) $/s, "$1") });
        i = close + run;
      }
    } else if (c === "*" || c === "_" || c === "~") {
      let run = 0;
      while (text[i + run] === c) run += 1;
      const width = c === "~" ? (run >= 2 ? 2 : 0) : Math.min(run, 2);
      const before = text[i - 1];
      const after = text[i + width];
      const opens = width > 0 && after !== undefined && !/\s/.test(after) && (c !== "_" || before === undefined || !/\w/.test(before));
      const close = opens ? findClose(text, c, width, i + width) : -1;
      if (close < 0) {
        plain += c.repeat(run);
        i += run;
      } else {
        emit();
        const kind = c === "~" ? "del" : width === 2 ? "strong" : "em";
        out.push({ kind, children: parseInline(text.slice(i + width, close), depth + 1) });
        i = close + width;
      }
    } else if (c === "[") {
      const link = readLink(text, i);
      if (!link) {
        plain += c;
        i += 1;
      } else {
        emit();
        out.push({ kind: "link", href: link.href, children: parseInline(link.label, depth + 1) });
        i = link.end;
      }
    } else {
      plain += c;
      i += 1;
    }
  }
  emit();
  return out;
}

/** The index of the next run of exactly `count` of `mark` at or after `from`, or -1. */
function findRun(text: string, mark: string, count: number, from: number): number {
  let i = text.indexOf(mark, from);
  while (i >= 0) {
    let run = 0;
    while (text[i + run] === mark) run += 1;
    if (run === count) return i;
    i = text.indexOf(mark, i + run);
  }
  return -1;
}

/** The closing mark of an emphasis span: it must follow a non-space, and (for _) not sit inside a word. */
function findClose(text: string, mark: string, width: number, from: number): number {
  let i = text.indexOf(mark, from);
  while (i >= 0) {
    let run = 0;
    while (text[i + run] === mark) run += 1;
    const prev = text[i - 1];
    const next = text[i + width];
    const closes = run >= width && i > from && prev !== undefined && !/\s/.test(prev) && prev !== "\\" && (mark !== "_" || next === undefined || !/\w/.test(next));
    if (closes) return run === width || mark === "~" ? i : i + (run - width);
    i = text.indexOf(mark, i + run);
  }
  return -1;
}

function readLink(text: string, start: number): { label: string; href: string; end: number } | undefined {
  const closeLabel = text.indexOf("](", start + 1);
  if (closeLabel < 0) return undefined;
  const label = text.slice(start + 1, closeLabel);
  if (label === "" || label.includes("[") || label.includes("\n")) return undefined;
  const closeUrl = text.indexOf(")", closeLabel + 2);
  if (closeUrl < 0) return undefined;
  const href = text.slice(closeLabel + 2, closeUrl).trim();
  return SAFE_HREF.test(href) ? { label, href, end: closeUrl + 1 } : undefined;
}
