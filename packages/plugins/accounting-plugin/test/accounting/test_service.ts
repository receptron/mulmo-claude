import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AccountingError,
  addEntries,
  createBook,
  deleteBook,
  getBalanceSheetReport,
  getOpeningBalances,
  getProfitLossReport,
  listBooks,
  listEntries,
  setOpeningBalances,
  updateBook,
  voidEntry,
} from "../../src/server/service.js";
import { _resetRebuildQueueForTesting, awaitRebuildIdle } from "../../src/server/snapshotCache.js";

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

// The service rejects a non-string name — but only if it still looks non-string
// by the time it gets here. The router used to read `String(rest.name ?? "")`,
// which turns `{}` into "[object Object]": a perfectly non-empty string that
// sails past this guard and names the book that. These pin the guard so it
// stays the thing a caller must not defeat.
describe("createBook name validation", () => {
  it("rejects a missing or blank name", async () => {
    const root = makeTmp();
    await assert.rejects(() => createBook({ name: "" }, root), AccountingError);
    await assert.rejects(() => createBook({ name: "   " }, root), AccountingError);
  });

  it("rejects a non-string name rather than stringifying it", async () => {
    const root = makeTmp();
    for (const notAName of [{ nested: true }, ["a"], 42, null]) {
      await assert.rejects(() => createBook({ name: notAName as unknown as string }, root), AccountingError, `should reject ${JSON.stringify(notAName)}`);
    }
  });

  it("would have accepted the stringified form — which is why the router must not stringify", async () => {
    const root = makeTmp();
    // Documents the hole rather than asserting a wrong behaviour: this string
    // IS valid as far as the service is concerned, so the only defence is the
    // caller passing the value through untouched.
    const result = await createBook({ name: String({ nested: true }) }, root);
    assert.equal(result.book.name, "[object Object]");
  });
});

