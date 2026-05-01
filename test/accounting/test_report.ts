import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aggregateBalances, buildBalanceSheet, buildLedger, buildProfitLoss } from "../../server/accounting/report.js";
import { makeEntry, makeVoidEntries } from "../../server/accounting/journal.js";
import type { Account } from "../../server/accounting/types.js";

const ACCOUNTS: Account[] = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1100", name: "Receivable", type: "asset" },
  { code: "2000", name: "AP", type: "liability" },
  { code: "3000", name: "Equity", type: "equity" },
  { code: "4000", name: "Sales", type: "income" },
  { code: "5000", name: "Rent", type: "expense" },
];

function findAccount(code: string): Account {
  const acct = ACCOUNTS.find((account) => account.code === code);
  if (!acct) throw new Error(`fixture missing account ${code}`);
  return acct;
}

describe("aggregateBalances", () => {
  it("nets debit minus credit per account, sorted by code", () => {
    const entryA = makeEntry({
      date: "2026-04-01",
      lines: [
        { accountCode: "1000", debit: 100 },
        { accountCode: "4000", credit: 100 },
      ],
    });
    const entryB = makeEntry({
      date: "2026-04-15",
      lines: [
        { accountCode: "5000", debit: 30 },
        { accountCode: "1000", credit: 30 },
      ],
    });
    const balances = aggregateBalances([entryA, entryB]);
    const byCode = Object.fromEntries(balances.map((row) => [row.accountCode, row.netDebit]));
    assert.equal(byCode["1000"], 70); // +100 -30
    assert.equal(byCode["4000"], -100); // 0 - 100 (income credit-positive presents as +100)
    assert.equal(byCode["5000"], 30);
    // Sorted by code:
    assert.deepEqual(
      balances.map((row) => row.accountCode),
      ["1000", "4000", "5000"],
    );
  });
  it("excludes voided originals (math cancels via reverse)", () => {
    const original = makeEntry({
      date: "2026-04-01",
      lines: [
        { accountCode: "1000", debit: 100 },
        { accountCode: "4000", credit: 100 },
      ],
    });
    const { reverse, marker } = makeVoidEntries(original, "test", "2026-04-30");
    const balances = aggregateBalances([original, reverse, marker]);
    // Net effect of original-and-reverse should be zero on every
    // referenced account. Cash and Sales should not appear (they
    // round to 0).
    for (const row of balances) {
      assert.ok(Math.abs(row.netDebit) < 0.0001, `expected zero on ${row.accountCode}, got ${row.netDebit}`);
    }
  });
});

