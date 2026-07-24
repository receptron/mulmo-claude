import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  appendJournal,
  bookExists,
  ensureBookDir,
  invalidateAllSnapshots,
  invalidateSnapshotsFrom,
  listJournalPeriods,
  periodFromDate,
  readAccounts,
  readConfig,
  readJournalMonth,
  readSnapshot,
  removeBookDir,
  writeAccounts,
  writeConfig,
  writeSnapshot,
} from "../../src/server/io.js";
import type { JournalEntry } from "../../src/shared/types.js";

const created: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmo-acct-io-"));
  created.push(dir);
  return dir;
}
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

const sampleEntry = (date: string, entryId: string): JournalEntry => ({
  id: entryId,
  date,
  kind: "normal",
  lines: [
    { accountCode: "1000", debit: 100 },
    { accountCode: "4000", credit: 100 },
  ],
  createdAt: "2026-04-30T10:00:00.000Z",
});

describe("periodFromDate", () => {
  it("YYYY-MM-DD → YYYY-MM", () => {
    assert.equal(periodFromDate("2026-04-15"), "2026-04");
  });
  it("rejects malformed input", () => {
    assert.throws(() => periodFromDate("2026-4-15"));
    assert.throws(() => periodFromDate("not-a-date"));
  });
});

describe("config.json", () => {
  it("returns null when missing, round-trips when written", async () => {
    const root = makeTmp();
    assert.equal(await readConfig(root), null);
    const cfg = { books: [{ id: "default", name: "Default", currency: "USD", createdAt: "2026-04-30T00:00:00Z" }] };
    await writeConfig(cfg, root);
    assert.deepEqual(await readConfig(root), cfg);
  });
  it("normalises a legacy Q1..Q4 fiscalYearEnd token to its closing month on read", async () => {
    const root = makeTmp();
    // Simulate a book written before fiscalYearEnd became a month
    // number — the on-disk value is a calendar-quarter token.
    const legacy = {
      books: [
        { id: "legacy", name: "Legacy", currency: "JPY", fiscalYearEnd: "Q1", createdAt: "2026-04-30T00:00:00Z" },
        { id: "modern", name: "Modern", currency: "USD", fiscalYearEnd: 8, createdAt: "2026-04-30T00:00:00Z" },
        { id: "unset", name: "Unset", currency: "EUR", createdAt: "2026-04-30T00:00:00Z" },
      ],
    };
    await writeConfig(legacy as never, root);
    const read = await readConfig(root);
    assert.equal(read?.books[0].fiscalYearEnd, 3); // "Q1" → March close
    assert.equal(read?.books[1].fiscalYearEnd, 8); // already a month — untouched
    assert.equal(read?.books[2].fiscalYearEnd, undefined); // absent stays absent
  });
});

describe("accounts.json", () => {
  it("returns [] for unknown book, round-trips when written", async () => {
    const root = makeTmp();
    await ensureBookDir("default", root);
    assert.deepEqual(await readAccounts("default", root), []);
    const accounts = [{ code: "1000", name: "Cash", type: "asset" as const }];
    await writeAccounts("default", accounts, root);
    assert.deepEqual(await readAccounts("default", root), accounts);
  });
});

