// Tests for the host-driven recurrence module: pure civil-date math
// (the correctness centre — month boundaries, leap years, no drift),
// the deterministic successor id, and `maybeSpawnSuccessor`'s
// create-if-absent idempotency. The pure helpers need no fs; the spawn
// path uses a tmpdir workspace.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  advanceTriggerDate,
  computeSuccessor,
  daysInMonth,
  formatCivil,
  isTriggerDue,
  maybeSpawnSuccessor,
  parseCivil,
  resolveEvery,
  successorId,
  type CivilDate,
  readItem,
  writeItem,
  type LoadedCollection,
} from "@mulmoclaude/core/collection/server";
import type { CollectionEvery, CollectionSchema, CollectionSpawnEvery } from "../../../server/workspace/collections/types.js";

describe("daysInMonth", () => {
  it("knows month lengths incl. leap years", () => {
    assert.equal(daysInMonth(2026, 1), 31);
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2024, 2), 29); // leap
    assert.equal(daysInMonth(2000, 2), 29); // century leap
    assert.equal(daysInMonth(1900, 2), 28); // century non-leap
    assert.equal(daysInMonth(2026, 4), 30);
  });
});

describe("parseCivil / formatCivil", () => {
  it("parses well-formed dates and round-trips", () => {
    assert.deepEqual(parseCivil("2026-06-10"), { y: 2026, m: 6, d: 10 });
    assert.equal(formatCivil({ y: 2026, m: 6, d: 10 }), "2026-06-10");
    assert.equal(formatCivil({ y: 2026, m: 1, d: 1 }), "2026-01-01");
  });

  it("rejects malformed / out-of-range values", () => {
    assert.equal(parseCivil("2026-13-01"), null); // bad month
    assert.equal(parseCivil("2026-02-30"), null); // Feb 30 doesn't exist
    assert.equal(parseCivil("2026-02-29"), null); // 2026 isn't a leap year
    assert.equal(parseCivil("2026-6-10"), null); // not zero-padded
    assert.equal(parseCivil("garbage"), null);
    assert.equal(parseCivil(20260610), null);
    assert.equal(parseCivil(undefined), null);
  });
});

function chain(start: CivilDate, every: CollectionEvery, steps: number): string[] {
  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < steps; i++) {
    cur = advanceTriggerDate(cur, every);
    out.push(formatCivil(cur));
  }
  return out;
}

