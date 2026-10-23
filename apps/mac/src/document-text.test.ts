import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { wordDocumentXML, extractDocumentText, DocumentReaderUnavailable, MAX_DOCUMENT_BYTES } from "./document-text.ts";
import { createBrainSourceFolder } from "./brain-source-folder.ts";
import { openMemoryStore } from "@atom/memory";

function archive(xml: Buffer, options: { method?: number; flags?: number; checksum?: number; expanded?: number; duplicate?: boolean } = {}) {
  const name = Buffer.from("word/document.xml"), method = options.method ?? 8;
  const content = method === 0 ? xml : deflateRawSync(xml);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(options.flags ?? 0, 6); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(options.checksum ?? crc32(xml), 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(options.expanded ?? xml.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(options.flags ?? 0, 8); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(options.checksum ?? crc32(xml), 16); central.writeUInt32LE(content.length, 20); central.writeUInt32LE(options.expanded ?? xml.length, 24); central.writeUInt16LE(name.length, 28);
  const index = Buffer.concat(options.duplicate ? [central, name, central, name] : [central, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(options.duplicate ? 2 : 1, 8); end.writeUInt16LE(options.duplicate ? 2 : 1, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(local.length + name.length + content.length, 16);
  return Buffer.concat([local, name, content, index, end]);
}
const xml = Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve"> Cedar &amp; Birch 🌲 日本語 </w:t><w:tab/><w:t>Thursday</w:t></w:r></w:p></w:body></w:document>');

test("Word extracts only the bounded document part for stored and deflated archives", () => {
  for (const method of [0, 8]) assert.deepEqual(wordDocumentXML(archive(xml, { method })), xml);
});

test("Word refuses ambiguous, encrypted, corrupt, truncated and oversized archives", () => {
  for (const options of [{ duplicate: true }, { flags: 1 }, { checksum: 7 }, { expanded: 2 * 1024 * 1024 }, { method: 99 }]) assert.throws(() => wordDocumentXML(archive(xml, options)));
  assert.throws(() => wordDocumentXML(archive(xml).subarray(0, -1)));
  assert.throws(() => wordDocumentXML(Buffer.alloc(MAX_DOCUMENT_BYTES + 1)));
  assert.throws(() => wordDocumentXML(archive(Buffer.alloc(2 * 1024 * 1024, 65), { expanded: 1 })), "actual decompression is bounded even if sizes lie");
});

test("missing readers fail explicitly, while malformed documents never need a helper", async () => {
  await assert.rejects(extractDocumentText("pdf", Buffer.from("%PDF-1.4"), ""), DocumentReaderUnavailable);
  await assert.rejects(extractDocumentText("pdf", Buffer.from("not a pdf"), ""), /Invalid PDF/);
});

test("an owned document helper is bounded and its errors never expose raw output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-document-helper-")), helper = join(dir, "reader");
  try {
    writeFileSync(helper, '#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on("end",()=>console.log(JSON.stringify({text:"Cedar 🌲\\n"})));\n', { mode: 0o700 });
    assert.equal(await extractDocumentText("pdf", Buffer.from("%PDF-1.4"), helper), "Cedar 🌲\n");
    writeFileSync(helper, '#!/usr/bin/env node\nprocess.stdin.resume();setInterval(()=>{},1000);\n', { mode: 0o700 });
    await assert.rejects(extractDocumentText("pdf", Buffer.from("%PDF-1.4"), helper, 50), /local reader budget/);
    writeFileSync(helper, '#!/usr/bin/env node\nprocess.stdin.resume();console.log("private fixture content");\n', { mode: 0o700 });
    await assert.rejects(extractDocumentText("pdf", Buffer.from("%PDF-1.4"), helper), (error: Error) => !error.message.includes("private fixture"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const helper = resolve("apps/mac/island/.build/arm64-apple-macosx/release/AtomDocuments");
test("native Word reader preserves Unicode and rejects entity declarations", { skip: !existsSync(helper) }, async () => {
  assert.equal(await extractDocumentText("docx", archive(xml), helper), " Cedar & Birch 🌲 日本語 \tThursday\n");
  await assert.rejects(extractDocumentText("docx", archive(Buffer.from('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>')), helper));
});

function pdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = 'BT /F1 12 Tf 72 720 Td (Cedar review Thursday) Tj ET'; objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(text); text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(text + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
test("native PDF reader extracts an actual fictional PDF text layer", { skip: !existsSync(helper) }, async () => {
  assert.match(await extractDocumentText("pdf", pdf(), helper), /Cedar review Thursday/);
});

test("document import uses existing preview/revision/correction rules and keeps originals intact", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-source-documents-"))), home = join(root, "home"), folder = join(home, "Notes"); mkdirSync(folder, { recursive: true });
  const memory = openMemoryStore({ path: ":memory:" });
  try {
    const original = Buffer.from("fictional binary fixture"); writeFileSync(join(folder, "cedar.pdf"), original); writeFileSync(join(folder, "birch.docx"), original);
    const control = createBrainSourceFolder({ store: memory.brainSources!, home, changed() {}, extractDocument: async (kind) => `${kind}: Cedar Thursday 日本語\n` });
    const preview = await control({ type: "brain.source", request: "p", action: "preview", path: folder, documents: true });
    assert.equal(preview.preview?.count, 2); assert.equal(memory.brain.count(), 0);
    assert.equal((await control({ type: "brain.source", request: "c", action: "connect", token: preview.preview!.token })).error, undefined);
    assert.equal(memory.brainSources!.summary().folder?.documents, true);
    assert.equal(memory.brainSources!.summary().notes, 2);
    const note = memory.brain.byTitle("cedar")!; memory.brain.save({ id: note.id, title: note.title, body: "My correction" });
    await control({ type: "brain.source", request: "r", action: "refresh" }); assert.equal(memory.brain.get(note.id)?.body, "My correction");
    assert.deepEqual(readFileSync(join(folder, "cedar.pdf")), original);
    assert.deepEqual(readFileSync(join(folder, "birch.docx")), original);
  } finally { memory.close(); rmSync(root, { recursive: true, force: true }); }
});

test("existing text-only sources never widen their read scope on refresh", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-source-legacy-scope-"))), home = join(root, "home"), folder = join(home, "Notes"); mkdirSync(folder, { recursive: true });
  const memory = openMemoryStore({ path: ":memory:" });
  try {
    writeFileSync(join(folder, "cedar.md"), "# Cedar\nThursday");
    writeFileSync(join(folder, "private.pdf"), "unreviewed"); writeFileSync(join(folder, "private.docx"), "unreviewed");
    const control = createBrainSourceFolder({ store: memory.brainSources!, home, changed() {}, extractDocument: async () => { assert.fail("Unreviewed documents must not be read"); } });
    const preview = await control({ type: "brain.source", request: "p", action: "preview", path: folder });
    assert.equal(preview.preview?.count, 1); assert.equal(preview.preview?.skipped, 2);
    await control({ type: "brain.source", request: "c", action: "connect", token: preview.preview!.token });
    assert.equal(memory.brainSources!.summary().folder?.documents, false);
    assert.equal((await control({ type: "brain.source", request: "r", action: "refresh" })).error, undefined);
    assert.equal(memory.brain.count(), 1);
  } finally { memory.close(); rmSync(root, { recursive: true, force: true }); }
});

test("a source changed during extraction cannot be published as fresh", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-source-extract-change-"))), home = join(root, "home"), folder = join(home, "Notes"); mkdirSync(folder, { recursive: true });
  const file = join(folder, "cedar.pdf"); writeFileSync(file, "before");
  const memory = openMemoryStore({ path: ":memory:" });
  try {
    const control = createBrainSourceFolder({ store: memory.brainSources!, home, changed() {}, extractDocument: async () => { writeFileSync(file, "changed during extraction"); return "Cedar"; } });
    const result = await control({ type: "brain.source", request: "p", action: "preview", path: folder, documents: true });
    assert.match(result.error!, /changed during extraction/); assert.equal(memory.brain.count(), 0);
  } finally { memory.close(); rmSync(root, { recursive: true, force: true }); }
});
