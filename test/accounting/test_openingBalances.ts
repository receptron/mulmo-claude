import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findActiveOpening, validateOpening } from "../../server/accounting/openingBalances.js";
import { makeEntry, makeVoidEntries } from "../../server/accounting/journal.js";
import type { Account, JournalEntry, JournalLine } from "../../server/accounting/types.js";

const ACCOUNTS: Account[] = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "2000", name: "AP", type: "liability" },
  { code: "3000", name: "Equity", type: "equity" },
  { code: "4000", name: "Sales", type: "income" },
  { code: "5000", name: "Rent", type: "expense" },
];

const BALANCED: JournalLine[] = [
  { accountCode: "1000", debit: 1000 },
  { accountCode: "2000", credit: 400 },
  { accountCode: "3000", credit: 600 },
];

describe("validateOpening", () => {
  it("accepts a balanced opening over balance-sheet accounts only", () => {
    const result = validateOpening({ asOfDate: "2026-01-01", lines: BALANCED, accounts: ACCOUNTS, existingEntries: [] });
    assert.equal(result.ok, true);
  });
  it("accepts an empty opening (zero lines) as a no-op marker", () => {
    const result = validateOpening({ asOfDate: "2026-01-01", lines: [], accounts: ACCOUNTS, existingEntries: [] });
    assert.equal(result.ok, true);
  });
  it("rejects income / expense accounts", () => {
    const result = validateOpening({
      asOfDate: "2026-01-01",
      lines: [
        { accountCode: "1000", debit: 1000 },
        { accountCode: "4000", credit: 1000 }, // Sales — income, not allowed
      ],
      accounts: ACCOUNTS,
      existingEntries: [],
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((err) => err.message.includes("balance-sheet")));
  });
  it("rejects unbalanced opening", () => {
    const result = validateOpening({
      asOfDate: "2026-01-01",
      lines: [
        { accountCode: "1000", debit: 1000 },
        { accountCode: "3000", credit: 800 },
      ],
      accounts: ACCOUNTS,
      existingEntries: [],
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((err) => err.message.includes("must balance")));
  });
  it("rejects asOfDate later than an existing non-voided entry", () => {
    const earlier = makeEntry({
      date: "2025-12-15",
      lines: [
        { accountCode: "1000", debit: 50 },
        { accountCode: "4000", credit: 50 },
      ],
    });
    const result = validateOpening({
      asOfDate: "2026-01-01",
      lines: BALANCED,
      accounts: ACCOUNTS,
      existingEntries: [earlier],
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((err) => err.field === "asOfDate"));
  });
  it("ignores voided entries when checking the date conflict", () => {
    const earlier = makeEntry({
      date: "2025-12-15",
      lines: [
        { accountCode: "1000", debit: 50 },
        { accountCode: "4000", credit: 50 },
      ],
    });
    const { reverse, marker } = makeVoidEntries(earlier, "x", "2026-01-01");
    const result = validateOpening({
      asOfDate: "2026-01-01",
      lines: BALANCED,
      accounts: ACCOUNTS,
      existingEntries: [earlier, reverse, marker],
    });
    assert.equal(result.ok, true);
  });
});

describe("findActiveOpening", () => {
  it("returns null when there's no opening entry", () => {
    assert.equal(findActiveOpening([]), null);
  });
  it("returns the most recent non-voided opening", () => {
    const openingA = makeEntry({ date: "2026-01-01", lines: BALANCED, kind: "opening" });
    // Force a clearly later createdAt — makeEntry uses Date.now()
    // which can collide on fast machines.
    const openingB: JournalEntry = { ...makeEntry({ date: "2026-01-01", lines: BALANCED, kind: "opening" }), createdAt: "2099-01-01T00:00:00.000Z" };
    const found = findActiveOpening([openingA, openingB]);
    assert.equal(found?.id, openingB.id);
  });
  it("skips voided openings", () => {
    const opening = makeEntry({ date: "2026-01-01", lines: BALANCED, kind: "opening" });
    const { reverse, marker } = makeVoidEntries(opening, "replacing", "2026-04-30");
    assert.equal(findActiveOpening([opening, reverse, marker]), null);
  });
});