describe("upsertAccount synthetic-code guard", () => {
  it("rejects account codes starting with _ (reserved for synthetic rows)", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    const { upsertAccount } = await import("../../src/server/service.js");
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
    const { upsertAccount } = await import("../../src/server/service.js");
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
    const { upsertAccount } = await import("../../src/server/service.js");
    await upsertAccount({ bookId: book.book.id, account: { code: "1500", name: "Equipment", type: "asset", active: false } }, root);
    const reactivated = await upsertAccount({ bookId: book.book.id, account: { code: "1500", name: "Equipment", type: "asset", active: true } }, root);
    const account = reactivated.accounts.find((entry) => entry.code === "1500");
    assert.ok(account);
    assert.equal(account?.active, undefined, "explicit active=true should clear the persisted flag");
  });

  it("does not invent an active flag for accounts that never had one", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    const { upsertAccount } = await import("../../src/server/service.js");
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
        addEntries(
          {
            entries: [
              {
                date: "2026-04-01",
                lines: [
                  { accountCode: "1000", debit: 100 },
                  { accountCode: "4000", credit: 100 },
                ],
              },
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
  it("createBook persists country when supplied; updateBook can change it later", async () => {
    const root = makeTmp();
    const initial = await createBook({ name: "Tokyo Books", currency: "JPY", country: "JP" }, root);
    assert.equal(initial.book.country, "JP");
    const list = await listBooks(root);
    assert.equal(list.books[0].country, "JP");
    const updated = await updateBook({ bookId: initial.book.id, country: "US" }, root);
    assert.equal(updated.book.country, "US");
    // Cleared via empty-string sentinel — drops the field entirely.
    const cleared = await updateBook({ bookId: initial.book.id, country: "" }, root);
    assert.equal(cleared.book.country, undefined);
  });
  it("updateBook 404s on unknown bookId, 400s on empty name", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    await assert.rejects(() => updateBook({ bookId: "nope", name: "Y" }, root), AccountingError);
    await assert.rejects(() => updateBook({ bookId: book.book.id, name: "   " }, root), AccountingError);
  });
  it("rejects unsupported country codes at every ingress", async () => {
    // Pin the enum guard. `createBook` and `updateBook` both narrow
    // through `isSupportedCountryCode`; a typo or an obsolete code
    // must 400 rather than land on disk and propagate to the role
    // prompt's per-jurisdiction switch.
    const root = makeTmp();
    await assert.rejects(() => createBook({ name: "Bad", country: "ZZ" }, root), AccountingError);
    await assert.rejects(() => createBook({ name: "Bad", country: "japan" }, root), AccountingError);
    const book = await createBook({ name: "Good", country: "JP" }, root);
    await assert.rejects(() => updateBook({ bookId: book.book.id, country: "ZZ" }, root), AccountingError);
  });
  it("createBook defaults fiscalYearEnd to December (12); updateBook persists an arbitrary month", async () => {
    const root = makeTmp();
    const defaultFy = await createBook({ name: "Default FY" }, root);
    assert.equal(defaultFy.book.fiscalYearEnd, 12);
    // A corporation closing on August 31 stores 8 — an arbitrary
    // (non-calendar-quarter) month-end.
    const explicit = await createBook({ name: "August FY", fiscalYearEnd: 8 }, root);
    assert.equal(explicit.book.fiscalYearEnd, 8);
    const updated = await updateBook({ bookId: defaultFy.book.id, fiscalYearEnd: 3 }, root);
    assert.equal(updated.book.fiscalYearEnd, 3);
    const list = await listBooks(root);
    const persisted = list.books.find((entry) => entry.id === defaultFy.book.id);
    assert.equal(persisted?.fiscalYearEnd, 3);
  });
  it("rejects out-of-range fiscalYearEnd values", async () => {
    const root = makeTmp();
    await assert.rejects(() => createBook({ name: "Bad", fiscalYearEnd: 13 }, root), AccountingError);
    const book = await createBook({ name: "Good" }, root);
    await assert.rejects(() => updateBook({ bookId: book.book.id, fiscalYearEnd: 0 }, root), AccountingError);
    // Non-integer month is rejected too.
    await assert.rejects(() => updateBook({ bookId: book.book.id, fiscalYearEnd: 8.5 }, root), AccountingError);
  });
  it("coerces ingress fiscalYearEnd: numeric string and legacy Q token; rejects garbage", async () => {
    const root = makeTmp();
    // A hand-rolled client / stale caller may send a string.
    const numeric = await createBook({ name: "Numeric", fiscalYearEnd: "8" }, root);
    assert.equal(numeric.book.fiscalYearEnd, 8);
    // A stale client posting the old calendar-quarter token migrates to
    // its closing month (Q1 → March) instead of silently defaulting.
    const legacy = await createBook({ name: "Legacy", fiscalYearEnd: "Q1" }, root);
    assert.equal(legacy.book.fiscalYearEnd, 3);
    const updated = await updateBook({ bookId: numeric.book.id, fiscalYearEnd: "Q4" }, root);
    assert.equal(updated.book.fiscalYearEnd, 12);
    // Garbage must 400, NOT be swallowed as the December default (create)
    // or a silent no-op (update).
    await assert.rejects(() => createBook({ name: "Junk", fiscalYearEnd: "abc" }, root), AccountingError);
    await assert.rejects(() => updateBook({ bookId: numeric.book.id, fiscalYearEnd: "abc" }, root), AccountingError);
    await assert.rejects(() => updateBook({ bookId: numeric.book.id, fiscalYearEnd: true }, root), AccountingError);
  });
  it("treats an empty-string fiscalYearEnd as omitted (no-op on update, default on create)", async () => {
    const root = makeTmp();
    // Empty string is the "field omitted" sentinel — create defaults to
    // December, update leaves the existing value untouched.
    const emptyBook = await createBook({ name: "Empty", fiscalYearEnd: "" }, root);
    assert.equal(emptyBook.book.fiscalYearEnd, 12);
    await updateBook({ bookId: emptyBook.book.id, fiscalYearEnd: 8 }, root);
    const updated = await updateBook({ bookId: emptyBook.book.id, name: "Empty renamed", fiscalYearEnd: "" }, root);
    assert.equal(updated.book.fiscalYearEnd, 8); // unchanged by the ""
  });
});

describe("addEntries / listEntries", () => {
  it("appends, lists, and rejects unbalanced", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    const result = await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-04-01",
            lines: [
              { accountCode: "1000", debit: 100 },
              { accountCode: "4000", credit: 100 },
            ],
          },
        ],
      },
      root,
    );
    assert.equal(result.entries[0].kind, "normal");
    const list = await listEntries({ bookId }, root);
    assert.equal(list.entries.length, 1);
    await assert.rejects(
      () =>
        addEntries(
          {
            bookId,
            entries: [
              {
                date: "2026-04-02",
                lines: [
                  { accountCode: "1000", debit: 100 },
                  { accountCode: "4000", credit: 90 },
                ],
              },
            ],
          },
          root,
        ),
      AccountingError,
    );
  });

  it("posts a multi-entry batch atomically and surfaces each id", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    const batch = await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-04-01",
            lines: [
              { accountCode: "1000", debit: 100 },
              { accountCode: "4000", credit: 100 },
            ],
          },
          {
            date: "2026-04-02",
            lines: [
              { accountCode: "5000", debit: 30 },
              { accountCode: "1000", credit: 30 },
            ],
          },
        ],
      },
      root,
    );
    assert.equal(batch.entries.length, 2);
    assert.notEqual(batch.entries[0].id, batch.entries[1].id);
    // Both entries share the 2026-04 period — appendJournalBatch
    // concatenates same-period entries into a single appendFile
    // call (one O_APPEND syscall, atomic under PIPE_BUF), so a
    // direct read surfaces both entries from one write.
    const journalFile = path.join(root, "data/accounting/books", bookId, "journal", "2026-04.jsonl");
    const raw = await fsPromises.readFile(journalFile, "utf-8");
    const lines = raw.split("\n").filter((line) => line !== "");
    assert.equal(lines.length, 2, "same-period batch must land in one JSONL with both entries");
    await drainRebuilds(bookId);
    const list = await listEntries({ bookId }, root);
    assert.equal(list.entries.length, 2);
  });

  it("multi-period batch lands one file per period", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-04-15",
            lines: [
              { accountCode: "1000", debit: 100 },
              { accountCode: "4000", credit: 100 },
            ],
          },
          {
            date: "2026-05-15",
            lines: [
              { accountCode: "5000", debit: 50 },
              { accountCode: "1000", credit: 50 },
            ],
          },
        ],
      },
      root,
    );
    const aprilFile = path.join(root, "data/accounting/books", bookId, "journal", "2026-04.jsonl");
    const mayFile = path.join(root, "data/accounting/books", bookId, "journal", "2026-05.jsonl");
    const aprilLines = (await fsPromises.readFile(aprilFile, "utf-8")).split("\n").filter((line) => line !== "");
    const mayLines = (await fsPromises.readFile(mayFile, "utf-8")).split("\n").filter((line) => line !== "");
    assert.equal(aprilLines.length, 1, "April file should contain the April entry");
    assert.equal(mayLines.length, 1, "May file should contain the May entry");
  });

  it("concurrent same-period batches do not lose entries (O_APPEND serialisation)", async () => {
    // Regression for the read-modify-write race the first iteration
    // of appendJournalBatch had: parallel addEntries calls into the
    // same period must both land in full, with no overwrite.
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    const makeBatch = (offset: number) =>
      addEntries(
        {
          bookId,
          entries: Array.from({ length: 5 }, (_, idx) => ({
            date: "2026-04-10",
            lines: [
              { accountCode: "1000", debit: offset + idx + 1 },
              { accountCode: "4000", credit: offset + idx + 1 },
            ],
          })),
        },
        root,
      );
    await Promise.all([makeBatch(0), makeBatch(100), makeBatch(200)]);
    await drainRebuilds(bookId);
    const list = await listEntries({ bookId }, root);
    assert.equal(list.entries.length, 15, "every entry from every concurrent batch must persist");
  });

  it("rejects the whole batch when any entry is invalid (no partial write)", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    await assert.rejects(
      () =>
        addEntries(
          {
            bookId,
            entries: [
              {
                date: "2026-04-01",
                lines: [
                  { accountCode: "1000", debit: 100 },
                  { accountCode: "4000", credit: 100 },
                ],
              },
              {
                date: "2026-04-02",
                lines: [
                  { accountCode: "1000", debit: 100 },
                  { accountCode: "4000", credit: 90 }, // unbalanced
                ],
              },
            ],
          },
          root,
        ),
      AccountingError,
    );
    const list = await listEntries({ bookId }, root);
    assert.equal(list.entries.length, 0, "no entries should land when any item in the batch fails validation");
  });

  it("round-trips taxRegistrationId through addEntries → listEntries", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-04-01",
            lines: [
              { accountCode: "1000", debit: 100, taxRegistrationId: "T1234567890123" },
              { accountCode: "4000", credit: 100 },
            ],
          },
        ],
      },
      root,
    );
    await drainRebuilds(bookId);
    const list = await listEntries({ bookId }, root);
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0].lines[0].taxRegistrationId, "T1234567890123");
    assert.equal(list.entries[0].lines[1].taxRegistrationId, undefined);
  });

  it("rejects an entry whose taxRegistrationId exceeds the length cap", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    await assert.rejects(
      () =>
        addEntries(
          {
            bookId,
            entries: [
              {
                date: "2026-04-01",
                lines: [
                  { accountCode: "1000", debit: 100, taxRegistrationId: "T".repeat(33) },
                  { accountCode: "4000", credit: 100 },
                ],
              },
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
    const added = await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-04-01",
            lines: [
              { accountCode: "1000", debit: 100 },
              { accountCode: "4000", credit: 100 },
            ],
          },
        ],
      },
      root,
    );
    const [addedEntry] = added.entries;
    await voidEntry({ bookId, entryId: addedEntry.id, reason: "typo" }, root);
    const list = await listEntries({ bookId }, root);
    // Original + reverse + marker = 3 rows
    assert.equal(list.entries.length, 3);
    assert.ok(list.entries.some((entry) => entry.kind === "void"));
    assert.ok(list.entries.some((entry) => entry.kind === "void-marker"));
    assert.deepEqual(list.voidedEntryIds, [addedEntry.id]);
  });
  // Regression for makeVoidEntries — when the original entry has
  // a tax-line carrying `taxRegistrationId`, the reverse entry MUST
  // copy that ID over so the audit trail (T-number / VAT ID /
  // GSTIN) survives the void. Without this the input-tax-credit
  // documentation would silently drop on void and a later report
  // scan couldn't reconstruct which counterparty the original
  // input-tax line was tied to. CodeRabbit review on PR #1120.
  it("preserves taxRegistrationId on the reverse entry when voiding a tax-bearing entry", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    const added = await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-04-01",
            lines: [
              { accountCode: "1400", debit: 10, taxRegistrationId: "T1234567890123" },
              { accountCode: "5000", debit: 100 },
              { accountCode: "1000", credit: 110 },
            ],
          },
        ],
      },
      root,
    );
    const voided = await voidEntry({ bookId, entryId: added.entries[0].id, reason: "typo" }, root);
    const reversedTaxLine = voided.reverseEntry.lines.find((line) => line.accountCode === "1400");
    assert.ok(reversedTaxLine, "reverse entry must contain the 1400 line");
    assert.equal(reversedTaxLine.taxRegistrationId, "T1234567890123");
    // Counter-line that didn't carry the ID stays clean (no leak).
    const reversedExpense = voided.reverseEntry.lines.find((line) => line.accountCode === "5000");
    assert.equal(reversedExpense?.taxRegistrationId, undefined);
  });
  it("listEntries: voidedEntryIds covers void-markers even when an account filter excludes them", async () => {
    // Regression for the JournalList strikeout bug: filtering by
    // accountCode drops the void-marker row (no lines), so the
    // client must NOT derive voidedEntryIds from the filtered list.
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    const added = await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-04-01",
            lines: [
              { accountCode: "1000", debit: 100 },
              { accountCode: "4000", credit: 100 },
            ],
          },
        ],
      },
      root,
    );
    const [addedEntry] = added.entries;
    await voidEntry({ bookId, entryId: addedEntry.id, reason: "typo" }, root);
    const filtered = await listEntries({ bookId, accountCode: "1000" }, root);
    // Void-marker has empty lines so it's filtered out; original + reverse remain.
    assert.equal(
      filtered.entries.some((entry) => entry.kind === "void-marker"),
      false,
    );
    // But the server still surfaces the voided id so the View can strike out the original.
    assert.deepEqual(filtered.voidedEntryIds, [addedEntry.id]);
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
    await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-02-01",
            lines: [
              { accountCode: "1000", debit: 50 },
              { accountCode: "4000", credit: 50 },
            ],
          },
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
    await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-04-08",
            lines: [
              { accountCode: "5400", debit: 200.2 },
              { accountCode: "1010", credit: 200.2 },
            ],
            memo: "Printer",
          },
        ],
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
    await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2026-04-10",
            lines: [
              { accountCode: "1000", debit: 200 },
              { accountCode: "4000", credit: 200 },
            ],
          },
          {
            date: "2026-04-20",
            lines: [
              { accountCode: "5100", debit: 70 },
              { accountCode: "1000", credit: 70 },
            ],
          },
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