describe("buildBalanceSheet", () => {
  it("balances during the period by adding a synthetic Current period earnings row", () => {
    // Reproduces the imbalance scenario the user reported: opening
    // sets Cash = 50000 / Equity = 50000, then a 200.20 expense is
    // booked (Office Supplies dr / Cash cr). Without the synthetic
    // earnings row the B/S would show Assets 49,799.80 vs
    // Equity 50,000 → imbalance 200.20. With the row, Equity drops
    // to 49,799.80 and the equation holds.
    const opening = makeEntry({
      date: "2026-01-01",
      kind: "opening",
      lines: [
        { accountCode: "1010", debit: 50000 },
        { accountCode: "3100", credit: 50000 },
      ],
    });
    const expense = makeEntry({
      date: "2026-04-08",
      lines: [
        { accountCode: "5000", debit: 200.2 },
        { accountCode: "1010", credit: 200.2 },
      ],
    });
    const balances = aggregateBalances([opening, expense]);
    const accounts: Account[] = [
      { code: "1010", name: "Bank", type: "asset" },
      { code: "3100", name: "Retained Earnings", type: "equity" },
      { code: "5000", name: "Office Supplies", type: "expense" },
    ];
    const balanceSheet = buildBalanceSheet({ accounts, balances, asOf: "2026-04-30" });
    const equity = balanceSheet.sections.find((section) => section.type === "equity");
    assert.ok(equity);
    const earningsRow = equity.rows.find((row) => row.accountCode === "_currentEarnings");
    assert.ok(earningsRow, "expected a Current period earnings row");
    assert.ok(Math.abs(earningsRow.balance + 200.2) < 0.0001, `earnings should be -200.20, got ${earningsRow.balance}`);
    assert.ok(Math.abs(balanceSheet.imbalance) < 0.0001, `B/S should balance, got imbalance ${balanceSheet.imbalance}`);
  });
  it("omits the earnings row when there is no income / expense activity", () => {
    const opening = makeEntry({
      date: "2026-01-01",
      kind: "opening",
      lines: [
        { accountCode: "1010", debit: 50000 },
        { accountCode: "3100", credit: 50000 },
      ],
    });
    const balances = aggregateBalances([opening]);
    const accounts: Account[] = [
      { code: "1010", name: "Bank", type: "asset" },
      { code: "3100", name: "Retained Earnings", type: "equity" },
      { code: "5000", name: "Office Supplies", type: "expense" },
    ];
    const balanceSheet = buildBalanceSheet({ accounts, balances, asOf: "2026-01-31" });
    const equity = balanceSheet.sections.find((section) => section.type === "equity");
    assert.ok(equity);
    const earningsRow = equity.rows.find((row) => row.accountCode === "_currentEarnings");
    assert.equal(earningsRow, undefined, "no earnings row should be added when net income is zero");
  });
  it("presents B/S with natural signs and computes imbalance", () => {
    const opening = makeEntry({
      date: "2026-01-01",
      kind: "opening",
      lines: [
        { accountCode: "1000", debit: 1000 },
        { accountCode: "2000", credit: 400 },
        { accountCode: "3000", credit: 600 },
      ],
    });
    const balances = aggregateBalances([opening]);
    const balanceSheet = buildBalanceSheet({ accounts: ACCOUNTS, balances, asOf: "2026-01-31" });
    const assets = balanceSheet.sections.find((section) => section.type === "asset");
    const liabilities = balanceSheet.sections.find((section) => section.type === "liability");
    const equity = balanceSheet.sections.find((section) => section.type === "equity");
    assert.ok(assets && liabilities && equity);
    assert.equal(assets.total, 1000);
    assert.equal(liabilities.total, 400);
    assert.equal(equity.total, 600);
    assert.ok(Math.abs(balanceSheet.imbalance) < 0.001);
  });
});

describe("buildProfitLoss", () => {
  it("filters by date range and computes net income", () => {
    const beforeRange = makeEntry({
      date: "2026-03-15", // before range
      lines: [
        { accountCode: "1000", debit: 50 },
        { accountCode: "4000", credit: 50 },
      ],
    });
    const sale = makeEntry({
      date: "2026-04-10",
      lines: [
        { accountCode: "1000", debit: 200 },
        { accountCode: "4000", credit: 200 },
      ],
    });
    const expense = makeEntry({
      date: "2026-04-20",
      lines: [
        { accountCode: "5000", debit: 70 },
        { accountCode: "1000", credit: 70 },
      ],
    });
    const profitLoss = buildProfitLoss({
      accounts: ACCOUNTS,
      entries: [beforeRange, sale, expense],
      from: "2026-04-01",
      to: "2026-04-30",
    });
    assert.equal(profitLoss.income.total, 200);
    assert.equal(profitLoss.expense.total, 70);
    assert.equal(profitLoss.netIncome, 130);
  });
});

describe("buildLedger", () => {
  it("emits running balance per row and matches closing", () => {
    const entryA = makeEntry({
      date: "2026-04-01",
      lines: [
        { accountCode: "1000", debit: 100 },
        { accountCode: "4000", credit: 100 },
      ],
    });
    const entryB = makeEntry({
      date: "2026-04-15",
      lines: [
        { accountCode: "1000", credit: 30 },
        { accountCode: "5000", debit: 30 },
      ],
    });
    const cash = findAccount("1000");
    const ledger = buildLedger({ account: cash, entries: [entryA, entryB] });
    assert.equal(ledger.rows.length, 2);
    assert.equal(ledger.rows[0].runningBalance, 100);
    assert.equal(ledger.rows[1].runningBalance, 70);
    assert.equal(ledger.closingBalance, 70);
  });
});
