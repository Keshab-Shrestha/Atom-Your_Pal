import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIPv4 } from "node:net";
import { webFetchProblem } from "./web-guard.ts";

export const PUBLIC_PAGE_BYTES = 512 * 1024;
export const PUBLIC_PAGE_CHARS = 12_000;
export const PUBLIC_PAGE_TIMEOUT_MS = 15_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const TEXT_TYPES = new Set(["text/html", "text/plain", "text/markdown"]);

class PageProblem extends Error {}

/** IPv4-only transport: refuse special-use destinations even when a public name resolves to one. */
function publicIPv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function pageURL(raw: string, tainted: boolean): URL {
  const problem = webFetchProblem(raw, { tainted });
  if (problem) throw new PageProblem(problem);
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" || url.port) throw new PageProblem("This tool reads public HTTPS pages on the standard port only.");
  url.hash = "";
  return url;
}

/** DNS cannot itself be cancelled, but a late result must never initiate a connection. */
async function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}

interface PageReadOptions {
  signal?: AbortSignal;
  /** Current host configuration/task, checked before connections, on incoming data and before return. */
  allowed(): boolean;
  /** Host policy runs before DNS and again before each connection, including redirect destinations. */
  check(url: string): Promise<string | undefined>;
  /** Mark the worker as having read untrusted web data, including a redirect response. */
  seen(url: string): void;
}

type PageResponse = { redirect: string } | { body: Buffer; html: boolean };

function readResponse(url: URL, address: string, signal: AbortSignal, allowed: () => boolean): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "GET", agent: false, family: 4, signal, rejectUnauthorized: true,
      // The hostname stays intact for TLS identity/Host; the socket uses only the validated address.
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
      maxHeaderSize: 16 * 1024,
      headers: { "User-Agent": "ATOM-Public-Page/1.0", Accept: "text/html, text/plain, text/markdown", "Accept-Encoding": "identity" },
    }, (response) => {
      response.on("error", reject);
      response.on("aborted", () => reject(new PageProblem("The page response ended before it could be read.")));
      const refuse = (message: string) => { reject(new PageProblem(message)); response.destroy(); };
      if (!allowed()) return refuse("Web reading is no longer allowed for this task.");
      const status = response.statusCode ?? 0;
      if (REDIRECTS.has(status)) {
        const location = response.headers.location;
        if (!location || location.length > 1200) return refuse("The page returned an unusable redirect.");
        resolve({ redirect: location }); response.destroy(); return;
      }
      if (status !== 200) return refuse(`The page returned HTTP ${status}; no page text was read.`);
      const type = response.headers["content-type"] ?? "";
      const mime = type.split(";", 1)[0]!.trim().toLowerCase();
      if (!TEXT_TYPES.has(mime)) return refuse("This tool reads HTML, plain text and Markdown only; it does not download other files.");
      const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(type)?.[1]?.toLowerCase();
      if (charset && !["utf-8", "utf8", "us-ascii"].includes(charset)) return refuse("This page uses an unsupported text encoding.");
      const encoding = response.headers["content-encoding"]?.trim().toLowerCase();
      if (encoding && encoding !== "identity") return refuse("The server returned compressed content despite a plain-text request; this tool did not read it.");
      const length = response.headers["content-length"];
      if (length && (!/^\d+$/.test(length) || Number(length) > PUBLIC_PAGE_BYTES)) return refuse("That page exceeds the 512 KiB response limit.");
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        if (!allowed()) return refuse("Web reading is no longer allowed for this task.");
        bytes += chunk.length;
        if (bytes > PUBLIC_PAGE_BYTES) return refuse("That page exceeds the 512 KiB response limit.");
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ body: Buffer.concat(chunks), html: mime === "text/html" }));
    });
    req.on("error", reject);
    req.end();
  });
}

function entities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (whole, name: string) => {
    if (!name.startsWith("#")) return named[name.toLowerCase()] ?? whole;
    const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
}

