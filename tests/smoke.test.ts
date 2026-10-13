import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Every runtime these tests start uses its own data folder and log, never the real data/ and logs/. */
function tempData(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "atom-smoke-"));
  return { ATOM_HELPERS_FILE: join(dir, "helpers.db"), ATOM_MEMORY_FILE: join(dir, "memory.db"), ATOM_LOG_FILE: join(dir, "atom.log") };
}

function startZeno(env: Record<string, string>, args: string[] = [], input?: string) {
  return spawnSync(process.execPath, ["apps/mac/src/main.ts", ...args], {
    encoding: "utf8",
    // A model saved in the island (config/island.json) overrides the env, so point at a file that
    // does not exist: these tests check the env configuration, not whatever the user last picked.
    env: { ...process.env, ATOM_ISLAND_SETTINGS: "tests/no-saved-choice.json", ...tempData(), ...env },
    input,
    timeout: 30_000,
  });
}

/** Parses island-mode stdout, failing the test if any line is not a protocol event. */
function events(stdout: string) {
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const event = JSON.parse(line) as { type: string; [key: string]: unknown };
      assert.equal(typeof event.type, "string", line);
      return event;
    });
}

test("ATOM starts with valid configuration", () => {
  const result = startZeno({ ATOM_LLM_PROVIDER: "claude-plan" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ATOM: started/);
});

test("ATOM exits with a clear error when configuration is invalid", () => {
  const result = startZeno({ ATOM_LLM_PROVIDER: "openai" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid configuration:/);
  assert.match(result.stderr, /ATOM_LLM_PROVIDER must be one of claude-plan/);
});

test("island mode: invalid configuration is a config error event and exit code 78", () => {
  const result = startZeno({ ATOM_LLM_PROVIDER: "openai" }, ["--island"]);
  assert.equal(result.status, 78);
  const [event, ...rest] = events(result.stdout);
  assert.equal(event.type, "error");
  assert.equal(event.stage, "config");
  assert.match(String(event.message), /ATOM_LLM_PROVIDER must be one of claude-plan/);
  assert.deepEqual(rest, []);
});

test("island mode: stdout carries only events; closing stdin exits cleanly", () => {
  // Bad command then end of input: the runtime reports the bad line, then leaves because the island went away.
  const result = startZeno({ ATOM_LLM_PROVIDER: "claude-plan" }, ["--island"], "not json\n");
  assert.equal(result.status, 0, result.stderr);
  const all = events(result.stdout); // throws if anything else reached stdout
  assert.deepEqual(all[0], { type: "error", stage: "protocol", message: "Command is not valid JSON." });
  assert.match(result.stderr, /island mode/); // human-readable startup line goes to stderr
});

test("island mode: SIGTERM exits cleanly", async () => {
  const child = spawn(process.execPath, ["apps/mac/src/main.ts", "--island"], {
    env: { ...process.env, ATOM_LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "test-key", ...tempData() },
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Wait for the startup line, which is printed once SIGTERM is handled. Earlier stderr lines (such as a
  // warning about a saved model choice) can come first and must not count as "started".
  let seen = "";
  await new Promise<void>((resolve) =>
    child.stderr.on("data", (chunk) => {
      seen += chunk;
      if (seen.includes("island mode")) resolve();
    }),
  );
  child.kill("SIGTERM");
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0);
});

test("a second runtime on the same data folder is refused before any store opens (no recovery)", () => {
  const data = tempData();
  writeFileSync(join(data.ATOM_HELPERS_FILE!, "..", ".atom.lock"), JSON.stringify({ pid: process.pid })); // this process is alive
  const terminal = startZeno({ ATOM_LLM_PROVIDER: "claude-plan", ...data });
  assert.equal(terminal.status, 1);
  assert.match(terminal.stderr, new RegExp(`ATOM already runs on this data folder \\(pid ${process.pid}\\)\\.`));
  const island = startZeno({ ATOM_LLM_PROVIDER: "claude-plan", ...data }, ["--island"]);
  assert.equal(island.status, 78); // the island does not restart on 78
  assert.equal(existsSync(data.ATOM_HELPERS_FILE!), false, "the helpers store was opened");
  assert.equal(existsSync(data.ATOM_MEMORY_FILE!), false, "the memory store was opened");
});
