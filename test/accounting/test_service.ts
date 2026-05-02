import { describe, it, after, beforeEach } from "node:test";
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
  setOpeningBalances,
  voidEntry,
} from "../../server/accounting/service.js";
import { _resetRebuildQueueForTesting, awaitRebuildIdle } from "../../server/accounting/snapshotCache.js";

const created: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmo-acct-svc-"));
  created.push(dir);
  return dir;
}

// Each test owns its own bookId, but the rebuild queue is module-
// level state. Reset before every test so a leftover background
// rebuild from an earlier test can't race with the current one.
// The reset is async — it cancels and awaits any in-flight rebuild
// before clearing bookkeeping.
beforeEach(async () => {
  await _resetRebuildQueueForTesting();
});

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

// Helper for tests that follow up an entry-write with a read — drain
// any background rebuild before asserting so we don't race the
// snapshot writer.
async function drainRebuilds(bookId: string): Promise<void> {
  await awaitRebuildIdle(bookId);
}

describe("createBook id validation", () => {
  it("rejects path-traversal ids", async () => {
    const root = makeTmp();
    for (const malicious of ["../escape", "..", "/abs/path", "with/slash", "with\\backslash", ".hidden", "_internal"]) {
      await assert.rejects(() => createBook({ id: malicious, name: "X" }, root), AccountingError, `should reject ${JSON.stringify(malicious)}`);
    }
  });
  it("accepts the safe slug shape", async () => {
    const root = makeTmp();
    const result = await createBook({ id: "personal-2026", name: "Personal" }, root);
    assert.equal(result.book.id, "personal-2026");
  });
});

describe("upsertAccount synthetic-code guard", () => {
  it("rejects account codes starting with _ (reserved for synthetic rows)", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    const { upsertAccount } = await import("../../server/accounting/service.js");
    await assert.rejects(
      () => upsertAccount({ bookId: book.book.id, account: { code: "_currentEarnings", name: "Synthetic", type: "equity" } }, root),
      AccountingError,
    );
  });
});

describe("upsertAccount active-flag policy", () => {
  it("preserves an existing inactive flag when the caller omits it (no silent reactivation)", async () => {
    // Why this test: the soft-delete UI sends `{...account, active: false}`
    // to deactivate, but a downstream rename or note edit that only sends
    // `{code, name, type}` (e.g. an LLM tool call, an older client) would
    // otherwise drop the flag and silently re-expose the account in the
    // entry/ledger dropdowns. Pin the inheritance so that path stays safe.
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    const { upsertAccount } = await import("../../server/accounting/service.js");
    await upsertAccount({ bookId: book.book.id, account: { code: "1500", name: "Equipment", type: "asset", active: false } }, root);
    const updated = await upsertAccount({ bookId: book.book.id, account: { code: "1500", name: "Old Equipment", type: "asset" } }, root);
    const renamed = updated.accounts.find((entry) => entry.code === "1500");
    assert.ok(renamed);
    assert.equal(renamed?.active, false, "rename without echoing active=false should keep the account inactive");
    assert.equal(renamed?.name, "Old Equipment");
  });

  it("treats explicit active=true as a reactivate (omits the flag)", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    const { upsertAccount } = await import("../../server/accounting/service.js");
    await upsertAccount({ bookId: book.book.id, account: { code: "1500", name: "Equipment", type: "asset", active: false } }, root);
    const reactivated = await upsertAccount({ bookId: book.book.id, account: { code: "1500", name: "Equipment", type: "asset", active: true } }, root);
    const account = reactivated.accounts.find((entry) => entry.code === "1500");
    assert.ok(account);
    assert.equal(account?.active, undefined, "explicit active=true should clear the persisted flag");
  });

  it("does not invent an active flag for accounts that never had one", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    const { upsertAccount } = await import("../../server/accounting/service.js");
    const result = await upsertAccount({ bookId: book.book.id, account: { code: "1500", name: "Equipment", type: "asset" } }, root);
    const account = result.accounts.find((entry) => entry.code === "1500");
    assert.ok(account);
    assert.equal(account?.active, undefined, "default-active accounts keep the field omitted");
  });
});