describe("journal append + read", () => {
  it("appends multiple entries to the right month file", async () => {
    const root = makeTmp();
    await ensureBookDir("default", root);
    await appendJournal("default", sampleEntry("2026-04-01", "entry-a"), root);
    await appendJournal("default", sampleEntry("2026-04-15", "entry-b"), root);
    await appendJournal("default", sampleEntry("2026-05-02", "entry-c"), root);
    const apr = await readJournalMonth("default", "2026-04", root);
    const may = await readJournalMonth("default", "2026-05", root);
    assert.equal(apr.entries.length, 2);
    assert.equal(may.entries.length, 1);
    assert.equal(apr.entries[0].id, "entry-a");
    assert.equal(may.entries[0].id, "entry-c");
  });
  it("survives many appends (no torn writes)", async () => {
    const root = makeTmp();
    await ensureBookDir("default", root);
    for (let idx = 0; idx < 100; idx++) {
      await appendJournal("default", sampleEntry("2026-04-01", `entry-${idx}`), root);
    }
    const apr = await readJournalMonth("default", "2026-04", root);
    assert.equal(apr.entries.length, 100);
    assert.equal(apr.skipped, 0);
  });
  it("skips malformed lines without aborting", async () => {
    const root = makeTmp();
    await ensureBookDir("default", root);
    await appendJournal("default", sampleEntry("2026-04-01", "good"), root);
    // Inject a bad line by writing the raw file with invalid JSON
    // mixed in. Direct fs is fine in tests — production code goes
    // through the IO module.
    const fsModule = await import("node:fs/promises");
    const file = path.join(root, "data/accounting/books/default/journal/2026-04.jsonl");
    const existing = await fsModule.readFile(file, "utf-8");
    await fsModule.writeFile(file, `${existing}{not-json\n`);
    const result = await readJournalMonth("default", "2026-04", root);
    assert.equal(result.entries.length, 1);
    assert.equal(result.skipped, 1);
  });
  it("listJournalPeriods returns sorted YYYY-MM list", async () => {
    const root = makeTmp();
    await ensureBookDir("default", root);
    await appendJournal("default", sampleEntry("2026-05-01", "alpha"), root);
    await appendJournal("default", sampleEntry("2026-04-01", "beta"), root);
    await appendJournal("default", sampleEntry("2026-06-01", "gamma"), root);
    assert.deepEqual(await listJournalPeriods("default", root), ["2026-04", "2026-05", "2026-06"]);
  });
  it("round-trips taxRegistrationId on a line and omits it when absent", async () => {
    const root = makeTmp();
    await ensureBookDir("default", root);
    const entry: JournalEntry = {
      id: "with-tax-id",
      date: "2026-04-01",
      kind: "normal",
      lines: [
        { accountCode: "1000", debit: 100, taxRegistrationId: "T1234567890123" },
        { accountCode: "4000", credit: 100 },
      ],
      createdAt: "2026-04-30T10:00:00.000Z",
    };
    await appendJournal("default", entry, root);
    const apr = await readJournalMonth("default", "2026-04", root);
    assert.equal(apr.entries.length, 1);
    assert.equal(apr.entries[0].lines[0].taxRegistrationId, "T1234567890123");
    assert.equal(apr.entries[0].lines[1].taxRegistrationId, undefined);
    // The on-disk JSONL must not carry a "taxRegistrationId":""
    // sentinel for the line that didn't set it — JSON.stringify
    // drops undefined keys, which is the contract callers rely on
    // for backward-compatibility of older entries.
    const fsModule = await import("node:fs/promises");
    const file = path.join(root, "data/accounting/books/default/journal/2026-04.jsonl");
    const raw = await fsModule.readFile(file, "utf-8");
    assert.match(raw, /"taxRegistrationId":"T1234567890123"/);
    // Second line has no taxRegistrationId field at all on disk.
    const parsed = JSON.parse(raw.trim()) as { lines: { taxRegistrationId?: string }[] };
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.lines[1], "taxRegistrationId"), false);
  });
});

describe("snapshots", () => {
  it("read/write round-trip + invalidateSnapshotsFrom drops correct files", async () => {
    const root = makeTmp();
    await ensureBookDir("default", root);
    for (const period of ["2026-01", "2026-02", "2026-03", "2026-04"]) {
      await writeSnapshot("default", { period, balances: [], builtAt: "2026-04-30T00:00:00Z" }, root);
    }
    assert.equal((await readSnapshot("default", "2026-02", root))?.period, "2026-02");
    const result = await invalidateSnapshotsFrom("default", "2026-03", root);
    assert.deepEqual(result.removed, ["2026-03", "2026-04"]);
    assert.equal(await readSnapshot("default", "2026-03", root), null);
    assert.equal(await readSnapshot("default", "2026-04", root), null);
    assert.equal((await readSnapshot("default", "2026-02", root))?.period, "2026-02");
  });
  it("invalidateAllSnapshots wipes every snapshot", async () => {
    const root = makeTmp();
    await ensureBookDir("default", root);
    for (const period of ["2026-01", "2026-02", "2026-03"]) {
      await writeSnapshot("default", { period, balances: [], builtAt: "2026-04-30T00:00:00Z" }, root);
    }
    const result = await invalidateAllSnapshots("default", root);
    assert.deepEqual(result.removed, ["2026-01", "2026-02", "2026-03"]);
  });
});

describe("book directory housekeeping", () => {
  beforeEach(() => {
    /* each test creates its own tmp via makeTmp() — no shared state */
  });
  it("ensureBookDir + bookExists + removeBookDir", async () => {
    const root = makeTmp();
    assert.equal(await bookExists("default", root), false);
    await ensureBookDir("default", root);
    assert.equal(await bookExists("default", root), true);
    await removeBookDir("default", root);
    assert.equal(await bookExists("default", root), false);
  });
});
