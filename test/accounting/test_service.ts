import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AccountingError,
  addEntry,
  createBook,
  deleteBook,
  getBalanceSheetReport,
  getOpeningBalances,
  getProfitLossReport,
  listBooks,
  listEntries,
  setActiveBook,
  setOpeningBalances,
  voidEntry,
} from "../../server/accounting/service.js";

const created: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmo-acct-svc-"));
  created.push(dir);
  return dir;
}
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe("books lifecycle", () => {
  it("createBook seeds default chart, lists, sets active, deletes (last book is rejected)", async () => {
    const root = makeTmp();
    assert.deepEqual((await listBooks(root)).books, []);
    const first = await createBook({ name: "First" }, root);
    assert.equal(first.book.id, "default");
    const second = await createBook({ name: "Second" }, root);
    assert.notEqual(second.book.id, "default");
    const list = await listBooks(root);
    assert.equal(list.books.length, 2);
    assert.equal(list.activeBookId, "default");
    const switched = await setActiveBook({ bookId: second.book.id }, root);
    assert.equal(switched.activeBookId, second.book.id);
    // delete one — fine
    await deleteBook({ bookId: "default", confirm: true }, root);
    // delete the last — refused
    await assert.rejects(() => deleteBook({ bookId: second.book.id, confirm: true }, root), AccountingError);
  });
  it("deleteBook without confirm: true is rejected", async () => {
    const root = makeTmp();
    await createBook({ name: "A" }, root);
    await createBook({ name: "B" }, root);
    await assert.rejects(() => deleteBook({ bookId: "default", confirm: false }, root), AccountingError);
  });
});

describe("addEntry / listEntries", () => {
  it("appends, lists, and rejects unbalanced", async () => {
    const root = makeTmp();
    await createBook({ name: "Test" }, root);
    const entry = await addEntry(
      {
        date: "2026-04-01",
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "4000", credit: 100 },
        ],
      },
      root,
    );
    assert.equal(entry.entry.kind, "normal");
    const list = await listEntries({}, root);
    assert.equal(list.entries.length, 1);
    await assert.rejects(
      () =>
        addEntry(
          {
            date: "2026-04-02",
            lines: [
              { accountCode: "1000", debit: 100 },
              { accountCode: "4000", credit: 90 },
            ],
          },
          root,
        ),
      AccountingError,
    );
  });
});

describe("voidEntry", () => {
  it("appends a reverse + marker pair; void shows in listEntries", async () => {
    const root = makeTmp();
    await createBook({ name: "Test" }, root);
    const added = await addEntry(
      {
        date: "2026-04-01",
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "4000", credit: 100 },
        ],
      },
      root,
    );
    await voidEntry({ entryId: added.entry.id, reason: "typo" }, root);
    const list = await listEntries({}, root);
    // Original + reverse + marker = 3 rows
    assert.equal(list.entries.length, 3);
    assert.ok(list.entries.some((entry) => entry.kind === "void"));
    assert.ok(list.entries.some((entry) => entry.kind === "void-marker"));
  });
});

describe("opening balances", () => {
  it("sets opening, rejects when post-dated entries exist, replaces existing on second call", async () => {
    const root = makeTmp();
    await createBook({ name: "Test" }, root);
    // Set opening on a fresh book.
    await setOpeningBalances(
      {
        asOfDate: "2026-01-01",
        lines: [
          { accountCode: "1000", debit: 1000 },
          { accountCode: "3000", credit: 1000 },
        ],
      },
      root,
    );
    let opening = await getOpeningBalances({}, root);
    assert.ok(opening.opening);
    assert.equal(opening.opening.kind, "opening");
    // Replace it.
    const second = await setOpeningBalances(
      {
        asOfDate: "2026-01-01",
        lines: [
          { accountCode: "1000", debit: 1500 },
          { accountCode: "3000", credit: 1500 },
        ],
      },
      root,
    );
    assert.equal(second.replacedExisting, true);
    opening = await getOpeningBalances({}, root);
    assert.ok(opening.opening);
    assert.equal(opening.opening.lines[0].debit, 1500);
    // Now book a normal entry after opening, then try to set
    // opening again at a date that pre-dates the new entry — must
    // refuse.
    await addEntry(
      {
        date: "2026-02-01",
        lines: [
          { accountCode: "1000", debit: 50 },
          { accountCode: "4000", credit: 50 },
        ],
      },
      root,
    );
    await assert.rejects(
      () =>
        setOpeningBalances(
          {
            asOfDate: "2026-03-01",
            lines: [
              { accountCode: "1000", debit: 1000 },
              { accountCode: "3000", credit: 1000 },
            ],
          },
          root,
        ),
      AccountingError,
    );
  });
  it("rejects opening with income / expense accounts", async () => {
    const root = makeTmp();
    await createBook({ name: "Test" }, root);
    await assert.rejects(
      () =>
        setOpeningBalances(
          {
            asOfDate: "2026-01-01",
            lines: [
              { accountCode: "1000", debit: 1000 },
              { accountCode: "4000", credit: 1000 }, // Sales — income
            ],
          },
          root,
        ),
      AccountingError,
    );
  });
});

describe("reports end-to-end", () => {
  it("opening + a few entries → consistent B/S and P/L", async () => {
    const root = makeTmp();
    await createBook({ name: "Test" }, root);
    await setOpeningBalances(
      {
        asOfDate: "2026-01-01",
        lines: [
          { accountCode: "1000", debit: 1000 },
          { accountCode: "3000", credit: 1000 },
        ],
      },
      root,
    );
    await addEntry(
      {
        date: "2026-04-10",
        lines: [
          { accountCode: "1000", debit: 200 },
          { accountCode: "4000", credit: 200 },
        ],
      },
      root,
    );
    await addEntry(
      {
        date: "2026-04-20",
        lines: [
          { accountCode: "5100", debit: 70 },
          { accountCode: "1000", credit: 70 },
        ],
      },
      root,
    );
    const balanceSheet = await getBalanceSheetReport({ period: { kind: "month", period: "2026-04" } }, root);
    const cashRow = balanceSheet.balanceSheet.sections[0].rows.find((row) => row.accountCode === "1000");
    assert.ok(cashRow);
    // Cash = 1000 (opening) + 200 (sales) - 70 (rent) = 1130
    assert.equal(cashRow.balance, 1130);
    const profitLoss = await getProfitLossReport({ period: { kind: "month", period: "2026-04" } }, root);
    assert.equal(profitLoss.profitLoss.income.total, 200);
    assert.equal(profitLoss.profitLoss.expense.total, 70);
    assert.equal(profitLoss.profitLoss.netIncome, 130);
  });
});
