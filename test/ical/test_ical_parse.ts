import { describe, it } from "node:test";
import assert from "node:assert";
import ical from "node-ical";

// Minimal .ics content for testing parsing logic
const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
DTSTART:20260415T100000Z
DTEND:20260415T110000Z
SUMMARY:Team Standup
LOCATION:Meeting Room A
DESCRIPTION:Daily standup meeting
UID:event-001@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260420
SUMMARY:Company Holiday
UID:event-002@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20260501T140000Z
DTEND:20260501T150000Z
SUMMARY:1:1 with Manager
UID:event-003@example.com
END:VEVENT
END:VCALENDAR`;

describe("iCal parsing with node-ical", () => {
  it("parses VEVENTs from ICS text", () => {
    const data = ical.sync.parseICS(SAMPLE_ICS);
    const events = Object.values(data).filter((e) => e.type === "VEVENT");
    assert.strictEqual(events.length, 3);
  });

  it("extracts summary, location, description from a date-time event", () => {
    const data = ical.sync.parseICS(SAMPLE_ICS);
    const events = Object.values(data).filter(
      (e) => e.type === "VEVENT",
    ) as ical.VEvent[];
    const standup = events.find((e) => e.uid === "event-001@example.com");
    assert.ok(standup, "standup event should exist");
    assert.strictEqual(standup.summary, "Team Standup");
    assert.strictEqual(standup.location, "Meeting Room A");
    assert.strictEqual(standup.description, "Daily standup meeting");
  });

  it("parses start as a Date object", () => {
    const data = ical.sync.parseICS(SAMPLE_ICS);
    const events = Object.values(data).filter(
      (e) => e.type === "VEVENT",
    ) as ical.VEvent[];
    const standup = events.find((e) => e.uid === "event-001@example.com");
    assert.ok(standup);
    assert.ok(standup.start instanceof Date, "start should be a Date");
    assert.strictEqual(standup.start.getUTCFullYear(), 2026);
    assert.strictEqual(standup.start.getUTCMonth(), 3); // April = 3
    assert.strictEqual(standup.start.getUTCDate(), 15);
  });

  it("handles all-day events (VALUE=DATE)", () => {
    const data = ical.sync.parseICS(SAMPLE_ICS);
    const events = Object.values(data).filter(
      (e) => e.type === "VEVENT",
    ) as ical.VEvent[];
    const holiday = events.find((e) => e.uid === "event-002@example.com");
    assert.ok(holiday, "holiday event should exist");
    assert.strictEqual(holiday.summary, "Company Holiday");
    // All-day events have datetype "date"
    const datetype = (holiday as unknown as { datetype?: string }).datetype;
    assert.strictEqual(datetype, "date");
  });

  it("handles summary with colon character", () => {
    const data = ical.sync.parseICS(SAMPLE_ICS);
    const events = Object.values(data).filter(
      (e) => e.type === "VEVENT",
    ) as ical.VEvent[];
    const oneOnOne = events.find((e) => e.uid === "event-003@example.com");
    assert.ok(oneOnOne, "1:1 event should exist");
    assert.strictEqual(oneOnOne.summary, "1:1 with Manager");
  });

  it("ignores non-VEVENT entries", () => {
    const icsWithTimezone = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:America/New_York
END:VTIMEZONE
BEGIN:VEVENT
DTSTART:20260501T090000Z
SUMMARY:Only Event
UID:event-only@example.com
END:VEVENT
END:VCALENDAR`;
    const data = ical.sync.parseICS(icsWithTimezone);
    const events = Object.values(data).filter((e) => e.type === "VEVENT");
    assert.strictEqual(events.length, 1);
  });

  it("handles empty calendar", () => {
    const emptyIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
END:VCALENDAR`;
    const data = ical.sync.parseICS(emptyIcs);
    const events = Object.values(data).filter((e) => e.type === "VEVENT");
    assert.strictEqual(events.length, 0);
  });

  it("handles events without optional fields", () => {
    const minimalIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260601T120000Z
SUMMARY:Minimal Event
UID:event-minimal@example.com
END:VEVENT
END:VCALENDAR`;
    const data = ical.sync.parseICS(minimalIcs);
    const events = Object.values(data).filter(
      (e) => e.type === "VEVENT",
    ) as ical.VEvent[];
    assert.strictEqual(events.length, 1);
    const event = events[0];
    assert.strictEqual(event.location, undefined);
    assert.strictEqual(event.description, undefined);
  });
});
