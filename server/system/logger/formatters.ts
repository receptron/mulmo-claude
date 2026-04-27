import type { Formatter, LogLevel, LogRecord } from "./types.js";

function formatData(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const parts: string[] = [];
  for (const [key, val] of Object.entries(data)) {
    parts.push(`${key}=${stringifyScalar(val)}`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function stringifyScalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ANSI escape codes — small enough to inline rather than pull a dep.
// `1m` adds bold so the level word reads at a glance even on busy
// terminals. The level field stays width-padded with `.padEnd(5)` so
// the colour escape doesn't push subsequent columns out of alignment.
const ANSI_RESET = "\x1b[0m";
const LEVEL_COLOR: Record<LogLevel, string> = {
  error: "\x1b[1;31m", // bold red
  warn: "\x1b[1;33m", // bold yellow
  info: "\x1b[1;36m", // bold cyan
  debug: "\x1b[2;37m", // dim white (close to gray)
};

export const formatText: Formatter = (record: LogRecord): string => {
  return formatTextLine(record, false);
};

/**
 * Same shape as {@link formatText} but wraps the level word in an
 * ANSI colour escape. Console sinks select this variant only when
 * stdout/stderr is a real TTY and `NO_COLOR` is unset — file sinks
 * and CI logs always get the plain `formatText`.
 */
export const formatTextColor: Formatter = (record: LogRecord): string => {
  return formatTextLine(record, true);
};

function formatTextLine(record: LogRecord, color: boolean): string {
  const levelText = record.level.toUpperCase().padEnd(5);
  const level = color ? `${LEVEL_COLOR[record.level]}${levelText}${ANSI_RESET}` : levelText;
  return `${record.time} ${level} [${record.prefix}] ${record.message}${formatData(record.data)}`;
}

export const formatJson: Formatter = (record: LogRecord): string => {
  const payload: Record<string, unknown> = {
    time: record.time,
    level: record.level,
    prefix: record.prefix,
    message: record.message,
  };
  if (record.data) payload.data = record.data;
  return JSON.stringify(payload);
};
