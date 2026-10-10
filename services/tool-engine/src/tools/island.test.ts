import { test } from "node:test";
import assert from "node:assert/strict";
import { createIslandTools } from "./island.ts";

test("island tools ask the island, and fail plainly when there is none", async () => {
  const asked: string[] = [];
  let attached = true;
  const tools = createIslandTools({ openSettings: () => (asked.push("settings"), attached), playPause: () => (asked.push("key"), attached) });
  const run = async (name: string) => tools.find((t) => t.spec.name === name)!.run({});
  assert.equal(await run("open_zeno_settings"), "Opened settings.");
  assert.equal(await run("play_pause"), "Done.");
  assert.deepEqual(asked, ["settings", "key"]);
  attached = false;
  await assert.rejects(() => run("play_pause"), /ZENO window is not running/);
});
