import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT = 256 * 1024;
const MAX_WORD_XML = 1024 * 1024;

export class DocumentReaderUnavailable extends Error {}

/** Read only the Word document part, in memory. No archive entry is ever written or external relationship followed. */
export function wordDocumentXML(zip: Buffer): Buffer {
  const invalid = () => new Error("The Word document is invalid or exceeds its extraction budget.");
  if (zip.length > MAX_DOCUMENT_BYTES || zip.length < 22) throw invalid();
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { end = i; break; }
  }
  if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) throw invalid();
  const count = zip.readUInt16LE(end + 10), offset = zip.readUInt32LE(end + 16), size = zip.readUInt32LE(end + 12);
  if (count < 1 || count > 4096 || count !== zip.readUInt16LE(end + 8) || offset + size > end) throw invalid();
  let position = offset, found: Buffer | undefined;
  for (let i = 0; i < count; i++) {
    if (position + 46 > offset + size || zip.readUInt32LE(position) !== 0x02014b50) throw invalid();
    const flags = zip.readUInt16LE(position + 8), method = zip.readUInt16LE(position + 10);
    const checksum = zip.readUInt32LE(position + 16), compressed = zip.readUInt32LE(position + 20), expanded = zip.readUInt32LE(position + 24);
    const nameSize = zip.readUInt16LE(position + 28), extra = zip.readUInt16LE(position + 30), comment = zip.readUInt16LE(position + 32);
    const local = zip.readUInt32LE(position + 42);
    const next = position + 46 + nameSize + extra + comment;
    if (next > offset + size || zip.readUInt16LE(position + 34)) throw invalid();
    const name = zip.subarray(position + 46, position + 46 + nameSize);
    if (name.equals(Buffer.from("word/document.xml"))) {
      if (found || flags & 1 || ![0, 8].includes(method) || expanded > MAX_WORD_XML || compressed > MAX_DOCUMENT_BYTES
          || local + 30 > offset || zip.readUInt32LE(local) !== 0x04034b50
          || zip.readUInt16LE(local + 6) !== flags || zip.readUInt16LE(local + 8) !== method) throw invalid();
      const localNameSize = zip.readUInt16LE(local + 26), start = local + 30 + localNameSize + zip.readUInt16LE(local + 28);
      if (start + compressed > offset || !zip.subarray(local + 30, local + 30 + localNameSize).equals(name)) throw invalid();
      const input = zip.subarray(start, start + compressed);
      const xml = method === 0 ? input : inflateRawSync(input, { maxOutputLength: MAX_WORD_XML });
      if (xml.length !== expanded || crc32(xml) !== checksum) throw invalid();
      found = Buffer.from(xml);
    }
    position = next;
  }
  if (!found || position !== offset + size) throw invalid();
  return found;
}

function documentHelper(): string | undefined {
  return ["../island/build/ATOM.app/Contents/MacOS/atom-documents", "../island/.build/release/AtomDocuments"]
    .map((path) => fileURLToPath(new URL(path, import.meta.url))).find(existsSync);
}

/** An owned bounded native parser; receives bytes, never a source path, provider, tool or network instruction. */
export async function extractDocumentText(kind: "pdf" | "docx", input: Buffer, helper = documentHelper(), timeoutMs = 5000): Promise<string> {
  if (input.length > MAX_DOCUMENT_BYTES) throw new Error("Document exceeds the extraction input budget.");
  const payload = kind === "docx" ? wordDocumentXML(input) : input;
  if (kind === "pdf" && !input.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Invalid PDF document.");
  if (!helper) throw new DocumentReaderUnavailable("The PDF/Word reader is unavailable. Rebuild ATOM before importing documents.");
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [kind === "docx" ? "word-xml" : "pdf"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    let bytes = 0, settled = false;
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.kill("SIGKILL");
      reject(new Error("The document could not be extracted within its local reader budget."));
    };
    const timer = setTimeout(fail, timeoutMs);
    child.stderr.resume();
    child.on("error", fail); child.stdin.on("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_DOCUMENT_TEXT * 6 + 4096) { fail(); return; }
      output.push(chunk);
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) { fail(); return; }
      try {
        const value = JSON.parse(Buffer.concat(output).toString("utf8"));
        if (typeof value.text !== "string" || !value.text.trim() || value.text.includes("\0") || Buffer.byteLength(value.text) > MAX_DOCUMENT_TEXT) throw new Error();
        settled = true; clearTimeout(timer); resolve(value.text);
      } catch { fail(); }
    });
    child.stdin.end(payload);
  });
}
