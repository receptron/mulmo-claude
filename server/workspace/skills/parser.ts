// Pure SKILL.md parser. Given the raw file content, return the
// `description` (from YAML frontmatter) + body, plus optional
// `schedule` and `roleId` for auto-scheduling (#357 Phase 2).
//
// Minimal YAML: we only care about a few keys, so rather than
// pulling in a YAML parser we do line-by-line extraction.

import { TIME_UNIT_MS, ONE_SECOND_MS } from "../../utils/time.js";
import { LEADING_BLANK_LINES_PATTERN } from "../../utils/regex.js";
import { parseFrontmatter } from "../../utils/markdown/frontmatter.js";
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

/**
 * Parse schedule value from frontmatter.
 * Supported formats:
 *   "daily HH:MM"      → { type: "daily", time: "HH:MM" }
 *   "interval 30m"     → { type: "interval", intervalMs: 1800000 }
 *   "interval 2h"      → { type: "interval", intervalMs: 7200000 }
 *   "interval 300s"    → { type: "interval", intervalMs: 300000 }
 */
// Minimum interval to prevent accidental runaway scheduling.
const MIN_INTERVAL_MS = 10 * ONE_SECOND_MS;

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

/** Type guard — coerce the parsed-meta value at `key` into a
 *  string, mirroring the legacy `parseScalar` semantics so this
 *  refactor stays behaviour-neutral (codex review iter-1 #908):
 *
 *    - key absent          → null  (legacy bailed out the same way)
 *    - string value        → as-is, including the empty string
 *    - `null` value (from a bare `description:` line that js-yaml
 *      returns as `null`)  → empty string, matching parseScalar's
 *      "" return for an empty raw value
 *    - structured / number → null  (legacy didn't accept either —
 *      parseScalar's input is always a string slice)
 */
function metaString(meta: Record<string, unknown>, key: string): string | null {
  if (!(key in meta)) return null;
  const value = meta[key];
  if (typeof value === "string") return value;
  if (value === null) return "";
  return null;
}

/**
 * Parse a SKILL.md file. Returns null when:
 *  - the file has no frontmatter (no leading `---` fence)
 *  - the frontmatter is unterminated
 *  - there is no `description:` key
 *
 * An empty body is allowed (the skill may be just metadata for now).
 *
 * Built on the shared `parseFrontmatter` helper (#895 PR C) so the
 * envelope / scalar / quote handling matches the rest of the
 * codebase. Only `description`, `schedule`, and `roleId` are
 * extracted — extra keys in a SKILL.md file are silently ignored.
 */
export function parseSkillFrontmatter(raw: string): ParsedSkill | null {
  const parsed = parseFrontmatter(raw);
  if (!parsed.hasHeader) return null;

  const description = metaString(parsed.meta, "description");
  if (description === null) return null;

  const scheduleRaw = metaString(parsed.meta, "schedule");
  const roleId = metaString(parsed.meta, "roleId");

  // Trim leading blank lines so the UI doesn't render an awkward
  // gap above the first heading. Pattern + ReDoS-safety rationale
  // lives in `server/utils/regex.ts`.
  const body = parsed.body.replace(LEADING_BLANK_LINES_PATTERN, "").trimEnd();

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
