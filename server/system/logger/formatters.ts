import type { Formatter, LogRecord } from "./types.js";

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

export const formatText: Formatter = (record: LogRecord): string => {
  const level = record.level.toUpperCase().padEnd(5);
  return `${record.time} ${level} [${record.prefix}] ${record.message}${formatData(record.data)}`;
};

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
