import { test } from "node:test";
import assert from "node:assert/strict";
import { findProgram } from "@zeno/shared";
import { scanAiTools, type ScanDeps } from "./ai-tools.ts";

// ADR-093: the AI tools found on this Mac, signed in or not, and which ZENO can use.

const deps = (files: string[], answers: Record<string, string | Error> = {}): ScanDeps => ({
  env: { PATH: "/usr/bin" },
  exists: (path) => files.includes(path),
  run: async (program, args) => {
    const answer = answers[`${program} ${args.join(" ")}`];
    if (answer instanceof Error || answer === undefined) throw answer ?? new Error("no");
    return answer;
  },
  home: "/h",
});

test("found and signed in, not found, and local model tools listed but not used", async () => {
  const tools = await scanAiTools(deps(
    ["/h/.local/bin/claude", "/opt/homebrew/bin/gemini", "/h/.gemini/oauth_creds.json", "/opt/homebrew/bin/ollama", "/Applications/LM Studio.app"],
    { "/h/.local/bin/claude auth status": JSON.stringify({ loggedIn: true, email: "never read" }) },
  ));
  const by = Object.fromEntries(tools.map((t) => [t.id, t]));
  assert.deepEqual(tools.map((t) => t.id), ["claude-code", "codex", "gemini-cli", "ollama", "lm-studio"]);
  assert.deepEqual([by["claude-code"]!.found, by["claude-code"]!.signedIn, by["claude-code"]!.provider], [true, true, "claude-plan"]);
  assert.ok(!JSON.stringify(tools).includes("never read"), "only loggedIn is read");
  assert.deepEqual([by["gemini-cli"]!.found, by["gemini-cli"]!.signedIn], [true, true]);
  assert.match(by["gemini-cli"]!.note, /chat only/);
  assert.deepEqual([by.codex!.found, by.codex!.signedIn], [false, undefined]);
  assert.deepEqual([by.ollama!.found, by.ollama!.provider], [true, undefined]);
  assert.match(by.ollama!.note, /local models are not used/);
  assert.equal(by["lm-studio"]!.found, true);
});

test("Codex is found inside the ChatGPT editor extension (the newest), and its sign-in is asked, not read", async () => {
  const old = "/h/.vscode/extensions/openai.chatgpt-26.1002.5-darwin-arm64/bin/macos-aarch64/codex";
  const newest = "/h/.vscode/extensions/openai.chatgpt-26.1007.1-darwin-arm64/bin/macos-aarch64/codex";
  const list = (dir: string) => (dir === "/h/.vscode/extensions" ? ["openai.chatgpt-26.1002.5-darwin-arm64", "openai.chatgpt-26.1007.1-darwin-arm64", "other"] : []);
  assert.equal(findProgram("codex", "ZENO_CODEX_PATH", {}, (p) => p === old || p === newest, "/h", list), newest);
  assert.equal(findProgram("codex", "ZENO_CODEX_PATH", { ZENO_CODEX_PATH: "/gone" }, (p) => p === newest, "/h", list), undefined, "an explicit path is never second-guessed");
  const codexSays = async (said: string | Error) => (await scanAiTools(deps(["/usr/bin/codex"], { "/usr/bin/codex login status": said }))).find((t) => t.id === "codex")!;
  assert.equal((await codexSays("Logged in using ChatGPT")).signedIn, true);
  const out = await codexSays(new Error("not logged in"));
  assert.equal(out.signedIn, false);
  assert.match(out.note, /not signed in: run `codex login`/);
});
