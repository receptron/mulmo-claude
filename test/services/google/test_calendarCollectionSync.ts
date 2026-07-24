// Unit tests for the LLM-free Google Calendar → collection projection
// (#2095). The mapping is the part that silently corrupts data if it drifts:
// the primary field must always carry the Google event id (that is what makes
// a re-sync update instead of duplicate), and only declared fields may be
// written.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyDelete, classifyWrite, groupByCalendar, toCollectionRecord } from "@mulmoclaude/core/google";
import type { CalendarEventSummary } from "@mulmoclaude/core/google";
import { parseIsoDateTime } from "@mulmoclaude/core/collection";
import type { CollectionFieldSpec } from "@mulmoclaude/core/collection";
import type { LoadedCollection } from "@mulmoclaude/core/collection/server";

const event = (overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary => ({
  id: "ev-1",
  summary: "Standup",
  start: "2026-07-19T09:00:00+09:00",
  end: "2026-07-19T09:15:00+09:00",
  htmlLink: "https://calendar.google.com/event?eid=ev-1",
  status: "confirmed",
  colorId: "7",
  ...overrides,
});

// The recipe shape from `assets/helps/google-calendar-collection.md`: the
// start/end columns are `datetime`, everything else is text.
const recipeFields: Record<string, CollectionFieldSpec> = {
  gid: { type: "string", label: "ID", primary: true },
  title: { type: "string", label: "Event" },
  on: { type: "datetime", label: "Start" },
  until: { type: "datetime", label: "End" },
  colour: { type: "string", label: "Colour" },
};

describe("toCollectionRecord (#2095)", () => {
  it("projects mapped event fields onto the collection's own field names", () => {
    const record = toCollectionRecord(event(), { title: "summary", on: "start", until: "end" }, "gid", recipeFields);
    assert.equal(record.title, "Standup");
    assert.equal(record.on, "2026-07-19T09:00:00");
    assert.equal(record.until, "2026-07-19T09:15:00");
  });

  it("always writes the Google event id into the primary field", () => {
    const record = toCollectionRecord(event({ id: "abc123" }), { title: "summary" }, "gid", recipeFields);
    assert.equal(record.gid, "abc123");
  });

  it("writes ONLY the mapped fields plus the primary — no stray event fields leak in", () => {
    const record = toCollectionRecord(event(), { title: "summary" }, "gid", recipeFields);
    assert.deepEqual(Object.keys(record).sort(), ["gid", "title"]);
  });

  it("supports an empty map (records then carry just the id)", () => {
    const record = toCollectionRecord(event(), {}, "gid", recipeFields);
    assert.deepEqual(record, { gid: "ev-1" });
  });

  it("keeps an empty optional value as an empty string rather than dropping the key", () => {
    const record = toCollectionRecord(event({ colorId: "" }), { colour: "colorId" }, "gid", recipeFields);
    assert.equal(record.colour, "");
    assert.ok("colour" in record);
  });

  it("lets the primary field win even if the map tries to target it", () => {
    // Schema validation rejects this, but the projection must not corrupt the
    // id if a hand-edited schema slips through.
    const record = toCollectionRecord(event({ id: "real-id" }), { gid: "summary" }, "gid", recipeFields);
    assert.equal(record.gid, "real-id");
  });
});

// Google's own shapes are rejected by the `datetime` record lint, so every
// synced record was reported as a data problem until the projection normalised
// them (#2310). Normalisation keys off the TARGET field's declared type, never
// the source field name.
describe("toCollectionRecord datetime normalisation (#2310)", () => {
  it("stores a timed event in the shape the collection parses", () => {
    const record = toCollectionRecord(event(), { on: "start", until: "end" }, "gid", recipeFields);
    assert.notEqual(parseIsoDateTime(record.on), null, "a synced start must satisfy the datetime lint");
    assert.notEqual(parseIsoDateTime(record.until), null, "a synced end must satisfy the datetime lint");
  });

  it("anchors an all-day event at midnight so it parses as a datetime", () => {
    const allDay = event({ start: "2026-07-19", end: "2026-07-20" });
    const record = toCollectionRecord(allDay, { on: "start", until: "end" }, "gid", recipeFields);
    assert.equal(record.on, "2026-07-19T00:00");
    assert.equal(record.until, "2026-07-20T00:00");
    assert.notEqual(parseIsoDateTime(record.on), null);
  });

  it("leaves a `string` target byte-for-byte alone — the user asked for Google's raw value", () => {
    const stringFields: Record<string, CollectionFieldSpec> = { on: { type: "string", label: "Start" } };
    const record = toCollectionRecord(event(), { on: "start" }, "gid", stringFields);
    assert.equal(record.on, "2026-07-19T09:00:00+09:00");
  });

  it("leaves a field the schema does not declare alone", () => {
    const record = toCollectionRecord(event(), { stray: "start" }, "gid", recipeFields);
    assert.equal(record.stray, "2026-07-19T09:00:00+09:00");
  });

  it("ignores a spec reachable only through the prototype chain", () => {
    // The declared shape is what the record lint reads, and it reads own
    // properties. Typing a field off an inherited spec would normalise a value
    // the collection never declared as a datetime.
    const inheritedFields: Record<string, CollectionFieldSpec> = Object.create({ on: { type: "datetime", label: "Start" } });
    const record = toCollectionRecord(event(), { on: "start" }, "gid", inheritedFields);
    assert.equal(record.on, "2026-07-19T09:00:00+09:00");
  });

  it("keeps an empty datetime value empty instead of inventing a time", () => {
    const record = toCollectionRecord(event({ start: "" }), { on: "start" }, "gid", recipeFields);
    assert.equal(record.on, "");
  });
});

// The sync token is keyed by calendarId, so syncing collection-by-collection
// let the first collection advance the shared token and left every later
// collection on that calendar reading an already-consumed window — silently
// missing those events forever. Grouping is what makes the fan-out correct
// (Codex + CodeRabbit review on #2184).
const collectionOn = (slug: string, calendarId?: string): LoadedCollection =>
  ({ slug, schema: { googleCalendar: { calendarId, map: {} } } }) as unknown as LoadedCollection;

describe("groupByCalendar (#2184 shared-token fan-out)", () => {
  it("puts every collection reading the same calendar in one group", () => {
    const groups = groupByCalendar([collectionOn("a", "work"), collectionOn("b", "work")]);
    assert.equal(groups.size, 1);
    assert.deepEqual(
      groups.get("work")?.map((entry) => entry.slug),
      ["a", "b"],
    );
  });

  it("keeps distinct calendars in separate groups", () => {
    const groups = groupByCalendar([collectionOn("a", "work"), collectionOn("b", "home")]);
    assert.equal(groups.size, 2);
    assert.deepEqual(
      groups.get("work")?.map((entry) => entry.slug),
      ["a"],
    );
    assert.deepEqual(
      groups.get("home")?.map((entry) => entry.slug),
      ["b"],
    );
  });

  it("groups collections that omit calendarId together (all mean the primary)", () => {
    const groups = groupByCalendar([collectionOn("a"), collectionOn("b")]);
    assert.equal(groups.size, 1);
    assert.equal(groups.get("primary")?.length, 2);
  });

  // An omitted id and an explicit "primary" address the same calendar and
  // therefore share ONE sync token. Grouping them apart let one group advance
  // the token out from under the other — the exact loss grouping exists to
  // prevent (Codex review on #2184).
  it('puts an omitted calendarId and an explicit "primary" in the SAME group', () => {
    const groups = groupByCalendar([collectionOn("omitted"), collectionOn("explicit", "primary")]);
    assert.equal(groups.size, 1, "mixed declarations must not split into two groups sharing one token");
    assert.deepEqual(
      groups.get("primary")?.map((entry) => entry.slug),
      ["omitted", "explicit"],
    );
  });

  it("treats an empty-string calendarId as the primary too", () => {
    const groups = groupByCalendar([collectionOn("blank", ""), collectionOn("omitted")]);
    assert.equal(groups.size, 1);
    assert.equal(groups.get("primary")?.length, 2);
  });

  it("returns no groups for no declaring collections", () => {
    assert.equal(groupByCalendar([]).size, 0);
  });
});

// Which failures hold the sync token is the difference between "retry next
// run" and "this calendar never syncs again": a permanently-unwritable id must
// NOT hold the token, or every run re-fetches the same window, fails on the
// same event, and the calendar dies silently.
describe("apply-failure classification (#2184)", () => {
  it("counts a successful write", () => {
    assert.equal(classifyWrite("ev-1", "ok").kind, "written");
  });

  it("treats an unusable event id as unwritable, NOT a retryable error", () => {
    const outcome = classifyWrite("bad@id", "invalid-id");
    assert.equal(outcome.kind, "unwritable", "retrying an invalid id forever would kill the whole calendar's sync");
  });

  it("treats a path escape as a retryable error (it can be fixed)", () => {
    assert.equal(classifyWrite("ev-1", "path-escape").kind, "error");
  });

  it("treats a write conflict as a retryable error", () => {
    assert.equal(classifyWrite("ev-1", "conflict").kind, "error");
  });

  it("counts a successful delete", () => {
    assert.equal(classifyDelete("ev-1", "ok").kind, "removed");
  });

  it("treats deleting a never-stored event as a benign skip", () => {
    assert.equal(classifyDelete("ev-1", "not-found").kind, "skipped");
  });

  it("treats an unusable id on delete as unwritable too", () => {
    assert.equal(classifyDelete("bad@id", "invalid-id").kind, "unwritable");
  });

  it("names the event in every failure message so the log is actionable", () => {
    const outcome = classifyWrite("ev-42", "path-escape");
    assert.ok(outcome.kind === "error" && outcome.message.includes("ev-42"));
  });
});
