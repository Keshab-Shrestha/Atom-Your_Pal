import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";

function startZeno(env: Record<string, string>, args: string[] = [], input?: string) {
  return spawnSync(process.execPath, ["apps/mac/src/main.ts", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
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

test("ZENO starts with valid configuration", () => {
  const result = startZeno({ ZENO_LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "test-key" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ZENO: started/);
});

test("ZENO exits with a clear error when configuration is invalid", () => {
  const result = startZeno({ ZENO_LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid configuration:/);
  assert.match(result.stderr, /ANTHROPIC_API_KEY is required/);
});

test("island mode: invalid configuration is a config error event and exit code 78", () => {
  const result = startZeno({ ZENO_LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "" }, ["--island"]);
  assert.equal(result.status, 78);
  const [event, ...rest] = events(result.stdout);
  assert.equal(event.type, "error");
  assert.equal(event.stage, "config");
  assert.match(String(event.message), /ANTHROPIC_API_KEY is required/);
  assert.deepEqual(rest, []);
});

test("island mode: stdout carries only events; closing stdin exits cleanly", () => {
  // Bad command then end of input: the runtime reports the bad line, then leaves because the island went away.
  const result = startZeno({ ZENO_LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "test-key" }, ["--island"], "not json\n");
  assert.equal(result.status, 0, result.stderr);
  const all = events(result.stdout); // throws if anything else reached stdout
  assert.deepEqual(all[0], { type: "error", stage: "protocol", message: "Command is not valid JSON." });
  assert.match(result.stderr, /island mode/); // human-readable startup line goes to stderr
});

test("island mode: SIGTERM exits cleanly", async () => {
  const child = spawn(process.execPath, ["apps/mac/src/main.ts", "--island"], {
    env: { ...process.env, ZENO_LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "test-key" },
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
