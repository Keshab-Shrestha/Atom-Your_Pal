const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  llm: {
    apiKey: string;
    model: string;
    timeoutMs: number;
  };
  audio: {
    inputDevice: string;
    sampleRate: number;
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

  const logLevel = read("ZENO_LOG_LEVEL", "info");
  if (!LOG_LEVELS.includes(logLevel as LogLevel)) {
    problems.push(`ZENO_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got "${logLevel}"`);
  }

  const config: Config = {
    llm: {
      apiKey: read("ANTHROPIC_API_KEY"),
      model: read("ZENO_LLM_MODEL", "claude-sonnet-5"),
      timeoutMs: positiveInt("ZENO_LLM_TIMEOUT_MS", 30_000),
    },
    audio: {
      inputDevice: read("ZENO_AUDIO_INPUT_DEVICE", ":0"),
      sampleRate: positiveInt("ZENO_AUDIO_SAMPLE_RATE", 16_000),
    },
    log: {
      level: logLevel as LogLevel,
    },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
