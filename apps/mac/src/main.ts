// ATOM on the Mac. Two interfaces over the same voice loop:
//   pnpm start                    terminal: Space to talk (terminal.ts)
//   node apps/mac/src/main.ts --island   driven by ATOM Island over stdin / stdout (island.ts)

import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { GatewayError } from "@atom/llm-gateway";
import { ConfigError, createLogger, loadConfig, migrateLegacyLog, readEnv, readProviderKeys, type Config } from "@atom/shared";
import { encodeEvent, type ErrorStage } from "./island-protocol.ts";
import { runIsland } from "./island.ts";
import { acquireInstanceLock } from "./instance-lock.ts";
import { readSavedChoice, settingsPath } from "./model-settings.ts";
import { createRuntime, describe, withLogging } from "./runtime.ts";
import { runTerminal } from "./terminal.ts";

const island = process.argv.includes("--island");

/** Exit code for a configuration error: the island shows it and does not restart (docs/island-protocol.md). */
const EXIT_CONFIG = 78;
/** ADR-108: the longest the app waits at quit to write the notes of chats that are still quiet. */
const NOTE_FLUSH_QUIT_MS = 10_000;

if (island) {
  // stdout carries only protocol events: send any stray console output (ours or a library's) to stderr.
  console.log = console.info = console.debug = console.error;
}

/** Island mode: report a fatal error as an event, then exit once it has been written. */
function islandFatal(stage: ErrorStage, message: string, code: number): void {
  process.stdout.write(encodeEvent({ type: "error", stage, message }), () => process.exit(code));
  setTimeout(() => process.exit(code), 500).unref(); // in case the island is no longer reading
}

// The model chosen in ATOM Island (config/island.json) overrides ATOM_LLM_PROVIDER / ATOM_LLM_MODEL in
// both modes. Keys of every provider are kept so the island can switch; they never leave this process.
const keys = readProviderKeys();
const savedPath = settingsPath();
const saved = readSavedChoice(savedPath, keys);

function readConfig(): Config | null {
  try {
    return loadConfig(process.env, { llm: saved.choice });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    if (island) islandFatal("config", error.message, EXIT_CONFIG);
    else {
      console.error(error.message);
      process.exit(1);
    }
    return null;
  }
}

const config = readConfig();
if (config) start(config);

