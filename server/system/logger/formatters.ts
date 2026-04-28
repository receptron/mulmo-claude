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

// Levels for which the colour wraps the entire log line, not just the
// level word. The intent is that a `tail -f` reader can spot warnings
// and errors without parsing — the whole row glows red / yellow.
// Info / debug stay quiet so a chatty server doesn't fill the terminal
// with cyan or grey.
const WHOLE_LINE_COLOR: ReadonlySet<LogLevel> = new Set(["error", "warn"]);

export const formatText: Formatter = (record: LogRecord): string => {
  return formatTextLine(record, false);
};

/**
 * Same shape as {@link formatText} but wraps the output in ANSI colour
 * escapes per level. Console sinks select this variant only when
 * stdout/stderr is a real TTY (or `FORCE_COLOR` is set) and `NO_COLOR`
 * is unset — file sinks and CI logs always get the plain
 * {@link formatText}.
 *
 * - `error` / `warn`: the whole line is wrapped (bold red / bold yellow)
 *   so the row stands out at a glance.
 * - `info` / `debug`: only the level word is coloured, keeping the
 *   chatty levels visually quiet.
 */
export const formatTextColor: Formatter = (record: LogRecord): string => {
  return formatTextLine(record, true);
};

function formatTextLine(record: LogRecord, color: boolean): string {
  const levelText = record.level.toUpperCase().padEnd(5);
  const colorCode = LEVEL_COLOR[record.level];
  if (color && WHOLE_LINE_COLOR.has(record.level)) {
    // Whole-row wrap. Avoid double-wrapping the level slot — one
    // colour code at the start + reset at the end is enough.
    return `${colorCode}${record.time} ${levelText} [${record.prefix}] ${record.message}${formatData(record.data)}${ANSI_RESET}`;
  }
  const level = color ? `${colorCode}${levelText}${ANSI_RESET}` : levelText;
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
