// ADR-080: pointing from a screenshot. Cua Driver takes the screenshot (it holds Screen Recording; ATOM holds none),
// ATOM shrinks it with macOS `sips` and hands it to the model, which ends its reply with [POINT:x,y:label].

import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Tool, ToolOutput } from "../engine.ts";
import type { CuaTransport } from "./cua-client.ts";

/** What the model saw: the image's size in pixels and the display it shows, in Cua's screen points (top-left origin, y down). */
export interface ScreenShot {
  width: number;
  height: number;
  display: { x: number; y: number; width: number; height: number };
}

export interface LookAtScreenOptions {
  cua: CuaTransport;
  /** Told about every screenshot handed to the model, so the reply's marker can be checked against it. */
  onShot?: (shot: ScreenShot) => void;
  /** Pal's bubble shows "Looking at the screen". */
  onStep?: (step: { action: string }) => void;
  /** Writes `input` (a PNG) to `output` as a JPEG no longer than `maxSide` on its long side; returns its size. Default: `sips`. */
  shrink?: (input: string, output: string, maxSide: number) => Promise<{ width: number; height: number }>;
}

const MAX_SIDE = 1280;
const run = promisify(execFile);

/** macOS `sips`: shrinks only (never enlarges), re-encodes as JPEG, then reads the result's size back. */
async function sipsShrink(input: string, output: string, maxSide: number): Promise<{ width: number; height: number }> {
  const png = await readFile(input);
  const isPng = png.subarray(1, 4).toString("latin1") === "PNG";
  const long = isPng ? Math.max(png.readUInt32BE(16), png.readUInt32BE(20)) : Infinity;
  await run("sips", [...(long > maxSide ? ["-Z", String(maxSide)] : []), "-s", "format", "jpeg", "-s", "formatOptions", "80", input, "--out", output]);
  const { stdout } = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", output]);
  return { width: Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]), height: Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1]) };
}

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * `look_at_screen`: one screenshot of the main display, on request only. Cua's desktop capture supports only the main
 * display (`display_id: "primary"`), so the display with the pointer cannot be chosen. The image goes to the model and
 * nowhere else: the files exist only while it is shrunk and read, and are deleted whatever happens.
 */
export function createLookAtScreenTool(options: LookAtScreenOptions): Tool<ToolOutput> {
  const { cua, onShot, onStep, shrink = sipsShrink } = options;

  async function look(signal?: AbortSignal): Promise<ToolOutput> {
    onStep?.({ action: "look" });
    const size = (await cua.call("get_screen_size", {}, signal)).data;
    if (!positive(size.width) || !positive(size.height)) throw new Error("Cua could not report the screen size.");
    const dir = await mkdtemp(join(tmpdir(), "atom-look-"));
    try {
      const raw = join(dir, "screen.png");
      const small = join(dir, "screen.jpg");
      const shot = await cua.call("get_desktop_state", { screenshot_out_file: raw }, signal);
      if (shot.isError) throw new Error(`Cua could not take a screenshot: ${shot.refusal?.message || shot.text}`);
      await access(raw).catch(() => {
        throw new Error("Cua could not take a screenshot: it saved no image.");
      });
      const { width, height } = await shrink(raw, small, MAX_SIDE);
      if (!positive(width) || !positive(height)) throw new Error("The screenshot could not be read after shrinking.");
      const data = (await readFile(small)).toString("base64");
      onShot?.({ width, height, display: { x: 0, y: 0, width: size.width, height: size.height } });
      return {
        text:
          `This is a screenshot of the user's main display only, ${width}×${height} pixels. ` +
          "Find what the user asked about. Answer in one short spoken sentence saying where it is, then end the reply with " +
          "[POINT:x,y:label], where x and y are pixel coordinates in this image (from its top-left corner) of the thing's centre " +
          'and label is a few words such as "the Wi-Fi icon"; ATOM flies there. If it is not on this screen, say so and end with [POINT:none]. ' +
          "The marker is never spoken or shown, so do not mention it or the coordinates.",
        images: [{ mimeType: "image/jpeg", data }],
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return {
    capability: { title: "Point at things", examples: ["Where's the Wi-Fi icon?", "Show me the save button"] },
    spec: {
      name: "look_at_screen",
      description:
        "Takes one screenshot of the user's main display so you can show them where something is: ATOM flies to it. " +
        "Use it only when the user asks where something on screen is or to be shown something, never otherwise.",
      inputSchema: { type: "object", properties: {} },
    },
    run: (_input, signal) => look(signal),
  };
}
