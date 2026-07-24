import { test } from "node:test";
import assert from "node:assert/strict";

import { toUtcIsoDate } from "../src/index.ts";

test("toUtcIsoDate: UTC year-end boundary stays in the old year", () => {
  // At any positive local offset (e.g. UTC+9) this instant is already
  // Jan 1 local — the UTC date must not shift with it.
  assert.equal(toUtcIsoDate(new Date("2025-12-31T23:59:59.999Z")), "2025-12-31");
});

test("toUtcIsoDate: first instant of the UTC year is Jan 1", () => {
  assert.equal(toUtcIsoDate(new Date("2026-01-01T00:00:00.000Z")), "2026-01-01");
});

test("toUtcIsoDate: single-digit month and day are zero-padded", () => {
  assert.equal(toUtcIsoDate(new Date("2026-03-05T12:00:00.000Z")), "2026-03-05");
  assert.equal(toUtcIsoDate(new Date("2026-11-09T00:00:00.000Z")), "2026-11-09");
});

test("toUtcIsoDate: epoch", () => {
  assert.equal(toUtcIsoDate(new Date(0)), "1970-01-01");
});