describe("advanceTriggerDate", () => {
  it("'10th of every month' — never clamped, rolls the year", () => {
    const every: CollectionEvery = { unit: "month", interval: 1, dayOfMonth: 10 };
    assert.deepEqual(chain({ y: 2026, m: 11, d: 10 }, every, 3), ["2026-12-10", "2027-01-10", "2027-02-10"]);
  });

  it("day-31 anchor clamps per month with NO drift", () => {
    // The crux: anchor lives in the rule, so a clamped Feb doesn't stick.
    const every: CollectionEvery = { unit: "month", interval: 1, dayOfMonth: 31 };
    assert.deepEqual(chain({ y: 2026, m: 1, d: 31 }, every, 5), ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
  });

  it("day-29 anchor restores to 29 after a leap-Feb clamp", () => {
    const every: CollectionEvery = { unit: "month", interval: 1, dayOfMonth: 29 };
    // 2024 is a leap year: Feb keeps 29; following months restore 29.
    assert.deepEqual(chain({ y: 2024, m: 1, d: 29 }, every, 3), ["2024-02-29", "2024-03-29", "2024-04-29"]);
  });

  it("omitted dayOfMonth preserves the source day (safe for ≤28)", () => {
    const every: CollectionEvery = { unit: "month", interval: 1 };
    assert.deepEqual(chain({ y: 2026, m: 1, d: 15 }, every, 2), ["2026-02-15", "2026-03-15"]);
  });

  it("'last' sentinel always lands on the month's last day", () => {
    const every: CollectionEvery = { unit: "month", interval: 1, dayOfMonth: "last" };
    assert.deepEqual(chain({ y: 2026, m: 1, d: 31 }, every, 4), ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("quarterly via interval 3", () => {
    const every: CollectionEvery = { unit: "month", interval: 3, dayOfMonth: 10 };
    assert.deepEqual(chain({ y: 2026, m: 1, d: 10 }, every, 4), ["2026-04-10", "2026-07-10", "2026-10-10", "2027-01-10"]);
  });

  it("annual via unit year, clamping leap-day to Feb 28 in non-leap years", () => {
    const every: CollectionEvery = { unit: "year", interval: 1 };
    assert.deepEqual(chain({ y: 2024, m: 2, d: 29 }, every, 1), ["2025-02-28"]);
  });

  it("week / day units do civil arithmetic across boundaries", () => {
    assert.equal(formatCivil(advanceTriggerDate({ y: 2026, m: 1, d: 25 }, { unit: "week", interval: 2 })), "2026-02-08");
    assert.equal(formatCivil(advanceTriggerDate({ y: 2026, m: 12, d: 28 }, { unit: "day", interval: 10 })), "2027-01-07");
  });
});

describe("isTriggerDue", () => {
  it("fires once today's civil date reaches the trigger", () => {
    const due = "2026-06-10";
    assert.equal(isTriggerDue(due, new Date(2026, 5, 9, 23, 59)), false); // day before
    assert.equal(isTriggerDue(due, new Date(2026, 5, 10, 0, 1)), true); // the day
    assert.equal(isTriggerDue(due, new Date(2026, 5, 11)), true); // after
  });

  it("returns null for an unparseable trigger value", () => {
    assert.equal(isTriggerDue("nope", new Date(2026, 5, 10)), null);
    assert.equal(isTriggerDue(undefined, new Date(2026, 5, 10)), null);
  });

  it("fires `leadDays` early when a lead time is given", () => {
    const due = "2026-06-10";
    // 10-day lead → fire date is May 31.
    assert.equal(isTriggerDue(due, new Date(2026, 4, 30), 10), false); // May 30, still early
    assert.equal(isTriggerDue(due, new Date(2026, 4, 31), 10), true); // May 31, fire date reached
    assert.equal(isTriggerDue(due, new Date(2026, 5, 5), 10), true); // within the window
  });

  it("lead-day subtraction crosses month/year boundaries correctly", () => {
    // Jan 5 2026 minus 10 days → Dec 26 2025.
    assert.equal(isTriggerDue("2026-01-05", new Date(2025, 11, 25), 10), false);
    assert.equal(isTriggerDue("2026-01-05", new Date(2025, 11, 26), 10), true);
  });

  it("leadDays of 0 (or omitted) fires on the trigger date", () => {
    assert.equal(isTriggerDue("2026-06-10", new Date(2026, 5, 9), 0), false);
    assert.equal(isTriggerDue("2026-06-10", new Date(2026, 5, 10), 0), true);
  });
});

describe("successorId", () => {
  it("dates a bare stem on the first spawn", () => {
    assert.equal(successorId("rent", { y: 2026, m: 6, d: 10 }), "rent-20260610");
  });

  it("replaces an existing -YYYYMMDD suffix, preserving the stem", () => {
    assert.equal(successorId("rent-20260610", { y: 2026, m: 7, d: 10 }), "rent-20260710");
  });

  it("leaves a non-date trailing segment alone", () => {
    assert.equal(successorId("rent-may", { y: 2026, m: 6, d: 10 }), "rent-may-20260610");
  });
});

// The new store-based spawn signature takes the discovered collection.
const asCollection = (slug: string, schema: CollectionSchema, dataDir: string): LoadedCollection =>
  ({ slug, source: "project", schema, dataDir, skillDir: dataDir }) as unknown as LoadedCollection;

function spawnSchema(extra: Partial<CollectionSchema> = {}): CollectionSchema {
  return {
    title: "Rent",
    icon: "home",
    dataPath: "data/rent/items",
    primaryKey: "id",
    fields: {
      id: { type: "string", label: "ID", primary: true, required: true },
      dueOn: { type: "date", label: "Due", required: true },
      amount: { type: "number", label: "Amount" },
      status: { type: "enum", values: ["pending", "paid"], label: "Status", required: true },
    },
    completionField: "status",
    completionDoneValues: ["paid"],
    triggerField: "dueOn",
    spawn: {
      when: { field: "status", in: ["paid"] },
      every: { unit: "month", interval: 1, dayOfMonth: 10 },
      carry: ["amount"],
      set: { status: "pending" },
    },
    ...extra,
  };
}

describe("computeSuccessor", () => {
  it("carries, sets, and advances the trigger", () => {
    const schema = spawnSchema();
    const result = computeSuccessor(schema, { id: "rent-20260610", dueOn: "2026-06-10", amount: 1500, status: "paid" }, "rent-20260610");
    assert.deepEqual(result, {
      id: "rent-20260710",
      record: { amount: 1500, status: "pending", dueOn: "2026-07-10", id: "rent-20260710" },
    });
  });

  it("returns null when the source trigger date is unparseable", () => {
    const schema = spawnSchema();
    assert.equal(computeSuccessor(schema, { id: "x", dueOn: "soon", status: "paid" }, "x"), null);
  });

  it("returns null when the schema declares no spawn", () => {
    const schema = spawnSchema({ spawn: undefined });
    assert.equal(computeSuccessor(schema, { id: "x", dueOn: "2026-06-10", status: "paid" }, "x"), null);
  });
});

describe("maybeSpawnSuccessor", () => {
  let workdir: string;
  let dataDir: string;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), "test-spawn-"));
    dataDir = path.join(workdir, "data", "rent", "items");
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("creates the successor when the predicate matches", async () => {
    const schema = spawnSchema();
    const source = { id: "rent-20260610", dueOn: "2026-06-10", amount: 1500, status: "paid" };
    await maybeSpawnSuccessor(asCollection("rent", schema, dataDir), source, "rent-20260610", { workspaceRoot: workdir });
    const next = await readItem(dataDir, "rent-20260710", { workspaceRoot: workdir });
    assert.deepEqual(next, { amount: 1500, status: "pending", dueOn: "2026-07-10", id: "rent-20260710" });
  });

  it("is idempotent — spawning twice yields exactly one successor", async () => {
    const schema = spawnSchema();
    const source = { id: "rent-20260610", dueOn: "2026-06-10", amount: 1500, status: "paid" };
    await maybeSpawnSuccessor(asCollection("rent", schema, dataDir), source, "rent-20260610", { workspaceRoot: workdir });
    await maybeSpawnSuccessor(asCollection("rent", schema, dataDir), source, "rent-20260610", { workspaceRoot: workdir });
    const all = (await readItem(dataDir, "rent-20260710", { workspaceRoot: workdir })) !== null;
    assert.equal(all, true);
    // Mutate the successor, then re-run: create-if-absent must NOT overwrite the edit.
    await writeItem(dataDir, "rent-20260710", { id: "rent-20260710", dueOn: "2026-07-10", amount: 9999, status: "pending" }, { workspaceRoot: workdir });
    await maybeSpawnSuccessor(asCollection("rent", schema, dataDir), source, "rent-20260610", { workspaceRoot: workdir });
    const next = await readItem(dataDir, "rent-20260710", { workspaceRoot: workdir });
    assert.equal((next as { amount: number }).amount, 9999);
  });

  it("does not spawn when the predicate doesn't match", async () => {
    const schema = spawnSchema();
    const source = { id: "rent-20260610", dueOn: "2026-06-10", amount: 1500, status: "pending" };
    await maybeSpawnSuccessor(asCollection("rent", schema, dataDir), source, "rent-20260610", { workspaceRoot: workdir });
    assert.equal(await readItem(dataDir, "rent-20260710", { workspaceRoot: workdir }), null);
  });

  it("refuses a successor that would be born matching its own predicate (runaway guard)", async () => {
    // `set` seeds the successor's status to a done/matching value, so it
    // would respawn on its first reconcile — the guard must skip it.
    const schema = spawnSchema({
      spawn: { when: { field: "status", in: ["paid"] }, every: { unit: "month", interval: 1, dayOfMonth: 10 }, carry: ["amount"], set: { status: "paid" } },
    });
    const source = { id: "rent-20260610", dueOn: "2026-06-10", amount: 1500, status: "paid" };
    await maybeSpawnSuccessor(asCollection("rent", schema, dataDir), source, "rent-20260610", { workspaceRoot: workdir });
    assert.equal(await readItem(dataDir, "rent-20260710", { workspaceRoot: workdir }), null);
  });

  it("defaults the predicate to the completion-done condition when `when` is omitted", async () => {
    const schema = spawnSchema({ spawn: { every: { unit: "month", interval: 1, dayOfMonth: 10 }, carry: ["amount"], set: { status: "pending" } } });
    const source = { id: "rent-20260610", dueOn: "2026-06-10", amount: 1500, status: "paid" };
    await maybeSpawnSuccessor(asCollection("rent", schema, dataDir), source, "rent-20260610", { workspaceRoot: workdir });
    assert.notEqual(await readItem(dataDir, "rent-20260710", { workspaceRoot: workdir }), null);
  });
});

// --- Field-driven `every` (per-record interval via an enum field) ---

const FREQ_EVERY: CollectionSpawnEvery = {
  fromField: "frequency",
  map: {
    daily: { unit: "day", interval: 1 },
    weekly: { unit: "week", interval: 1 },
    monthly: { unit: "month", interval: 1, dayOfMonth: 1 },
  },
};

// A bills schema whose interval is selected per record by `frequency`.
function freqSchema(extra: Partial<CollectionSchema> = {}): CollectionSchema {
  return {
    title: "Bills",
    icon: "receipt",
    dataPath: "data/bills/items",
    primaryKey: "id",
    fields: {
      id: { type: "string", label: "ID", primary: true, required: true },
      dueOn: { type: "date", label: "Due", required: true },
      frequency: { type: "enum", values: ["daily", "weekly", "monthly"], label: "Frequency", required: true },
      status: { type: "enum", values: ["pending", "paid"], label: "Status", required: true },
    },
    completionField: "status",
    completionDoneValues: ["paid"],
    triggerField: "dueOn",
    spawn: { when: { field: "status", in: ["paid"] }, every: FREQ_EVERY, carry: ["frequency"], set: { status: "pending" } },
    ...extra,
  };
}

describe("resolveEvery", () => {
  it("passes a literal `every` through unchanged", () => {
    const literal: CollectionEvery = { unit: "month", interval: 1, dayOfMonth: 10 };
    assert.equal(resolveEvery(literal, { frequency: "weekly" }), literal);
  });

  it("maps the record's enum value to its interval", () => {
    assert.deepEqual(resolveEvery(FREQ_EVERY, { frequency: "weekly" }), { unit: "week", interval: 1 });
    assert.deepEqual(resolveEvery(FREQ_EVERY, { frequency: "monthly" }), { unit: "month", interval: 1, dayOfMonth: 1 });
  });

  it("returns null on an unmapped value or an empty/missing field", () => {
    assert.equal(resolveEvery(FREQ_EVERY, { frequency: "yearly" }), null); // value not in map
    assert.equal(resolveEvery(FREQ_EVERY, { frequency: "" }), null); // empty
    assert.equal(resolveEvery(FREQ_EVERY, {}), null); // missing
  });

  // A bare `map[key]` resolves these to `Object.prototype` members, and the
  // `?? null` fallback cannot catch it — a function is not undefined. The
  // interval then reaches `advanceTriggerDate` and yields a NaN date, so the
  // successor lands on disk as `<stem>-0NaNNaNNaN` with nothing thrown (#2314).
  it("returns null for a driver value that names an Object.prototype member", () => {
    for (const frequency of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      assert.equal(resolveEvery(FREQ_EVERY, { frequency }), null, `expected ${frequency} to resolve to null`);
    }
  });

  it("does not build a successor for a driver value naming a prototype member", () => {
    const result = computeSuccessor(freqSchema(), { id: "rent", dueOn: "2026-06-10", frequency: "constructor", status: "paid" }, "rent");
    assert.equal(result, null);
  });
});

describe("computeSuccessor — field-driven every", () => {
  it("advances by the per-record interval (weekly)", () => {
    const result = computeSuccessor(freqSchema(), { id: "netflix-20260610", dueOn: "2026-06-10", frequency: "weekly", status: "paid" }, "netflix-20260610");
    assert.deepEqual(result, {
      id: "netflix-20260617",
      record: { frequency: "weekly", status: "pending", dueOn: "2026-06-17", id: "netflix-20260617" },
    });
  });

  it("advances by the per-record interval (monthly, dayOfMonth anchor)", () => {
    const result = computeSuccessor(freqSchema(), { id: "rent-20260601", dueOn: "2026-06-01", frequency: "monthly", status: "paid" }, "rent-20260601");
    assert.equal(result?.record.dueOn, "2026-07-01");
  });

  it("returns null when the record's frequency isn't in the map", () => {
    assert.equal(computeSuccessor(freqSchema(), { id: "x", dueOn: "2026-06-10", frequency: "yearly", status: "paid" }, "x"), null);
  });
});

describe("maybeSpawnSuccessor — field-driven every", () => {
  let workdir: string;
  let dataDir: string;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), "test-spawn-freq-"));
    dataDir = path.join(workdir, "data", "bills", "items");
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("creates a weekly successor 7 days out and carries the frequency driver", async () => {
    const source = { id: "gym-20260610", dueOn: "2026-06-10", frequency: "weekly", status: "paid" };
    await maybeSpawnSuccessor(asCollection("bills", freqSchema(), dataDir), source, "gym-20260610", { workspaceRoot: workdir });
    const next = await readItem(dataDir, "gym-20260617", { workspaceRoot: workdir });
    assert.deepEqual(next, { frequency: "weekly", status: "pending", dueOn: "2026-06-17", id: "gym-20260617" });
  });

  it("skips (no write) when the record's frequency isn't in the map", async () => {
    const source = { id: "odd-20260610", dueOn: "2026-06-10", frequency: "yearly", status: "paid" };
    await maybeSpawnSuccessor(asCollection("bills", freqSchema(), dataDir), source, "odd-20260610", { workspaceRoot: workdir });
    assert.equal(await readItem(dataDir, "odd-20260617", { workspaceRoot: workdir }), null);
  });

  it("runaway guard still fires under field-driven every (successor born matching its predicate)", async () => {
    // `set` seeds status back to a done value → the successor would respawn.
    const schema = freqSchema({ spawn: { when: { field: "status", in: ["paid"] }, every: FREQ_EVERY, carry: ["frequency"], set: { status: "paid" } } });
    const source = { id: "gym-20260610", dueOn: "2026-06-10", frequency: "weekly", status: "paid" };
    await maybeSpawnSuccessor(asCollection("bills", schema, dataDir), source, "gym-20260610", { workspaceRoot: workdir });
    assert.equal(await readItem(dataDir, "gym-20260617", { workspaceRoot: workdir }), null);
  });
});
