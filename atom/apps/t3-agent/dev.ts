import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, readProviderKeys } from "@atom/shared";
import { readSavedChoice, settingsPath } from "../mac/src/model-settings.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const backend = join(root, "atom");
const home = join(root, ".atom-t3");
const backendOnly = process.argv.includes("--backend-only");
const setupOnly = process.argv.includes("--setup-only");
const desktop = process.argv.includes("--desktop");
const envFile = join(backend, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const saved = readSavedChoice(join(backend, settingsPath()), readProviderKeys());
const config = loadConfig(process.env, { llm: saved.choice });

if (!backendOnly) {
  const file = join(home, "userdata/settings.json");
  const old = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
    : undefined;
  const settings = old ?? {
    defaultRuntimeMode: "approval-required",
    defaultModelSelection: {
      instanceId: "atom",
      model: `${config.llm.provider}:${config.llm.model}`,
    },
    providerInstances: {
      codex: { driver: "codex", enabled: false },
      claudeAgent: { driver: "claudeAgent", enabled: false },
    },
  };
  const instances = settings.providerInstances ?? {};
  if (typeof instances !== "object" || instances === null || Array.isArray(instances))
    throw new Error(
      "The isolated ATOM provider settings are invalid. Restore them before continuing.",
    );
  const providers = instances as Record<string, unknown>;
  const existing = providers.atom as
    | { driver?: string; config?: Record<string, unknown> }
    | undefined;
  if (existing && existing.driver !== "acpRegistry")
    throw new Error(
      "The provider ID 'atom' is already used by another driver. Rename it before running this launcher.",
    );
  providers.atom = {
    ...existing,
    driver: "acpRegistry",
    displayName: "ATOM",
    enabled: true,
    config: {
      ...existing?.config,
      source: "local",
      enabled: true,
      commandPath: process.execPath,
      commandArgs: [join(backend, "apps/t3-agent/stdio.ts")],
    },
  };
  settings.providerInstances = providers;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
  console.log("Configured ATOM in this checkout's isolated T3 home.");
}
if (setupOnly) process.exit(0);

const children = new Set<ChildProcess>();
let stopping = false;
const stop = (code: number) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
const launch = (args: string[], capture = false) => {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, T3CODE_HOME: home, T3CODE_DEV_SEED: "0" },
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });
  children.add(child);
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
  return child;
};
const daemon = launch(
  ["--disable-warning=ExperimentalWarning", join(backend, "apps/t3-agent/server.ts")],
  true,
);
const lines = createInterface({ input: daemon.stdout! });
let started = false;
lines.on("line", (line) => {
  console.log(line);
  if (
    !started &&
    !backendOnly &&
    line === "ATOM backend ready. T3 chat can connect through the ATOM provider."
  ) {
    started = true;
    launch([
      join(root, "scripts/dev-runner.ts"),
      desktop ? "dev:desktop" : "dev",
      "--home-dir",
      home,
      "--no-seed",
    ]);
  }
});
