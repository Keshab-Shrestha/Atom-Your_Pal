/** ARK_<x> is the name (2026-11-01). The old names, ATOM_<x> (ADR-105) and ZENO_<x> before it, are still read when ARK_<x> is not set. */
const NAME_PREFIX = "ARK_";
const LEGACY_PREFIXES = ["ATOM_", "ZENO_"] as const;

/** Every environment variable ARK reads in TypeScript, by its ARK_ name. The single list of names that have an ATOM_ and ZENO_ fallback. */
export const ENV_NAMES = [
  "ARK_API_HOST", "ARK_API_PORT", "ARK_APPS", "ARK_AUDIO_INPUT_DEVICE", "ARK_AUDIO_SAMPLE_RATE", "ARK_BROWSER_HEADLESS", "ARK_BROWSER_PATH", "ARK_CALENDAR", "ARK_CALENDAR_HELPER",
  "ARK_CLAUDE_PATH", "ARK_CODEX_PATH", "ARK_COMPUTER", "ARK_EPISODES", "ARK_FRONT_WINDOW", "ARK_GEMINI_PATH",
  "ARK_HELPERS_FILE", "ARK_HOME", "ARK_ISLAND_SETTINGS", "ARK_LAYA", "ARK_LAYA_SERVER", "ARK_LIVE_TESTS",
  "ARK_LLM_MODEL", "ARK_LLM_PROVIDER", "ARK_LLM_TIMEOUT_MS", "ARK_LOG_FILE", "ARK_LOG_LEVEL", "ARK_MEDIA",
  "ARK_MEMORY", "ARK_MEMORY_FILE", "ARK_NOTE_QUIET_MS", "ARK_NOTES", "ARK_OLLAMA_PATH", "ARK_PAPERCLIP_COMPANY", "ARK_PAPERCLIP_URL",
  "ARK_PREWARM", "ARK_SESSION_IDLE_MS", "ARK_SHORTCUTS", "ARK_STT_LANGUAGE", "ARK_STT_MODEL", "ARK_STT_VOCABULARY", "ARK_TELEGRAM_BOT_TOKEN",
  "ARK_TELEGRAM_CHAT_ID", "ARK_TELEGRAM_USER_ID", "ARK_THINKING", "ARK_TTS_DTYPE", "ARK_TTS_VOICE", "ARK_VOICE_ONLY", "ARK_WEATHER", "ARK_WEB",
] as const;

export type EnvSource = Record<string, string | undefined>;

const warned = new Set<string>();

/** Logs the NAME of a legacy variable, once. Never the value. */
function warnLegacy(legacyName: string): void {
  if (warned.has(legacyName)) return;
  warned.add(legacyName);
  process.stderr.write(`${JSON.stringify({ level: "warn", event: "env.legacy_name", name: legacyName, use: NAME_PREFIX + legacyName.slice(legacyName.indexOf("_") + 1) })}\n`);
}

/** For tests: forget which names were already warned about. */
export function resetLegacyEnvWarnings(): void {
  warned.clear();
}

/** The value of `ARK_<x>`, or else of `ATOM_<x>`, or else of `ZENO_<x>` (with a one-time warning naming it). Empty counts as unset. */
export function readEnv(env: EnvSource, name: string, warn: (legacyName: string) => void = warnLegacy): string | undefined {
  const value = env[name];
  if (value) return value;
  if (!name.startsWith(NAME_PREFIX)) return value;
  for (const prefix of LEGACY_PREFIXES) {
    const legacyName = prefix + name.slice(NAME_PREFIX.length);
    const old = env[legacyName];
    if (!old) continue;
    warn(legacyName);
    return old;
  }
  return value;
}
