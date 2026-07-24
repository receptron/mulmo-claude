// Unit tests for the Google Calendar → collection `datetime` normaliser
// (#2310). Google answers RFC3339-with-zone for timed events and a bare date
// for all-day ones; a collection `datetime` field is linted with
// `parseIsoDateTime`, which accepts neither — so every synced record was
// reported as a data problem.
//
// The contract these tests pin is deliberately NOT a restatement of the
// implementation's regexes: every normalised value is fed to the real
// `parseIsoDateTime`, so the tests fail if that parser's shape ever moves.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toCollectionDateTime } from "@mulmoclaude/core/google";
import { parseIsoDateTime } from "@mulmoclaude/core/collection";

/** Normalise, and assert on the way out that the result is something the
 *  collection's own parser accepts — the real reason the value is stored at
 *  all. Callers still assert the exact text, so a change in either the shape
 *  or the parser turns these red. */
const normalizedForCollection = (raw: string): unknown => {
  const normalized = toCollectionDateTime(raw);
  assert.notEqual(parseIsoDateTime(normalized), null, `'${String(normalized)}' must satisfy parseIsoDateTime`);
  return normalized;
};

describe("toCollectionDateTime — timed events (#2310)", () => {
  it("drops a positive offset and keeps the wall clock", () => {
    assert.equal(normalizedForCollection("2026-05-12T08:45:00+09:00"), "2026-05-12T08:45:00");
  });

  it("drops a negative offset without shifting the clock", () => {
    // The point of stripping rather than converting: 08:45 in New York stays
    // 08:45, so the stored value matches what the user reads off Google
    // Calendar no matter which host ran the sync.
    assert.equal(normalizedForCollection("2026-05-12T08:45:00-05:00"), "2026-05-12T08:45:00");
  });

  it("drops a `Z` suffix", () => {
    assert.equal(normalizedForCollection("2026-05-12T08:45:00Z"), "2026-05-12T08:45:00");
  });

  it("drops a compact `+0900` offset (no colon)", () => {
    assert.equal(normalizedForCollection("2026-05-12T08:45:00+0900"), "2026-05-12T08:45:00");
  });

  it("leaves a value that already has no offset alone", () => {
    assert.equal(normalizedForCollection("2026-05-12T08:45:00"), "2026-05-12T08:45:00");
  });

  it("keeps seconds when Google sends them", () => {
    assert.equal(normalizedForCollection("2026-05-12T08:45:37+09:00"), "2026-05-12T08:45:37");
  });

  it("accepts a value with no seconds at all", () => {
    assert.equal(normalizedForCollection("2026-05-12T08:45+09:00"), "2026-05-12T08:45");
  });

  it("drops fractional seconds, which the collection shape has no room for", () => {
    assert.equal(normalizedForCollection("2026-05-12T08:45:00.123Z"), "2026-05-12T08:45:00");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(normalizedForCollection("  2026-05-12T08:45:00+09:00  "), "2026-05-12T08:45:00");
  });

  it("keeps midnight at midnight rather than rolling the day", () => {
    assert.equal(normalizedForCollection("2026-05-12T00:00:00+09:00"), "2026-05-12T00:00:00");
  });
});

describe("toCollectionDateTime — all-day events (#2310)", () => {
  it("anchors a date-only value at midnight", () => {
    assert.equal(normalizedForCollection("2026-03-18"), "2026-03-18T00:00");
  });

  it("anchors the exclusive end date the same way", () => {
    assert.equal(normalizedForCollection("2026-03-19"), "2026-03-19T00:00");
  });

  it("anchors a date-only value with surrounding whitespace", () => {
    assert.equal(normalizedForCollection(" 2026-03-18 "), "2026-03-18T00:00");
  });
});

// Anything that is not a Google shape is returned untouched: inventing a value
// would hide the problem, while passing it through leaves the record lint free
// to report it.
describe("toCollectionDateTime — values it must not invent (#2310)", () => {
  it("passes an empty string through unchanged", () => {
    assert.equal(toCollectionDateTime(""), "");
  });

  it("passes a whitespace-only string through unchanged", () => {
    assert.equal(toCollectionDateTime("   "), "   ");
  });

  it("passes a non-string value through unchanged", () => {
    assert.equal(toCollectionDateTime(undefined), undefined);
    assert.equal(toCollectionDateTime(null), null);
    assert.equal(toCollectionDateTime(42), 42);
    const nested = { dateTime: "2026-05-12T08:45:00+09:00" };
    assert.equal(toCollectionDateTime(nested), nested);
  });

  it("passes free text through rather than manufacturing a datetime", () => {
    assert.equal(toCollectionDateTime("tomorrow"), "tomorrow");
    assert.equal(parseIsoDateTime(toCollectionDateTime("tomorrow")), null);
  });

  it("does not turn an impossible day into a valid-looking datetime", () => {
    // `2026-02-30` matches the date-only SHAPE, so it gains a clock — but the
    // strict parser still rejects it, which is the correct outcome: the lint
    // must keep reporting a day that does not exist.
    assert.equal(toCollectionDateTime("2026-02-30"), "2026-02-30T00:00");
    assert.equal(parseIsoDateTime("2026-02-30T00:00"), null);
  });
});