function start(config: Config) {
  migrateLegacyLog(config.log.file, "logs/zeno.log"); // ADR-105: once; the Swift side still writes logs/zeno.log (TODO in the Swift step)
  const log = createLogger({ level: config.log.level, file: config.log.file });
  log.info("app.start", {
    mode: island ? "island" : "terminal",
    provider: config.llm.provider,
    model: config.llm.model,
    voice: config.tts.voice,
    microphone: config.audio.inputDevice,
    settings: saved.choice ? savedPath : undefined,
  });
  if (saved.warning) {
    log.warn("settings.ignored", { message: saved.warning });
    console.error(saved.warning); // stderr in both modes: stdout is reserved for protocol events in island mode
  }

  // Last line of defence: an unexpected bug is logged and explained instead of a bare stack trace.
  const crash = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log.error("app.crash", { message, stack: error instanceof Error ? error.stack : undefined });
    const text = `ATOM stopped because of an unexpected error: ${message}. Details are in ${config.log.file}.`;
    if (island) islandFatal("runtime", text, 1);
    else {
      console.error(text);
      process.exit(1);
    }
  };
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);

  // One runtime per data folder: a second one would run startup recovery and fail the live jobs of the first.
  const helpersFile = readEnv(process.env, "ATOM_HELPERS_FILE") ?? "data/helpers.db";
  if (helpersFile !== ":memory:") {
    const lock = acquireInstanceLock(join(dirname(resolve(helpersFile)), ".atom.lock"));
    if (!lock.ok) {
      const text = `ATOM already runs on this data folder (pid ${lock.pid}).`;
      log.warn("app.refused", { pid: lock.pid });
      if (island) islandFatal("config", text, EXIT_CONFIG); // exit 78: the island shows it and does not restart
      else {
        console.error(text);
        process.exit(1);
      }
      return;
    }
    process.on("exit", lock.release);
    for (const signal of ["SIGINT", "SIGTERM"] as const) if (!island || signal === "SIGINT") process.on(signal, () => process.exit(signal === "SIGINT" ? 130 : 143));
  }

  const runtime = createRuntime(config, log, { keys, settingsPath: savedPath });
  // Give the microphone and audio player a moment to release, and pending output to flush, before exiting.
  const exit = () => {
    // ADR-108: notes that wait for a quiet chat are written now, best effort, for at most NOTE_FLUSH_QUIT_MS.
    const wait = new Promise<void>((resolve) => setTimeout(resolve, NOTE_FLUSH_QUIT_MS).unref());
    void Promise.race([runtime.flushNotes().catch(() => undefined), wait]).then(() => {
      runtime.close(); // stops helper jobs and their claude programs
      setTimeout(() => process.stdout.write("", () => process.exit(0)), 100);
    });
  };

  if (!island) {
    runTerminal(runtime, exit);
    return;
  }

  const session = runIsland({
    input: process.stdin,
    write: (line) => process.stdout.write(line),
    record: runtime.record,
    stt: runtime.stt,
    core: runtime.core,
    tts: runtime.tts,
    info: { provider: config.llm.provider, model: config.llm.model, microphone: config.audio.inputDevice, telegram: Boolean(runtime.telegram), computer: runtime.computerOn },
    ...(runtime.telegram ? { telegram: runtime.telegram } : {}),
    ...(runtime.api ? { api: runtime.api } : {}),
    settings: runtime.settings,
    computer: runtime.computer,
    taskActivity: runtime.taskActivity,
    chatWork: runtime.chatWork,
    ...(runtime.foreground ? { foreground: runtime.foreground } : {}),
    ...(runtime.islandMemory ? { memory: runtime.islandMemory } : {}),
    ...(runtime.islandBrain ? { brain: runtime.islandBrain } : {}),
    skillFiles: runtime.islandSkillFiles,
    slashCommands: runtime.islandSlashCommands,
    ...(runtime.islandChats ? { chats: runtime.islandChats } : {}),
    chatTurns: runtime.chatTurns,
    ...(runtime.islandProjects ? { projects: runtime.islandProjects } : {}),
    ...(runtime.islandWorkspace ? { workspace: runtime.islandWorkspace } : {}),
    ...(runtime.everything ? { everything: runtime.everything } : {}),
    ...(runtime.islandSuggestions ? { suggestions: runtime.islandSuggestions } : {}),
    ...(runtime.islandBrief ? { dailyBrief: runtime.islandBrief } : {}),
    ...(runtime.islandTextEdit ? { textEdit: runtime.islandTextEdit } : {}),
    ...(runtime.islandAttachments ? { attachments: runtime.islandAttachments } : {}),
    ...(runtime.islandGit ? { git: runtime.islandGit } : {}),
    ...(runtime.islandHelpers ? { helpers: runtime.islandHelpers } : {}),
    onTimer: runtime.onTimer,
    onGoalLine: runtime.onGoalLine,
    capabilities: runtime.capabilities,
    onPlanUsage: runtime.onPlanUsage,
    screen: runtime.screen,
    chime: () =>
      new Promise<void>((resolve) => {
        execFile("/usr/bin/afplay", ["/System/Library/Sounds/Glass.aiff"], { timeout: 3000 }, () => resolve());
      }),
    micName: runtime.micName,
    describe,
    errorDetails: (error) => (error instanceof GatewayError ? { kind: error.kind, retryable: error.retryable } : {}),
    wrapEvents: (events) => withLogging(log, runtime.micName, events),
    log,
    onQuit: exit,
  });
  process.on("SIGTERM", () => session.quit());
  // The island has gone away (broken pipe): nobody is listening, so stop.
  process.stdout.on("error", () => session.quit());
  // Printed last: once this appears, the runtime is set up and handles SIGTERM cleanly.
  console.error(`ATOM runtime (island mode): ${config.llm.provider} / ${config.llm.model}, microphone ${config.audio.inputDevice}`);
}