/** Bounded plain-text extraction, not a browser or DOM renderer. Malformed hidden regions may omit text. */
function pageText(raw: string, html: boolean): string {
  let text = raw;
  if (html) {
    const hidden = new Set(["script", "style", "head", "template", "noscript", "svg", "iframe", "object", "canvas"]);
    const parts: string[] = [];
    let suppressed: string | undefined;
    // Linear scans avoid repeated searches for missing delimiters on hostile markup.
    let cursor = 0;
    while (cursor < raw.length) {
      if (raw.startsWith("<!--", cursor)) {
        const end = raw.indexOf("-->", cursor + 4);
        cursor = end < 0 ? raw.length : end + 3;
        continue;
      }
      const atTag = raw[cursor] === "<";
      const end = raw.indexOf(atTag ? ">" : "<", cursor + 1);
      const next = end < 0 ? raw.length : atTag ? end + 1 : end;
      const value = raw.slice(cursor, next);
      cursor = next;
      if (value.startsWith("<")) {
        const tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(value);
        const name = tag?.[2]?.toLowerCase();
        if (suppressed) { if (tag?.[1] && name === suppressed) suppressed = undefined; }
        else if (name && !tag?.[1] && hidden.has(name)) suppressed = name;
        else parts.push(" ");
      } else if (!suppressed) parts.push(value);
    }
    text = entities(parts.join(""));
  }
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

/** Direct, unauthenticated HTTPS GET. No browser, proxy agent, cookies, credentials, scripts or model fallback. */
export async function readPublicPage(raw: string, options: PageReadOptions): Promise<{ url: string; text: string; truncated: boolean }> {
  const timeout = AbortSignal.timeout(PUBLIC_PAGE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const allowed = () => { try { return !signal.aborted && options.allowed(); } catch { return false; } };
  try {
    let url = pageURL(raw, false);
    for (let redirects = 0; ; redirects++) {
      signal.throwIfAborted();
      if (!allowed()) throw new PageProblem("Web reading is no longer allowed for this task.");
      const problem = await options.check(url.href);
      if (problem) throw new PageProblem(problem);
      const addresses = isIPv4(url.hostname) ? [{ address: url.hostname }] : await cancellable(lookup(url.hostname, { family: 4, all: true, verbatim: true }), signal);
      if (!addresses.length || addresses.some((entry) => !publicIPv4(entry.address))) throw new PageProblem("The page has no permitted public IPv4 destination. Local, private and special-use networks are not read.");
      const beforeConnect = await options.check(url.href);
      signal.throwIfAborted();
      if (beforeConnect) throw new PageProblem(beforeConnect);
      const response = await readResponse(url, addresses[0]!.address, signal, allowed);
      signal.throwIfAborted();
      if (!allowed()) throw new PageProblem("Web reading is no longer allowed for this task.");
      options.seen(url.href);
      if ("redirect" in response) {
        if (redirects >= 2) throw new PageProblem("The page exceeded this tool's two-redirect limit.");
        let next: URL;
        try { next = new URL(response.redirect, url); } catch { throw new PageProblem("The page returned an invalid redirect."); }
        url = pageURL(next.href, true);
        continue;
      }
      signal.throwIfAborted();
      if (!allowed()) throw new PageProblem("Web reading is no longer allowed for this task.");
      let text: string;
      try { text = pageText(new TextDecoder("utf-8", { fatal: true }).decode(response.body), response.html); }
      catch { throw new PageProblem("The page did not contain readable UTF-8 text."); }
      if (!text) throw new PageProblem("No readable page text was found. This tool does not run JavaScript.");
      return { url: url.href, text: text.slice(0, PUBLIC_PAGE_CHARS), truncated: text.length > PUBLIC_PAGE_CHARS };
    }
  } catch (error) {
    if (options.signal?.aborted) throw new PageProblem("The task was stopped; no page text was returned.");
    if (timeout.aborted) throw new PageProblem("The page read exceeded its 15-second time limit.");
    if (error instanceof PageProblem) throw error;
    throw new PageProblem("The public page could not be read. Network, DNS or TLS verification failed; no fallback was used.");
  }
}