describe("books lifecycle", () => {
  it("createBook generates ids, lists, and deletes books in sequence", async () => {
    const root = makeTmp();
    const empty = await listBooks(root);
    assert.deepEqual(empty.books, []);
    const first = await createBook({ name: "First" }, root);
    assert.match(first.book.id, /^book-/);
    const second = await createBook({ name: "Second" }, root);
    assert.match(second.book.id, /^book-/);
    assert.notEqual(first.book.id, second.book.id);
    const list = await listBooks(root);
    assert.equal(list.books.length, 2);
    const afterDelete = await deleteBook({ bookId: second.book.id, confirm: true }, root);
    assert.equal(afterDelete.deletedBookId, second.book.id);
    const remaining = await listBooks(root);
    assert.equal(remaining.books.length, 1);
    assert.equal(remaining.books[0].id, first.book.id);
  });
  it("deleting the last book empties the workspace; ops without a bookId throw 400", async () => {
    const root = makeTmp();
    const only = await createBook({ name: "Only" }, root);
    const result = await deleteBook({ bookId: only.book.id, confirm: true }, root);
    assert.equal(result.deletedBookId, only.book.id);
    const list = await listBooks(root);
    assert.equal(list.books.length, 0);
    // No more "active book" fallback — every action requires an
    // explicit bookId or the service throws AccountingError(400).
    await assert.rejects(
      () =>
        addEntry(
          {
            date: "2026-04-01",
            lines: [
              { accountCode: "1000", debit: 100 },
              { accountCode: "4000", credit: 100 },
            ],
          },
          root,
        ),
      AccountingError,
    );
  });
  it("deleteBook without confirm: true is rejected", async () => {
    const root = makeTmp();
    const first = await createBook({ name: "A" }, root);
    await createBook({ name: "B" }, root);
    await assert.rejects(() => deleteBook({ bookId: first.book.id, confirm: false }, root), AccountingError);
  });
});

describe("addEntry / listEntries", () => {
  it("appends, lists, and rejects unbalanced", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    const entry = await addEntry(
      {
        bookId,
        date: "2026-04-01",
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "4000", credit: 100 },
        ],
      },
      root,
    );
    assert.equal(entry.entry.kind, "normal");
    const list = await listEntries({ bookId }, root);
    assert.equal(list.entries.length, 1);
    await assert.rejects(
      () =>
        addEntry(
          {
            bookId,
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
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    const added = await addEntry(
      {
        bookId,
        date: "2026-04-01",
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "4000", credit: 100 },
        ],
      },
      root,
    );
    await voidEntry({ bookId, entryId: added.entry.id, reason: "typo" }, root);
    const list = await listEntries({ bookId }, root);
    // Original + reverse + marker = 3 rows
    assert.equal(list.entries.length, 3);
    assert.ok(list.entries.some((entry) => entry.kind === "void"));
    assert.ok(list.entries.some((entry) => entry.kind === "void-marker"));
    assert.deepEqual(list.voidedEntryIds, [added.entry.id]);
  });
  it("listEntries: voidedEntryIds covers void-markers even when an account filter excludes them", async () => {
    // Regression for the JournalList strikeout bug: filtering by
    // accountCode drops the void-marker row (no lines), so the
    // client must NOT derive voidedEntryIds from the filtered list.
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    const added = await addEntry(
      {
        bookId,
        date: "2026-04-01",
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "4000", credit: 100 },
        ],
      },
      root,
    );
    await voidEntry({ bookId, entryId: added.entry.id, reason: "typo" }, root);
    const filtered = await listEntries({ bookId, accountCode: "1000" }, root);
    // Void-marker has empty lines so it's filtered out; original + reverse remain.
    assert.equal(
      filtered.entries.some((entry) => entry.kind === "void-marker"),
      false,
    );
    // But the server still surfaces the voided id so the View can strike out the original.
    assert.deepEqual(filtered.voidedEntryIds, [added.entry.id]);
  });
});

