// Pure SKILL.md parser. Given the raw file content, return the
// `description` (from YAML frontmatter) + body, plus optional
// `schedule` and `roleId` for auto-scheduling (#357 Phase 2).
//
// Minimal YAML: we only care about a few keys, so rather than
// pulling in a YAML parser we do line-by-line extraction.

import { TIME_UNIT_MS } from "../../utils/time.js";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";

export interface SkillSchedule {
  /** "daily HH:MM" or "interval Ns/Nm/Nh" */
  raw: string;
  /** Parsed into task-manager-compatible shape */
  parsed: { type: typeof SCHEDULE_TYPES.daily; time: string } | { type: typeof SCHEDULE_TYPES.interval; intervalMs: number } | null;
}

export interface ParsedSkill {
  description: string;
  body: string;
  /** If present, this skill should be auto-scheduled */
  schedule?: SkillSchedule;
  /** Role to use when running the scheduled skill (default: "general") */
  roleId?: string;
}

// Match a YAML scalar value on a single line:
//   description: Enable CI for a repository
//   description: "Quoted with colons: inside"
// Leading/trailing whitespace trimmed. Quoted values have their
// outer quotes stripped but inner JSON-style escapes are NOT
// reversed — SKILL.md descriptions in the wild are plain text.
function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse schedule value from frontmatter.
 * Supported formats:
 *   "daily HH:MM"      → { type: "daily", time: "HH:MM" }
 *   "interval 30m"     → { type: "interval", intervalMs: 1800000 }
 *   "interval 2h"      → { type: "interval", intervalMs: 7200000 }
 *   "interval 300s"    → { type: "interval", intervalMs: 300000 }
 */
// Minimum interval to prevent accidental runaway scheduling.
const MIN_INTERVAL_MS = 10_000; // 10 seconds

function parseScheduleValue(raw: string): SkillSchedule["parsed"] {
  const trimmed = raw.trim();

  // daily HH:MM — validate range: HH 00-23, MM 00-59
  const dailyMatch = trimmed.match(/^daily\s+(\d{2}):(\d{2})$/);
  if (dailyMatch) {
    const hours = Number(dailyMatch[1]);
    const minutes = Number(dailyMatch[2]);
    if (hours > 23 || minutes > 59) return null;
    return {
      type: SCHEDULE_TYPES.daily,
      time: `${dailyMatch[1]}:${dailyMatch[2]}`,
    };
  }

  // interval Ns / Nm / Nh — must be >= MIN_INTERVAL_MS
  const intervalMatch = trimmed.match(/^interval\s+(\d+)([smh])$/);
  if (intervalMatch) {
    const value = Number(intervalMatch[1]);
    const unit = intervalMatch[2];
    const unitMs = TIME_UNIT_MS[unit];
    if (!unitMs) return null;
    const intervalMs = value * unitMs;
    if (intervalMs < MIN_INTERVAL_MS) return null;
    return { type: SCHEDULE_TYPES.interval, intervalMs };
  }

  return null;
}

/**
 * Parse a SKILL.md file. Returns null when:
 *  - the file has no frontmatter (no leading `---` fence)
 *  - the frontmatter is unterminated
 *  - there is no `description:` key
 *
 * An empty body is allowed (the skill may be just metadata for now).
 */
// Extract key-value pairs from YAML frontmatter lines. Returns a
// map of key → scalar value. Keeps parseSkillFrontmatter under the
// cognitive-complexity threshold.
function extractFrontmatterFields(lines: string[], startIdx: number, endIdx: number): Map<string, string> {
  const fields = new Map<string, string>();
  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = parseScalar(line.slice(colonIdx + 1));
    fields.set(key, value);
  }
  return fields;
}

export function parseSkillFrontmatter(raw: string): ParsedSkill | null {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") return null;

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return null;

  const fields = extractFrontmatterFields(lines, 1, closeIdx);
  const description = fields.get("description") ?? null;
  if (description === null) return null;

  const scheduleRaw = fields.get("schedule") ?? null;
  const roleId = fields.get("roleId") ?? null;

  // Body starts after the closing fence. Trim leading blank lines so
  // the UI doesn't render an awkward gap above the first heading.
  const body = lines
    .slice(closeIdx + 1)
    .join("\n")
    .replace(/^(?:\s*\n)+/, "")
    .trimEnd();

  const result: ParsedSkill = { description, body };
  if (scheduleRaw) {
    result.schedule = {
      raw: scheduleRaw,
      parsed: parseScheduleValue(scheduleRaw),
    };
  }
  if (roleId) result.roleId = roleId;
  return result;
}
