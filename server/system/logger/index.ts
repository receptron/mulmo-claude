import type { LoggerConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import { createConsoleSink, createFileSink, createTelemetrySink } from "./sinks.js";
import type { LogLevel, LogRecord, Sink } from "./types.js";
import { LEVEL_PRIORITY } from "./types.js";

export type { LogLevel, LogRecord } from "./types.js";
export type { LoggerConfig } from "./config.js";
export { resolveConfig, DEFAULT_CONFIG } from "./config.js";

export interface Logger {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  info: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => void;
}

export function createLogger(config: LoggerConfig): Logger {
  const sinks: Sink[] = [];
  if (config.sinks.console.enabled) sinks.push(createConsoleSink(config.sinks.console));
  if (config.sinks.file.enabled) sinks.push(createFileSink(config.sinks.file));
  if (config.sinks.telemetry.enabled) sinks.push(createTelemetrySink(config.sinks.telemetry));

  function emit(level: LogLevel, prefix: string, message: string, data?: Record<string, unknown>): void {
    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      prefix,
      message,
      ...(data ? { data } : {}),
    };
    const recordPriority = LEVEL_PRIORITY[level];
    for (const sink of sinks) {
      if (recordPriority <= LEVEL_PRIORITY[sink.level]) {
        try {
          sink.write(record);
        } catch {
          // Per contract, sinks swallow their own errors; belt-and-suspenders here.
        }
      }
    }
  }

  return {
    error: (prefix, message, data) => emit("error", prefix, message, data),
    warn: (prefix, message, data) => emit("warn", prefix, message, data),
    info: (prefix, message, data) => emit("info", prefix, message, data),
    debug: (prefix, message, data) => emit("debug", prefix, message, data),
  };
}

// Default module-level logger resolved from process.env.
export const log: Logger = createLogger(resolveConfig(process.env));
