// Stdio MCP server for the worker browser: `browser_*` tools (browser-bridge.ts) over the agent-browser CLI, which drives the installed
// Brave (or another Chromium browser) through its own profile folder. One session per process; it is closed when this process ends.
// Started by `browserServer()` in browser.ts. Flags it does not know (the Playwright ones the Codex adapter still appends) are ignored.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readEnv } from "@ark/shared";
import { BRIDGE_TOOLS, createBridge, type BridgeResult } from "./browser-bridge.ts";

const COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_BROWSER = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

/** The native agent-browser executable inside the installed package (no Node launcher in between). */
export function agentBrowserBinary(): string {
  const root = dirname(createRequire(import.meta.url).resolve("agent-browser/package.json"));
  const name = `agent-browser-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  return join(root, "bin", name);
}

/** Value of `--name value`, or undefined. */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function startBridge(argv: string[]) {
  const profile = flag(argv, "--user-data-dir");
  const initScript = flag(argv, "--init-script");
  const browser = readEnv(process.env, "ARK_BROWSER_PATH") || (existsSync(DEFAULT_BROWSER) ? DEFAULT_BROWSER : undefined);
  const session = `ark-${process.pid}-${randomBytes(3).toString("hex")}`;
  const binary = agentBrowserBinary();
  // pnpm does not run the package's install script, which is what marks the native file executable.
  try { chmodSync(binary, 0o755); } catch { /* read-only install: the spawn below reports it */ }
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    AGENT_BROWSER_SESSION: session,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(10 * 60_000), // a lost bridge cannot leave a browser running for the default hour
    AGENT_BROWSER_NO_WEBMCP: "1", // pages register no tools
    ...(readEnv(process.env, "ARK_BROWSER_HEADLESS") === "1" ? {} : { AGENT_BROWSER_HEADED: "1" }), // a visible window, so Keshab can watch (as before)
    ...(profile ? { AGENT_BROWSER_PROFILE: profile } : {}),
    ...(browser ? { AGENT_BROWSER_EXECUTABLE_PATH: browser } : {}),
    ...(initScript ? { AGENT_BROWSER_INIT_SCRIPTS: initScript } : {}),
  };

  function run(args: string[]): Promise<BridgeResult> {
    return new Promise((resolve) => {
      const child = spawn(binary, ["--json", ...args], { env, stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), COMMAND_TIMEOUT_MS);
      child.stdout.on("data", (d) => { out += d; });
      child.on("error", () => { clearTimeout(timer); resolve({ ok: false, error: "The browser program could not start." }); });
      child.on("close", () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(out.trim().split("\n").pop() ?? "");
          resolve({ ok: parsed.success === true, data: parsed.data ?? undefined, error: parsed.error ?? undefined });
        } catch {
          resolve({ ok: false, error: "The browser command gave no answer." });
        }
      });
    });
  }

  async function screenshot() {
    const dir = await mkdtemp(join(tmpdir(), "ark-shot-"));
    try {
      const file = join(dir, "page.png");
      const r = await run(["screenshot", file]);
      if (!r.ok) throw new Error(r.error ?? "The screenshot failed.");
      return { data: (await readFile(file)).toString("base64"), mimeType: "image/png" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const bridge = createBridge({ run, screenshot });
  const server = new Server({ name: "ark-browser-bridge", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: BRIDGE_TOOLS as any }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const out = await bridge.call(request.params.name, request.params.arguments);
    return {
      content: [{ type: "text" as const, text: out.text }, ...(out.image ? [{ type: "image" as const, data: out.image.data, mimeType: out.image.mimeType }] : [])],
      ...(out.isError ? { isError: true } : {}),
    };
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.race([run(["close"]), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  process.stdin.on("end", () => void stop());
  return server.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) await startBridge(process.argv.slice(2));
