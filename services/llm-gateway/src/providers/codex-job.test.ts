import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { codexJobArgs, runCodexJob } from "./codex-job.ts";
import type { CliRunner } from "./cli-tools.ts";

// ADR-098 item 7: a Codex run gets no MCP server and no browser, so the browser and MCP safety checks have no gap.

const report = JSON.stringify({ title: "T", summary: "S", body: "B", sources: [] });
const unsafe = /mcp|browser|playwright|--add-mcp|--profile|--full-auto|danger|bypass/i;

test("a Codex run is never started with MCP servers or a browser", async () => {
  for (const files of [undefined, { cwd: "/tmp/work", others: ["/tmp/other"] }]) {
    let seen: { args: string[]; env?: NodeJS.ProcessEnv } | undefined;
    const run: CliRunner = async (_program, args, options) => {
      seen = { args, env: options.env };
      writeFileSync(args[args.indexOf("--output-last-message") + 1]!, report);
      return { stdout: "", stderr: "" };
    };
    await runCodexJob({ program: "codex", instructions: "i", task: "t", web: true, ...(files ? { files } : {}), timeoutMs: 1000, signal: new AbortController().signal, run, env: { PATH: "/bin", OPENAI_API_KEY: "x" } });
    const flags = seen!.args.slice(0, -1); // the last argument is the prompt text
    assert.deepEqual(flags.filter((a) => unsafe.test(a)), []);
    assert.ok(flags.includes("--ignore-user-config"), "the user's own Codex config (and its MCP servers) is not loaded");
    assert.ok(flags.includes("--ephemeral"));
    assert.equal(seen!.env?.OPENAI_API_KEY, undefined);
  }
});

test("Codex job arguments fix the sandbox by kit", () => {
  const folder = codexJobArgs({ web: false, files: { cwd: "/w", others: ["/o"] } }, "/out", "p");
  assert.ok(folder.includes("workspace-write") && folder.includes("sandbox_workspace_write.network_access=false"));
  assert.deepEqual(folder.slice(folder.indexOf("--cd"), folder.indexOf("--cd") + 2), ["--cd", "/w"]);
  const none = codexJobArgs({ web: false }, "/out", "p");
  assert.ok(none.includes("read-only") && none.includes('web_search="disabled"'));
});
