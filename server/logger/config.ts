import path from "path";
import type { LogFormat, LogLevel } from "./types.js";
import { LEVEL_PRIORITY } from "./types.js";

export interface FileRotationConfig {
  kind: "daily";
  maxFiles: number;
}

export interface ConsoleSinkConfig {
  enabled: boolean;
  level: LogLevel;
  format: LogFormat;
}

export interface FileSinkConfig {
  enabled: boolean;
  level: LogLevel;
  format: LogFormat;
  dir: string;
  rotation: FileRotationConfig;
}

export interface TelemetrySinkConfig {
  enabled: boolean;
  level: LogLevel;
  format: LogFormat;
}

export interface LoggerConfig {
  sinks: {
    console: ConsoleSinkConfig;
    file: FileSinkConfig;
    telemetry: TelemetrySinkConfig;
  };
}

const DEFAULT_FILE_DIR = path.join("server", "logs");
const DEFAULT_MAX_FILES = 14;

export const DEFAULT_CONFIG: LoggerConfig = {
  sinks: {
    console: { enabled: true, level: "info", format: "text" },
    file: {
      enabled: true,
      level: "debug",
      format: "json",
      dir: DEFAULT_FILE_DIR,
      rotation: { kind: "daily", maxFiles: DEFAULT_MAX_FILES },
    },
    telemetry: { enabled: false, level: "error", format: "json" },
  },
};

function parseLevel(raw: string | undefined): LogLevel | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  return v in LEVEL_PRIORITY ? (v as LogLevel) : undefined;
}

function parseFormat(raw: string | undefined): LogFormat | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  return v === "text" || v === "json" ? v : undefined;
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export type Env = Partial<Record<string, string>>;

export function resolveConfig(env: Env): LoggerConfig {
  const coarseLevel = parseLevel(env.LOG_LEVEL);
  const consoleLevel = parseLevel(env.LOG_CONSOLE_LEVEL) ?? coarseLevel;
  const fileLevel = parseLevel(env.LOG_FILE_LEVEL) ?? coarseLevel;

  return {
    sinks: {
      console: {
        enabled:
          parseBool(env.LOG_CONSOLE_ENABLED) ??
          DEFAULT_CONFIG.sinks.console.enabled,
        level: consoleLevel ?? DEFAULT_CONFIG.sinks.console.level,
        format:
          parseFormat(env.LOG_CONSOLE_FORMAT) ??
          DEFAULT_CONFIG.sinks.console.format,
      },
      file: {
        enabled:
          parseBool(env.LOG_FILE_ENABLED) ?? DEFAULT_CONFIG.sinks.file.enabled,
        level: fileLevel ?? DEFAULT_CONFIG.sinks.file.level,
        format:
          parseFormat(env.LOG_FILE_FORMAT) ?? DEFAULT_CONFIG.sinks.file.format,
        dir: env.LOG_FILE_DIR ?? DEFAULT_CONFIG.sinks.file.dir,
        rotation: {
          kind: "daily",
          maxFiles:
            parsePositiveInt(env.LOG_FILE_MAX_FILES) ??
            DEFAULT_CONFIG.sinks.file.rotation.maxFiles,
        },
      },
      telemetry: {
        enabled:
          parseBool(env.LOG_TELEMETRY_ENABLED) ??
          DEFAULT_CONFIG.sinks.telemetry.enabled,
        level:
          parseLevel(env.LOG_TELEMETRY_LEVEL) ??
          DEFAULT_CONFIG.sinks.telemetry.level,
        format:
          parseFormat(env.LOG_TELEMETRY_FORMAT) ??
          DEFAULT_CONFIG.sinks.telemetry.format,
      },
    },
  };
}
