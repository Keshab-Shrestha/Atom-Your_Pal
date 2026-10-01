import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LogLevel } from "./config.ts";

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type LogFields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  level: LogLevel;
  /** JSON Lines file to append to. */
  file: string;
  now?: () => Date;
  /** Override for tests. */
  write?: (line: string) => void;
}

/**
 * Structured log: one JSON object per line, for looking at what happened after the fact.
 * Callers log what happened (events, timings, error kinds), not what was said: SECURITY.md asks
 * for sensitive content to be minimized in logs, so transcripts and replies are never passed in.
 * Logging must never break ZENO, so write failures are reported once and then ignored.
 */
export function createLogger(options: LoggerOptions): Logger {
  const { level, file, now = () => new Date() } = options;
  let failed = false;
  const write =
    options.write ??
    ((line: string) => {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, line);
    });

  const log = (at: LogLevel) => (event: string, fields: LogFields = {}) => {
    if (ORDER[at] < ORDER[level]) return;
    try {
      write(`${JSON.stringify({ time: now().toISOString(), level: at, event, ...fields })}\n`);
    } catch (error) {
      if (!failed) {
        failed = true;
        console.error(`Logging disabled: cannot write ${file} (${error instanceof Error ? error.message : error})`);
      }
    }
  };
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
}
