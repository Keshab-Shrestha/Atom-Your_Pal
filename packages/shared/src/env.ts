/** ADR-105: ATOM_<x> is the name; ZENO_<x> is the old name, still read when ATOM_<x> is not set. */
const NAME_PREFIX = "ATOM_";
const LEGACY_PREFIX = "ZENO_";

/** Every environment variable ATOM reads in TypeScript, by its ATOM_ name. The single list of names that have a ZENO_ fallback. */
export const ENV_NAMES = [
  "ATOM_API_PORT", "ATOM_APPS", "ATOM_AUDIO_INPUT_DEVICE", "ATOM_AUDIO_SAMPLE_RATE", "ATOM_CALENDAR", "ATOM_CALENDAR_HELPER",
  "ATOM_CLAUDE_PATH", "ATOM_CODEX_PATH", "ATOM_COMPUTER", "ATOM_EPISODES", "ATOM_FRONT_WINDOW", "ATOM_GEMINI_PATH",
  "ATOM_HELPERS_FILE", "ATOM_HOME", "ATOM_ISLAND_SETTINGS", "ATOM_LAYA", "ATOM_LAYA_SERVER", "ATOM_LIVE_TESTS",
  "ATOM_LLM_MODEL", "ATOM_LLM_PROVIDER", "ATOM_LLM_TIMEOUT_MS", "ATOM_LOG_FILE", "ATOM_LOG_LEVEL", "ATOM_MEDIA",
  "ATOM_MEMORY", "ATOM_MEMORY_FILE", "ATOM_NOTE_QUIET_MS", "ATOM_NOTES", "ATOM_OLLAMA_PATH", "ATOM_PAPERCLIP_COMPANY", "ATOM_PAPERCLIP_URL",
  "ATOM_PREWARM", "ATOM_SESSION_IDLE_MS", "ATOM_SHORTCUTS", "ATOM_STT_LANGUAGE", "ATOM_STT_MODEL", "ATOM_STT_VOCABULARY", "ATOM_TELEGRAM_BOT_TOKEN",
  "ATOM_TELEGRAM_CHAT_ID", "ATOM_THINKING", "ATOM_TTS_DTYPE", "ATOM_TTS_VOICE", "ATOM_VOICE_ONLY", "ATOM_WEATHER", "ATOM_WEB",
] as const;

export type EnvSource = Record<string, string | undefined>;

const warned = new Set<string>();

/** Logs the NAME of a legacy variable, once. Never the value. */
function warnLegacy(legacyName: string): void {
  if (warned.has(legacyName)) return;
  warned.add(legacyName);
  process.stderr.write(`${JSON.stringify({ level: "warn", event: "env.legacy_name", name: legacyName, use: legacyName.replace(LEGACY_PREFIX, NAME_PREFIX) })}\n`);
}

/** For tests: forget which names were already warned about. */
export function resetLegacyEnvWarnings(): void {
  warned.clear();
}

/** The value of `ATOM_<x>`, or else of `ZENO_<x>` (with a one-time warning naming it). Empty counts as unset. */
export function readEnv(env: EnvSource, name: string, warn: (legacyName: string) => void = warnLegacy): string | undefined {
  const value = env[name];
  if (value) return value;
  if (!name.startsWith(NAME_PREFIX)) return value;
  const legacyName = LEGACY_PREFIX + name.slice(NAME_PREFIX.length);
  const old = env[legacyName];
  if (!old) return value;
  warn(legacyName);
  return old;
}
