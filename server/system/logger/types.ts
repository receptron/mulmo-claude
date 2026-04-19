export type LogLevel = "error" | "warn" | "info" | "debug";

export type LogFormat = "text" | "json";

// Numeric priorities for level filtering. Lower = more important.
export const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export interface LogRecord {
  ts: string;
  level: LogLevel;
  prefix: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface Sink {
  name: string;
  level: LogLevel;
  write(record: LogRecord): void;
  // Drains any pending async I/O. Tests call this; production can ignore.
  flush?(): Promise<void>;
}

export type Formatter = (record: LogRecord) => string;