describe("opening balances", () => {
  it("sets opening, rejects when post-dated entries exist, replaces existing on second call", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    await setOpeningBalances(
      {
        bookId,
        asOfDate: "2026-01-01",
        lines: [
          { accountCode: "1000", debit: 1000 },
          { accountCode: "3000", credit: 1000 },
        ],
      },
      root,
    );
    let opening = await getOpeningBalances({ bookId }, root);
    assert.ok(opening.opening);
    assert.equal(opening.opening.kind, "opening");
    // Replace it.
    const second = await setOpeningBalances(
      {
        bookId,
        asOfDate: "2026-01-01",
        lines: [
          { accountCode: "1000", debit: 1500 },
          { accountCode: "3000", credit: 1500 },
        ],
      },
      root,
    );
    assert.equal(second.replacedExisting, true);
    opening = await getOpeningBalances({ bookId }, root);
    assert.ok(opening.opening);
    assert.equal(opening.opening.lines[0].debit, 1500);
    // Now book a normal entry after opening, then try to set
    // opening again at a date that pre-dates the new entry — must
    // refuse.
    await addEntry(
      {
        bookId,
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
            bookId,
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
    const book = await createBook({ name: "Test" }, root);
    await assert.rejects(
      () =>
        setOpeningBalances(
          {
            bookId: book.book.id,
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
  it("opening + expense produces a balanced B/S (regression: synthetic Current period earnings row)", async () => {
    // The user reported: enter opening 50,000 USD in Checking,
    // post one expense (printer 200.20 USD), open Balance Sheet
    // → imbalance 200.20. The fix adds a synthetic earnings row.
    const root = makeTmp();
    const book = await createBook({ name: "Pervasive" }, root);
    const bookId = book.book.id;
    await setOpeningBalances(
      {
        bookId,
        asOfDate: "2026-04-01",
        lines: [
          { accountCode: "1010", debit: 50000 },
          { accountCode: "3100", credit: 50000 },
        ],
      },
      root,
    );
    await addEntry(
      {
        bookId,
        date: "2026-04-08",
        lines: [
          { accountCode: "5400", debit: 200.2 },
          { accountCode: "1010", credit: 200.2 },
        ],
        memo: "Printer",
      },
      root,
    );
    await drainRebuilds(bookId);
    const report = await getBalanceSheetReport({ bookId, period: { kind: "month", period: "2026-04" } }, root);
    assert.ok(Math.abs(report.balanceSheet.imbalance) < 0.0001, `imbalance was ${report.balanceSheet.imbalance}`);
    const equity = report.balanceSheet.sections.find((section) => section.type === "equity");
    assert.ok(equity);
    const earningsRow = equity.rows.find((row) => row.accountCode === "_currentEarnings");
    assert.ok(earningsRow);
    assert.ok(Math.abs(earningsRow.balance + 200.2) < 0.0001);
  });
  it("opening + a few entries → consistent B/S and P/L", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    await setOpeningBalances(
      {
        bookId,
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
        bookId,
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
        bookId,
        date: "2026-04-20",
        lines: [
          { accountCode: "5100", debit: 70 },
          { accountCode: "1000", credit: 70 },
        ],
      },
      root,
    );
    await drainRebuilds(bookId);
    const balanceSheet = await getBalanceSheetReport({ bookId, period: { kind: "month", period: "2026-04" } }, root);
    const cashRow = balanceSheet.balanceSheet.sections[0].rows.find((row) => row.accountCode === "1000");
    assert.ok(cashRow);
    // Cash = 1000 (opening) + 200 (sales) - 70 (rent) = 1130
    assert.equal(cashRow.balance, 1130);
    const profitLoss = await getProfitLossReport({ bookId, period: { kind: "month", period: "2026-04" } }, root);
    assert.equal(profitLoss.profitLoss.income.total, 200);
    assert.equal(profitLoss.profitLoss.expense.total, 70);
    assert.equal(profitLoss.profitLoss.netIncome, 130);
  });
});
