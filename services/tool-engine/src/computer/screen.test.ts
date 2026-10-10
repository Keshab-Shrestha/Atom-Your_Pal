import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createLookAtScreenTool, type ScreenShot } from "./screen.ts";
import type { CuaResult, CuaTransport } from "./cua-client.ts";

const ok = (text: string, data: Record<string, any> = {}): CuaResult => ({ text, data, isError: false, refusal: undefined });

/** Cua with a 1920×1080-point main display; the desktop capture writes a stand-in PNG where it is told to. */
function fakeCua(over: Record<string, (args: any) => Promise<CuaResult> | CuaResult> = {}) {
  const calls: Array<{ name: string; args: any }> = [];
  const cua: CuaTransport = {
    async call(name, args) {
      calls.push({ name, args });
      if (over[name]) return over[name](args);
      if (name === "get_screen_size") return ok("Main display: 1920x1080 points @ 1x", { width: 1920, height: 1080, scale_factor: 1 });
      if (name === "get_desktop_state") {
        await writeFile(String(args.screenshot_out_file), "PNG-BYTES");
        return ok("captured", { screenshot_file_path: args.screenshot_out_file, screenshot_width: 1920, screenshot_height: 1080 });
      }
      throw new Error(`unexpected ${name}`);
    },
    async close() {},
  };
  return { cua, calls };
}

/** Stands in for sips: writes a "JPEG" and reports its size. Remembers where it worked, to check the files are gone. */
function fakeShrink(size = { width: 1280, height: 720 }) {
  const seen: Array<{ input: string; output: string; maxSide: number; inputBytes: string }> = [];
  const shrink = async (input: string, output: string, maxSide: number) => {
    seen.push({ input, output, maxSide, inputBytes: await readFile(input, "utf8") });
    await writeFile(output, "JPEG-BYTES");
    return size;
  };
  return { shrink, seen };
}

test("look_at_screen returns Cua's screenshot of the main display, shrunk to 1280 px, with its size and the pointing instruction", async () => {
  const { cua, calls } = fakeCua();
  const { shrink, seen } = fakeShrink();
  const shots: ScreenShot[] = [];
  const steps: unknown[] = [];
  const tool = createLookAtScreenTool({ cua, shrink, onShot: (s) => shots.push(s), onStep: (s) => steps.push(s) });
  const out = await tool.run({});
  assert.equal(typeof out, "object");
  const { text, images } = out as { text: string; images: Array<{ mimeType: string; data: string }> };
  assert.deepEqual(images, [{ mimeType: "image/jpeg", data: Buffer.from("JPEG-BYTES").toString("base64") }]);
  assert.match(text, /main display/i);
  assert.match(text, /1280×720 pixels/);
  assert.match(text, /\[POINT:x,y:label\]/);
  assert.match(text, /\[POINT:none\]/);
  assert.deepEqual(shots, [{ width: 1280, height: 720, display: { x: 0, y: 0, width: 1920, height: 1080 } }]);
  assert.deepEqual(steps, [{ action: "look" }]);
  // Cua wrote the full-size PNG to a file ZENO chose, which was handed to the shrinker.
  const capture = calls.find((c) => c.name === "get_desktop_state")!;
  assert.deepEqual(Object.keys(capture.args), ["screenshot_out_file"]);
  assert.equal(seen[0]!.input, capture.args.screenshot_out_file);
  assert.equal(seen[0]!.inputBytes, "PNG-BYTES");
  assert.equal(seen[0]!.maxSide, 1280);
  // Never stored: both files and their folder are gone.
  assert.equal(existsSync(seen[0]!.input), false);
  assert.equal(existsSync(seen[0]!.output), false);
  assert.equal(existsSync(dirname(seen[0]!.input)), false);
});

test("the temporary files are deleted when shrinking fails, and the failure is reported", async () => {
  const { cua, calls } = fakeCua();
  const shots: ScreenShot[] = [];
  const tool = createLookAtScreenTool({ cua, onShot: (s) => shots.push(s), shrink: async () => { throw new Error("sips broke"); } });
  await assert.rejects(async () => tool.run({}), /sips broke/);
  const file = calls.find((c) => c.name === "get_desktop_state")!.args.screenshot_out_file;
  assert.equal(existsSync(dirname(file)), false);
  assert.deepEqual(shots, [], "no screenshot to point against");
});

test("a Cua refusal or a missing file is a plain failure, and the folder is still removed", async () => {
  let folder = "";
  const refused = fakeCua({
    get_desktop_state: (args) => {
      folder = dirname(String(args.screenshot_out_file));
      return { text: "Screen Recording is not granted", data: {}, isError: true, refusal: undefined };
    },
  });
  await assert.rejects(async () => createLookAtScreenTool({ cua: refused.cua, shrink: fakeShrink().shrink }).run({}), /could not take a screenshot.*Screen Recording is not granted/i);
  assert.equal(existsSync(folder), false);

  const silent = fakeCua({ get_desktop_state: () => ok("captured") });
  await assert.rejects(async () => createLookAtScreenTool({ cua: silent.cua, shrink: fakeShrink().shrink }).run({}), /could not take a screenshot/i);
});

test("a screen size Cua cannot report stops before any capture", async () => {
  const { cua, calls } = fakeCua({ get_screen_size: () => ok("?", { width: 0, height: "x" }) });
  await assert.rejects(async () => createLookAtScreenTool({ cua, shrink: fakeShrink().shrink }).run({}), /screen size/i);
  assert.equal(calls.some((c) => c.name === "get_desktop_state"), false);
});

test("look_at_screen is offered only on request, takes no input, and says what it is for", () => {
  const tool = createLookAtScreenTool({ cua: fakeCua().cua });
  assert.equal(tool.spec.name, "look_at_screen");
  assert.deepEqual(tool.spec.inputSchema, { type: "object", properties: {} });
  assert.match(tool.spec.description, /only when the user asks where/i);
  assert.equal(tool.capability?.title, "Point at things");
  assert.ok(tool.capability?.examples.includes("Where's the Wi-Fi icon?"));
});
