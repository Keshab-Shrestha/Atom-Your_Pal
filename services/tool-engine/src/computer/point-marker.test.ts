import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePointMarker, pointMarkerFilter, toScreenPoint } from "./point-marker.ts";
import type { ScreenShot } from "./screen.ts";

// Keshab's main display: 1920×1080 points at 1x, shrunk to 1280×720 for the model.
const main: ScreenShot = { width: 1280, height: 720, display: { x: 0, y: 0, width: 1920, height: 1080 } };

test("a valid marker is taken off the reply and converted to screen points", () => {
  const r = parsePointMarker("It's the fan icon, top right. [POINT:1200,10:the fan icon]", main);
  assert.equal(r.text, "It's the fan icon, top right.");
  assert.equal(r.marker, "point");
  assert.deepEqual(r.target, { x: 1800, y: 15, label: "the fan icon" });
});

test("[POINT:none] is removed and points nowhere", () => {
  const r = parsePointMarker("I can't see a Wi-Fi icon on your screen. [POINT:none]", main);
  assert.deepEqual(r, { text: "I can't see a Wi-Fi icon on your screen.", marker: "none" });
});

test("the last marker wins, and every marker is removed from the text", () => {
  const r = parsePointMarker("First [POINT:1,1:a] then [point:640,360:b]", main);
  assert.equal(r.text, "First then");
  assert.deepEqual(r.target, { x: 960, y: 540, label: "b" });
});

test("a malformed or out-of-range marker is dropped silently and never left in the text", () => {
  for (const reply of [
    "Here. [POINT:abc]",
    "Here. [POINT:12]",
    "Here. [POINT:1280,10:off the right edge]",
    "Here. [POINT:10,720:off the bottom]",
    "Here. [POINT:-5,10:negative]",
    "Here. [POINT:1e3,10:exponent]",
    "Here. [POINT:10,10:cut off",
  ]) {
    const r = parsePointMarker(reply, main);
    assert.equal(r.text, "Here.", reply);
    assert.equal(r.target, undefined, reply);
    assert.equal(r.marker, "bad", reply);
  }
});

test("without a screenshot this turn a marker is removed but points nowhere", () => {
  const r = parsePointMarker("There. [POINT:10,10:x]", undefined);
  assert.deepEqual(r, { text: "There.", marker: "bad" });
});

test("a reply without a marker is unchanged, and a trailing half marker is removed", () => {
  assert.deepEqual(parsePointMarker("Just words [like this].", main), { text: "Just words [like this]." });
  assert.equal(parsePointMarker("Top right. [POI", main).text, "Top right.");
});

test("the label is one short line; a missing label is empty", () => {
  assert.equal(parsePointMarker(`[POINT:5,5:${"long ".repeat(30)}\nline]`, main).target?.label.length, 60);
  assert.equal(parsePointMarker("[POINT:5,5]", main).target?.label, "");
});

test("pixels → points on a Retina display (2880×1800 pixels, 1440×900 points, shrunk to 1280×800)", () => {
  const retina: ScreenShot = { width: 1280, height: 800, display: { x: 0, y: 0, width: 1440, height: 900 } };
  assert.deepEqual(toScreenPoint(640, 400, retina), { x: 720, y: 450 });
  assert.deepEqual(toScreenPoint(1279, 0, retina), { x: 1438.875, y: 0 });
});

test("pixels → points on a second display to the right of and above the main one (Cua's top-left space, y down)", () => {
  const second: ScreenShot = { width: 1280, height: 720, display: { x: 1920, y: -200, width: 2560, height: 1440 } };
  assert.deepEqual(toScreenPoint(100, 50, second), { x: 2120, y: -100 });
  assert.deepEqual(parsePointMarker("[POINT:640,360:middle]", second).target, { x: 3200, y: 520, label: "middle" });
});

// ---- streamed speech (ADR-065): a marker, or the start of one, is never passed on

function spoken(deltas: string[]): string {
  let out = "";
  const f = pointMarkerFilter((d) => (out += d));
  for (const d of deltas) f.push(d);
  return out;
}

test("streamed text passes through, but a marker split across pieces is never spoken", () => {
  assert.equal(spoken(["It's top ", "right. [PO", "INT:12", "00,10:the fan", " icon]"]), "It's top right. ");
  assert.equal(spoken(["Top right.", " [", "P", "O", "I", "N", "T", ":", "none", "]"]), "Top right. ");
});

test("streamed text after a marker, and brackets that are not a marker, are spoken", () => {
  assert.equal(spoken(["A [POINT:1,1:x] B"]), "A  B");
  assert.equal(spoken(["Use [", "brackets] or [P", "S] freely"]), "Use [brackets] or [PS] freely");
});

test("a half marker at the end of the stream is held back for good", () => {
  assert.equal(spoken(["Top right. [POI"]), "Top right. ");
  assert.equal(spoken(["Top right. [POINT:12,"]), "Top right. ");
});
