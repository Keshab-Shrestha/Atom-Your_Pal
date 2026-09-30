const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Supported LLM providers, with the env variable holding each one's key and its default model. */
const PROVIDERS = {
  claude: { keyVar: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-5" },
  gemini: { keyVar: "GEMINI_API_KEY", defaultModel: "gemini-3.5-flash" },
} as const;
export type LlmProvider = keyof typeof PROVIDERS;

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
  };
  tts: {
    voice: string;
    dtype: TtsDtype;
  };
  log: {
    level: LogLevel;
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

type Env = Record<string, string | undefined>;

/**
 * Reads ZENO configuration from environment variables.
 * Collects every problem and throws one ConfigError, so all issues are reported at once.
 * Values of secrets are never included in error messages.
 */
export function loadConfig(env: Env = process.env): Config {
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

  const provider = oneOf("ZENO_LLM_PROVIDER", Object.keys(PROVIDERS) as LlmProvider[], "claude");
  const { keyVar, defaultModel } = PROVIDERS[provider];

  const config: Config = {
    llm: {
      provider,
      // Only the selected provider's key is required.
      apiKey: read(keyVar),
      model: read("ZENO_LLM_MODEL", defaultModel),
      timeoutMs: positiveInt("ZENO_LLM_TIMEOUT_MS", 30_000),
    },
    audio: {
      inputDevice: read("ZENO_AUDIO_INPUT_DEVICE", ":default"),
      sampleRate: positiveInt("ZENO_AUDIO_SAMPLE_RATE", 16_000),
    },
    stt: {
      modelPath: read("ZENO_STT_MODEL", "models/ggml-base.en.bin"),
      language: read("ZENO_STT_LANGUAGE", "en"),
    },
    tts: {
      voice: read("ZENO_TTS_VOICE", "af_heart"),
      dtype: oneOf("ZENO_TTS_DTYPE", TTS_DTYPES, "q8"),
    },
    log: {
      level: oneOf("ZENO_LOG_LEVEL", LOG_LEVELS, "info"),
    },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
