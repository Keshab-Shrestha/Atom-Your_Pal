import { existsSync } from "node:fs";
import { homedir } from "node:os";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Claude on the user's own Claude plan (no API key; the signed-in `claude` program does the work). */
export const CLAUDE_PLAN = "claude-plan";

/**
 * The LLM providers: display name, where its "key" comes from, the default model, and the models offered in ZENO
 * Island's settings (id → display name), newest first. ADR-092: ZENO runs on the user's own Claude plan only; the
 * gateway still takes any provider, so another can be added back behind it.
 */
export const PROVIDERS = {
  "claude-plan": {
    // Its "key" is the path of the `claude` program (ZENO_CLAUDE_PATH, or found automatically), not a secret.
    name: "Claude (my plan)",
    keyVar: "ZENO_CLAUDE_PATH",
    defaultModel: "claude-sonnet-5-5",
    models: [
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
  },
} as const;

/** ADR-092: providers ZENO had before; a setting that still names one runs on the Claude plan instead. */
export const RETIRED_PROVIDERS = ["claude", "gemini"] as const;
export type LlmProvider = keyof typeof PROVIDERS;

type Env = Record<string, string | undefined>;

/**
 * The signed-in `claude` program that "Claude (my plan)" runs. ZENO_CLAUDE_PATH wins and is never second-guessed:
 * if it is wrong the answer is "not found", not some other copy. Otherwise the usual install places, then PATH.
 */
export function findClaudeProgram(
  env: Env = process.env,
  exists: (path: string) => boolean = (path) => existsSync(path),
  home: string = homedir(),
): string | undefined {
  const explicit = env.ZENO_CLAUDE_PATH?.trim();
  if (explicit) return exists(explicit) ? explicit : undefined;
  const places = [`${home}/.local/bin/claude`, "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  for (const dir of (env.PATH ?? "").split(":").filter(Boolean)) places.push(`${dir}/claude`);
  return places.find(exists);
}

export const LLM_PROVIDER_IDS = Object.keys(PROVIDERS) as LlmProvider[];

export function isLlmProvider(value: string): value is LlmProvider {
  return Object.hasOwn(PROVIDERS, value);
}

/** The API key of every provider that has one in the environment. Secrets: never log or send these. */
export type ProviderKeys = Partial<Record<LlmProvider, string>>;

export function readProviderKeys(env: Env = process.env, findClaude: (env: Env) => string | undefined = findClaudeProgram): ProviderKeys {
  const keys: ProviderKeys = {};
  // No key: the plan is available when the signed-in `claude` program is. Its "key" is that program's path.
  const found = findClaude(env);
  if (found) keys[CLAUDE_PLAN] = found;
  return keys;
}

/** A provider and model to use instead of ZENO_LLM_PROVIDER / ZENO_LLM_MODEL (e.g. saved by ZENO Island). */
export interface LlmChoice {
  provider: LlmProvider;
  model: string;
}

export interface LoadConfigOptions {
  /** Overrides ZENO_LLM_PROVIDER / ZENO_LLM_MODEL; then this provider's key is the one required. */
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
 * Reads ZENO configuration from environment variables.
 * Collects every problem and throws one ConfigError, so all issues are reported at once.
 * Values of secrets are never included in error messages.
 */
export function loadConfig(env: Env = process.env, options: LoadConfigOptions = {}): Config {
  const problems: string[] = [];

  const read = (name: string, fallback?: string): string => {
    const value = env[name]?.trim();
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

  // ADR-092: a provider ZENO no longer has ("claude", "gemini") runs on the plan; its model too, unless it is Claude's.
  const named = env.ZENO_LLM_PROVIDER?.trim();
  const retired = (RETIRED_PROVIDERS as readonly string[]).includes(named ?? "");
  const envProvider = retired ? CLAUDE_PLAN : oneOf("ZENO_LLM_PROVIDER", LLM_PROVIDER_IDS, CLAUDE_PLAN);
  const provider = options.llm?.provider ?? envProvider;
  const { defaultModel } = PROVIDERS[provider];
  const asked = options.llm?.model ?? read("ZENO_LLM_MODEL", defaultModel);
  const model = asked.startsWith("claude-") ? asked : defaultModel;

  const config: Config = {
    llm: {
      provider,
      // No key: Claude on the user's plan uses the signed-in `claude` program.
      apiKey: findClaudeProgram(env) ?? "",
      model,
      timeoutMs: positiveInt("ZENO_LLM_TIMEOUT_MS", 30_000),
    },
    audio: {
      inputDevice: read("ZENO_AUDIO_INPUT_DEVICE", ":default"),
      sampleRate: positiveInt("ZENO_AUDIO_SAMPLE_RATE", 16_000),
    },
    stt: {
      modelPath: read("ZENO_STT_MODEL", "models/ggml-small.en.bin"),
      language: read("ZENO_STT_LANGUAGE", "en"),
      vocabulary: read("ZENO_STT_VOCABULARY", "ZENO"),
    },
    tts: {
      voice: read("ZENO_TTS_VOICE", "af_heart"),
      dtype: oneOf("ZENO_TTS_DTYPE", TTS_DTYPES, "fp32"), // fp32: ~1.6x faster than q8 on Apple silicon (ADR-065)
    },
    log: {
      level: oneOf("ZENO_LOG_LEVEL", LOG_LEVELS, "info"),
      file: read("ZENO_LOG_FILE", "logs/zeno.log"),
    },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
