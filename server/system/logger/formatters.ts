import type { Formatter, LogRecord } from "./types.js";

function formatData(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    parts.push(`${k}=${stringifyScalar(v)}`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function stringifyScalar(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") {
    return /\s/.test(v) ? JSON.stringify(v) : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const formatText: Formatter = (record: LogRecord): string => {
  const level = record.level.toUpperCase().padEnd(5);
  return `${record.ts} ${level} [${record.prefix}] ${record.message}${formatData(record.data)}`;
};

export const formatJson: Formatter = (record: LogRecord): string => {
  const payload: Record<string, unknown> = {
    ts: record.ts,
    level: record.level,
    prefix: record.prefix,
    message: record.message,
  };
  if (record.data) payload.data = record.data;
  return JSON.stringify(payload);
};
