import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSkillFrontmatter } from "../../server/workspace/skills/parser.ts";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";

describe("parseSkillFrontmatter — schedule", () => {
  it("parses daily HH:MM schedule", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Daily news\nschedule: daily 08:00\n---\n\nBody",
    );
    assert.ok(result);
    assert.deepEqual(result.schedule, {
      raw: "daily 08:00",
      parsed: { type: SCHEDULE_TYPES.daily, time: "08:00" },
    });
  });

  it("parses interval with minutes", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Check\nschedule: interval 30m\n---\n\nBody",
    );
    assert.ok(result);
    assert.deepEqual(result.schedule?.parsed, {
      type: SCHEDULE_TYPES.interval,
      intervalMs: 1_800_000,
    });
  });

  it("parses interval with hours", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Hourly\nschedule: interval 2h\n---\n\nBody",
    );
    assert.ok(result);
    assert.deepEqual(result.schedule?.parsed, {
      type: SCHEDULE_TYPES.interval,
      intervalMs: 7_200_000,
    });
  });

  it("parses interval with seconds", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Fast\nschedule: interval 300s\n---\n\nBody",
    );
    assert.ok(result);
    assert.deepEqual(result.schedule?.parsed, {
      type: SCHEDULE_TYPES.interval,
      intervalMs: 300_000,
    });
  });

  it("returns null parsed for unrecognized schedule format", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Unknown\nschedule: weekly Mon 09:00\n---\n\nBody",
    );
    assert.ok(result);
    assert.equal(result.schedule?.raw, "weekly Mon 09:00");
    assert.equal(result.schedule?.parsed, null);
  });

  it("omits schedule when not in frontmatter", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: No schedule\n---\n\nBody",
    );
    assert.ok(result);
    assert.equal(result.schedule, undefined);
  });

  it("parses roleId from frontmatter", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: News\nschedule: daily 08:00\nroleId: office\n---\n\nBody",
    );
    assert.ok(result);
    assert.equal(result.roleId, "office");
  });

  it("omits roleId when not present", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Simple\n---\n\nBody",
    );
    assert.ok(result);
    assert.equal(result.roleId, undefined);
  });

  it("rejects interval 0m (zero interval)", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Zero\nschedule: interval 0m\n---\n\nBody",
    );
    assert.ok(result);
    assert.equal(result.schedule?.parsed, null);
  });

  it("rejects interval 5s (below 10s minimum)", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: TooFast\nschedule: interval 5s\n---\n\nBody",
    );
    assert.ok(result);
    assert.equal(result.schedule?.parsed, null);
  });

  it("accepts interval 10s (minimum allowed)", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Min\nschedule: interval 10s\n---\n\nBody",
    );
    assert.ok(result);
    assert.deepEqual(result.schedule?.parsed, {
      type: SCHEDULE_TYPES.interval,
      intervalMs: 10_000,
    });
  });

  it("rejects daily 25:00 (invalid hour)", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Bad\nschedule: daily 25:00\n---\n\nBody",
    );
    assert.ok(result);
    assert.equal(result.schedule?.parsed, null);
  });

  it("rejects daily 12:60 (invalid minute)", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Bad\nschedule: daily 12:60\n---\n\nBody",
    );
    assert.ok(result);
    assert.equal(result.schedule?.parsed, null);
  });

  it("accepts daily 23:59 (max valid)", () => {
    const result = parseSkillFrontmatter(
      "---\ndescription: Late\nschedule: daily 23:59\n---\n\nBody",
    );
    assert.ok(result);
    assert.deepEqual(result.schedule?.parsed, {
      type: SCHEDULE_TYPES.daily,
      time: "23:59",
    });
  });
});
