import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The design system's rule: main and secondary text reach 4.5:1 on every surface they sit on, in both themes (design/atom-design-system/DESIGN.md).

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
const hexes = (block: string) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!]));
const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
assert.ok(lightStart > 0, "the light theme block exists");
const dark = hexes(css.slice(0, lightStart));
const light = { ...dark, ...hexes(css.slice(lightStart)) };

function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// [text token, background token, minimum ratio]
const PAIRS: [string, string, number][] = [
  ["text", "work", 7], ["text", "card", 7], ["text", "ws", 7],
  ["text2", "work", 4.5], ["muted", "work", 4.5], ["muted", "card", 4.5], ["muted", "ws", 4.5],
  ["panel-fg", "panel", 7], ["panel-muted", "panel", 4.5], ["panel-fg", "panel-input", 4.5], ["panel-muted", "panel-input", 4.5],
  ["eyebrow", "work", 4.5], ["eyebrow", "ws", 4.5],
  ["on-accent", "accent", 4.5], ["bubble-fg", "bubble", 7],
  ["warn", "card", 4.5], ["bad", "card", 4.5], ["bad", "panel", 4.5], ["on-bad", "bad", 4.5], ["eyebrow", "panel", 4.5],
  ["rail-icon", "rail", 3], ["rail-fg", "rail", 7],
];

for (const [name, tokens] of [["dark", dark], ["light", light]] as const) {
  test(`${name} theme: text pairs reach their contrast`, () => {
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(tokens[fg]!, tokens[bg]!);
      assert.ok(ratio >= min, `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  });
}
