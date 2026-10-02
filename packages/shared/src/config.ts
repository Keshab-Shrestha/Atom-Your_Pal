const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Supported LLM providers: display name, the env variable holding the key, the default model, and the
 * models offered in ZENO Island's settings (id → display name), newest first.
 */
export const PROVIDERS = {
  claude: {
    name: "Claude",
    keyVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-5",
    models: [
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
  },
  gemini: {
    name: "Gemini",
    keyVar: "GEMINI_API_KEY",
    defaultModel: "gemini-3.6-flash",
    models: [
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ],
  },
} as const;
export type LlmProvider = keyof typeof PROVIDERS;

type Env = Record<string, string | undefined>;

export const LLM_PROVIDER_IDS = Object.keys(PROVIDERS) as LlmProvider[];

export function isLlmProvider(value: string): value is LlmProvider {
  return Object.hasOwn(PROVIDERS, value);
}

/** The API key of every provider that has one in the environment. Secrets: never log or send these. */
export type ProviderKeys = Partial<Record<LlmProvider, string>>;

export function readProviderKeys(env: Env = process.env): ProviderKeys {
  const keys: ProviderKeys = {};
  for (const id of LLM_PROVIDER_IDS) {
    const value = env[PROVIDERS[id].keyVar]?.trim();
    if (value) keys[id] = value;
  }
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

  const envProvider = oneOf("ZENO_LLM_PROVIDER", LLM_PROVIDER_IDS, "claude");
  const provider = options.llm?.provider ?? envProvider;
  const { keyVar, defaultModel } = PROVIDERS[provider];
  const model = options.llm?.model ?? read("ZENO_LLM_MODEL", defaultModel);

  const config: Config = {
    llm: {
      provider,
      // Only the selected provider's key is required.
      apiKey: read(keyVar),
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
      dtype: oneOf("ZENO_TTS_DTYPE", TTS_DTYPES, "q8"),
    },
    log: {
      level: oneOf("ZENO_LOG_LEVEL", LOG_LEVELS, "info"),
      file: read("ZENO_LOG_FILE", "logs/zeno.log"),
    },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
