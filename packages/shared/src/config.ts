import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { readEnv } from "./env.ts";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Claude on the user's own Claude plan (no API key; the signed-in `claude` program does the work). */
export const CLAUDE_PLAN = "claude-plan";

/** ADR-093: Codex on the user's ChatGPT plan, and the Gemini CLI on the user's Google sign-in. */
export const CODEX = "codex";
export const GEMINI_CLI = "gemini-cli";

/**
 * The LLM providers: display name, where its "key" comes from (the path of the signed-in program: not a secret), the
 * default model, and the models offered in ATOM Island's settings (id → display name). ADR-092: no API keys. ADR-093:
 * the subscription tools found on this Mac; Claude Code is the default. Codex and the Gemini CLI answer in chat only:
 * ATOM's tools and the team stay on Claude.
 */
export const PROVIDERS = {
  "claude-plan": {
    // Its "key" is the path of the `claude` program (ATOM_CLAUDE_PATH, or found automatically), not a secret.
    name: "Claude (my plan)",
    keyVar: "ATOM_CLAUDE_PATH",
    defaultModel: "claude-sonnet-5-5",
    models: [
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
  },
  codex: {
    name: "Codex (my ChatGPT plan)",
    keyVar: "ATOM_CODEX_PATH",
    defaultModel: "codex-default",
    // ADR-097: a known list (Codex gives no list to other programs), plus a custom model id in Settings.
    models: [
      { id: "codex-default", name: "Codex's own model" },
      { id: "gpt-6-luna", name: "GPT-6 Luna" },
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
      { id: "gpt-5.5", name: "GPT-5.5" },
    ],
  },
  "gemini-cli": {
    name: "Gemini CLI (my Google sign-in)",
    keyVar: "ATOM_GEMINI_PATH",
    defaultModel: "gemini-default",
    models: [
      { id: "gemini-default", name: "Gemini CLI's own model" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
} as const;

/** ADR-092: providers ATOM had before; a setting that still names one runs on the Claude plan instead. */
export const RETIRED_PROVIDERS = ["claude", "gemini"] as const;
export type LlmProvider = keyof typeof PROVIDERS;

type Env = Record<string, string | undefined>;

/**
 * The signed-in `claude` program that "Claude (my plan)" runs. ATOM_CLAUDE_PATH wins and is never second-guessed:
 * if it is wrong the answer is "not found", not some other copy. Otherwise the usual install places, then PATH.
 */
export function findClaudeProgram(
  env: Env = process.env,
  exists: (path: string) => boolean = (path) => existsSync(path),
  home: string = homedir(),
): string | undefined {
  const explicit = readEnv(env, "ATOM_CLAUDE_PATH")?.trim();
  if (explicit) return exists(explicit) ? explicit : undefined;
  const places = [`${home}/.local/bin/claude`, "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  for (const dir of (env.PATH ?? "").split(":").filter(Boolean)) places.push(`${dir}/claude`);
  return places.find(exists);
}

/**
 * ADR-093: a signed-in AI program by name: its `ATOM_*_PATH` first (never second-guessed), then the usual places and
 * PATH, then copies bundled in editor extensions (the newest first), as Codex ships inside the ChatGPT extension.
 */
export function findProgram(
  name: string,
  explicitVar: string,
  env: Env = process.env,
  exists: (path: string) => boolean = (path) => existsSync(path),
  home: string = homedir(),
  list: (dir: string) => string[] = (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
): string | undefined {
  const explicit = readEnv(env, explicitVar)?.trim();
  if (explicit) return exists(explicit) ? explicit : undefined;
  const places = [`${home}/.local/bin/${name}`, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`];
  for (const dir of (env.PATH ?? "").split(":").filter(Boolean)) places.push(`${dir}/${name}`);
  for (const editor of [`${home}/.vscode/extensions`, `${home}/.cursor/extensions`]) {
    const bundled = list(editor)
      .filter((d) => d.startsWith("openai.chatgpt-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const d of bundled) places.push(`${editor}/${d}/bin/macos-aarch64/${name}`, `${editor}/${d}/bin/macos-x86_64/${name}`);
  }
  // ADR-098 item 7: the ChatGPT app ships Codex too.
  if (name === "codex") places.push("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex");
  return places.find(exists);
}

export const findCodexProgram = (env: Env = process.env) => findProgram("codex", "ATOM_CODEX_PATH", env);
export const findGeminiProgram = (env: Env = process.env) => findProgram("gemini", "ATOM_GEMINI_PATH", env);

export const LLM_PROVIDER_IDS = Object.keys(PROVIDERS) as LlmProvider[];

export function isLlmProvider(value: string): value is LlmProvider {
  return Object.hasOwn(PROVIDERS, value);
}

/** The API key of every provider that has one in the environment. Secrets: never log or send these. */
export type ProviderKeys = Partial<Record<LlmProvider, string>>;

export function readProviderKeys(
  env: Env = process.env,
  findClaude: (env: Env) => string | undefined = findClaudeProgram,
  findOthers: { codex?: (env: Env) => string | undefined; gemini?: (env: Env) => string | undefined } = { codex: findCodexProgram, gemini: findGeminiProgram },
): ProviderKeys {
  const keys: ProviderKeys = {};
  // No keys: each provider is available when its signed-in program is. Its "key" is that program's path.
  const found = findClaude(env);
  if (found) keys[CLAUDE_PLAN] = found;
  const codex = findOthers.codex?.(env);
  if (codex) keys[CODEX] = codex;
  const gemini = findOthers.gemini?.(env);
  if (gemini) keys[GEMINI_CLI] = gemini;
  return keys;
}

/** A provider and model to use instead of ATOM_LLM_PROVIDER / ATOM_LLM_MODEL (e.g. saved by ATOM Island). */
export interface LlmChoice {
  provider: LlmProvider;
  model: string;
}

export interface LoadConfigOptions {
  /** Overrides ATOM_LLM_PROVIDER / ATOM_LLM_MODEL; then this provider's key is the one required. */
  llm?: LlmChoice;
}

const TTS_DTYPES = ["q8", "fp32", "fp16", "q4", "q4f16"] as const;
export type TtsDtype = (typeof TTS_DTYPES)[number];

export interface Config {
  llm: {
    provider: LlmProvider;
    apiKey: string;
    model: string;
    timeoutMs: number;
  };
  audio: {
    inputDevice: string;
    sampleRate: number;
  };
  stt: {
    modelPath: string;
    language: string;
    /** Words Whisper should expect (names, places, jargon); passed as its initial prompt. */
    vocabulary: string;
  };
  tts: {
    voice: string;
    dtype: TtsDtype;
  };
  log: {
    level: LogLevel;
    file: string;
  };
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}


/**
 * Reads ATOM configuration from environment variables.
 * Collects every problem and throws one ConfigError, so all issues are reported at once.
 * Values of secrets are never included in error messages.
 */
export function loadConfig(env: Env = process.env, options: LoadConfigOptions = {}): Config {
  const problems: string[] = [];

  const read = (name: string, fallback?: string): string => {
    const value = readEnv(env, name)?.trim();
    if (value) return value;
    if (fallback === undefined) problems.push(`${name} is required (set it in .env)`);
    return fallback ?? "";
  };

  const positiveInt = (name: string, fallback: number): number => {
    const raw = read(name, String(fallback));
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      problems.push(`${name} must be a positive integer, got "${raw}"`);
    }
    return value;
  };

  const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const value = read(name, fallback);
    if (!allowed.includes(value as T)) {
      problems.push(`${name} must be one of ${allowed.join(", ")}, got "${value}"`);
      return fallback;
    }
    return value as T;
  };

  // ADR-092: a provider ATOM no longer has ("claude", "gemini") runs on the plan; its model too, unless it is Claude's.
  const named = readEnv(env, "ATOM_LLM_PROVIDER")?.trim();
  const retired = (RETIRED_PROVIDERS as readonly string[]).includes(named ?? "");
  const envProvider = retired ? CLAUDE_PLAN : oneOf("ATOM_LLM_PROVIDER", LLM_PROVIDER_IDS, CLAUDE_PLAN);
  const provider = options.llm?.provider ?? envProvider;
  const { defaultModel, models } = PROVIDERS[provider];
  const asked = options.llm?.model ?? read("ATOM_LLM_MODEL", defaultModel);
  // A model that is not this provider's (a Gemini model left in .env, say) gives way to its default.
  const ownModel = provider === CLAUDE_PLAN ? asked.startsWith("claude-") : (models as readonly { id: string }[]).some((m) => m.id === asked);
  const model = ownModel ? asked : defaultModel;

  const config: Config = {
    llm: {
      provider,
      // No key: the signed-in program's path (Claude Code, Codex or the Gemini CLI).
      apiKey: (provider === CODEX ? findCodexProgram(env) : provider === GEMINI_CLI ? findGeminiProgram(env) : findClaudeProgram(env)) ?? "",
      model,
      timeoutMs: positiveInt("ATOM_LLM_TIMEOUT_MS", 30_000),
    },
    audio: {
      inputDevice: read("ATOM_AUDIO_INPUT_DEVICE", ":default"),
      sampleRate: positiveInt("ATOM_AUDIO_SAMPLE_RATE", 16_000),
    },
    stt: {
      modelPath: read("ATOM_STT_MODEL", "models/ggml-small.en.bin"),
      language: read("ATOM_STT_LANGUAGE", "en"),
      vocabulary: read("ATOM_STT_VOCABULARY", "ATOM"),
    },
    tts: {
      voice: read("ATOM_TTS_VOICE", "af_heart"),
      dtype: oneOf("ATOM_TTS_DTYPE", TTS_DTYPES, "fp32"), // fp32: ~1.6x faster than q8 on Apple silicon (ADR-065)
    },
    log: {
      level: oneOf("ATOM_LOG_LEVEL", LOG_LEVELS, "info"),
      file: read("ATOM_LOG_FILE", "logs/zeno.log"),
    },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
