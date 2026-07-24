import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bucketize, buildTimeSeries } from "../../src/server/timeSeries.js";
import { makeEntry, makeVoidEntries } from "../../src/server/journal.js";
import type { Account } from "../../src/shared/types.js";

const ACCOUNTS: Account[] = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "2000", name: "AP", type: "liability" },
  { code: "3000", name: "Equity", type: "equity" },
  { code: "4000", name: "Sales", type: "income" },
  { code: "5000", name: "Rent", type: "expense" },
  { code: "5100", name: "Utilities", type: "expense" },
];

// ── bucketize ─────────────────────────────────────────────────────

describe("bucketize — month granularity", () => {
  it("returns one bucket per calendar month, ignoring fiscalYearEnd", () => {
    const buckets = bucketize({ from: "2025-02-15", to: "2025-04-10", granularity: "month", fiscalYearEnd: 12 });
    assert.deepEqual(
      buckets.map((bucket) => bucket.label),
      ["2025-02", "2025-03", "2025-04"],
    );
    // First bucket extends to before `from`; last bucket extends past `to`.
    assert.equal(buckets[0].from, "2025-02-01");
    assert.equal(buckets[0].to, "2025-02-28");
    assert.equal(buckets[2].from, "2025-04-01");
    assert.equal(buckets[2].to, "2025-04-30");
  });

  it("handles February in a leap year", () => {
    const [feb] = bucketize({ from: "2024-02-15", to: "2024-02-15", granularity: "month", fiscalYearEnd: 12 });
    assert.equal(feb.to, "2024-02-29");
  });

  it("crosses calendar-year boundaries cleanly", () => {
    const buckets = bucketize({ from: "2024-12-15", to: "2025-01-05", granularity: "month", fiscalYearEnd: 12 });
    assert.deepEqual(
      buckets.map((bucket) => bucket.label),
      ["2024-12", "2025-01"],
    );
  });

  it("returns a single bucket when from and to land in the same month", () => {
    const buckets = bucketize({ from: "2025-06-02", to: "2025-06-29", granularity: "month", fiscalYearEnd: 12 });
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].label, "2025-06");
  });

  it("returns [] when from > to", () => {
    assert.deepEqual(bucketize({ from: "2025-04-01", to: "2025-03-31", granularity: "month", fiscalYearEnd: 12 }), []);
  });
});

describe("bucketize — quarter granularity, fiscalYearEnd shifts", () => {
  it("Q4 books align with calendar quarters and label by calendar year", () => {
    const buckets = bucketize({ from: "2025-01-01", to: "2025-12-31", granularity: "quarter", fiscalYearEnd: 12 });
    assert.deepEqual(
      buckets.map((bucket) => ({ label: bucket.label, from: bucket.from, to: bucket.to })),
      [
        { label: "FY2025-Q1", from: "2025-01-01", to: "2025-03-31" },
        { label: "FY2025-Q2", from: "2025-04-01", to: "2025-06-30" },
        { label: "FY2025-Q3", from: "2025-07-01", to: "2025-09-30" },
        { label: "FY2025-Q4", from: "2025-10-01", to: "2025-12-31" },
      ],
    );
  });

  it("Q1 books (March close) — Apr 2025 → Mar 2026 is FY2026", () => {
    // FY2026 runs Apr 2025 → Mar 2026 — labelled by its END year per
    // the plan / Japanese 令和N年度 convention.
    const buckets = bucketize({ from: "2025-04-01", to: "2026-03-31", granularity: "quarter", fiscalYearEnd: 3 });
    assert.deepEqual(
      buckets.map((bucket) => ({ label: bucket.label, from: bucket.from, to: bucket.to })),
      [
        { label: "FY2026-Q1", from: "2025-04-01", to: "2025-06-30" },
        { label: "FY2026-Q2", from: "2025-07-01", to: "2025-09-30" },
        { label: "FY2026-Q3", from: "2025-10-01", to: "2025-12-31" },
        { label: "FY2026-Q4", from: "2026-01-01", to: "2026-03-31" },
      ],
    );
  });

  it("Q2 books (June close) — Jul 2025 → Jun 2026 is FY2026", () => {
    const buckets = bucketize({ from: "2025-07-01", to: "2026-06-30", granularity: "quarter", fiscalYearEnd: 6 });
    assert.deepEqual(
      buckets.map((bucket) => bucket.label),
      ["FY2026-Q1", "FY2026-Q2", "FY2026-Q3", "FY2026-Q4"],
    );
    assert.equal(buckets[0].from, "2025-07-01");
    assert.equal(buckets[3].to, "2026-06-30");
  });

  it("August-close books (month 8) — fiscal quarters start in September", () => {
    // A non-calendar-quarter close (Aug 31). FY runs Sep 1 2025 →
    // Aug 31 2026, so the fiscal quarters are Sep-Nov / Dec-Feb /
    // Mar-May / Jun-Aug, all labelled by the FY's END calendar year.
    const buckets = bucketize({ from: "2025-09-01", to: "2026-08-31", granularity: "quarter", fiscalYearEnd: 8 });
    assert.deepEqual(
      buckets.map((bucket) => `${bucket.label} ${bucket.from}..${bucket.to}`),
      ["FY2026-Q1 2025-09-01..2025-11-30", "FY2026-Q2 2025-12-01..2026-02-28", "FY2026-Q3 2026-03-01..2026-05-31", "FY2026-Q4 2026-06-01..2026-08-31"],
    );
  });

  it("August-close books (month 8) — year bucket spans Sep → Aug", () => {
    const [bucket] = bucketize({ from: "2026-01-15", to: "2026-01-15", granularity: "year", fiscalYearEnd: 8 });
    assert.deepEqual({ label: bucket.label, from: bucket.from, to: bucket.to }, { label: "FY2026", from: "2025-09-01", to: "2026-08-31" });
  });

  it("expands the request to the containing quarter on both ends", () => {
    // from / to both mid-quarter in a Q4 book → the response covers
    // the full quarter, not the requested slice.
    const buckets = bucketize({ from: "2025-02-15", to: "2025-08-04", granularity: "quarter", fiscalYearEnd: 12 });
    assert.deepEqual(
      buckets.map((bucket) => `${bucket.from}..${bucket.to}`),
      ["2025-01-01..2025-03-31", "2025-04-01..2025-06-30", "2025-07-01..2025-09-30"],
    );
  });
});

describe("bucketize — year granularity", () => {
  it("Q4 books label by the calendar year", () => {
    const buckets = bucketize({ from: "2024-01-15", to: "2025-08-01", granularity: "year", fiscalYearEnd: 12 });
    assert.deepEqual(
      buckets.map((bucket) => ({ label: bucket.label, from: bucket.from, to: bucket.to })),
      [
        { label: "FY2024", from: "2024-01-01", to: "2024-12-31" },
        { label: "FY2025", from: "2025-01-01", to: "2025-12-31" },
      ],
    );
  });

  it("Q1 books label by the fiscal-year END calendar year", () => {
    // 2025-05-15 is in FY2026 (Apr 2025 → Mar 2026).
    const [bucket] = bucketize({ from: "2025-05-15", to: "2025-05-15", granularity: "year", fiscalYearEnd: 3 });
    assert.deepEqual(bucket, { label: "FY2026", from: "2025-04-01", to: "2026-03-31" });
  });

  it("Q1 books — a request mid-FY returns one FY bucket whose boundaries echo the FY, not the input", () => {
    const buckets = bucketize({ from: "2025-09-01", to: "2025-12-31", granularity: "year", fiscalYearEnd: 3 });
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].from, "2025-04-01");
    assert.equal(buckets[0].to, "2026-03-31");
    assert.equal(buckets[0].label, "FY2026");
  });
});

// ── buildTimeSeries ───────────────────────────────────────────────

// All buildTimeSeries tests use monthly Q4 buckets — keep the call
// sites short and dodge the id-length lint on `to: string` params.
function monthBuckets(fromDate: string, toDate: string): ReturnType<typeof bucketize> {
  return bucketize({ from: fromDate, to: toDate, granularity: "month", fiscalYearEnd: 12 });
}

describe("buildTimeSeries — revenue / expense / netIncome", () => {
  it("rolls up income per bucket as positive presentation values", () => {
    const entries = [
      makeEntry({
        date: "2025-01-15",
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "4000", credit: 100 },
        ],
      }),
      makeEntry({
        date: "2025-02-10",
        lines: [
          { accountCode: "1000", debit: 250 },
          { accountCode: "4000", credit: 250 },
        ],
      }),
      makeEntry({
        date: "2025-03-30",
        lines: [
          { accountCode: "1000", debit: 50 },
          { accountCode: "4000", credit: 50 },
        ],
      }),
    ];
    const points = buildTimeSeries({
      buckets: monthBuckets("2025-01-01", "2025-03-31"),
      entries,
      accounts: ACCOUNTS,
      metric: "revenue",
    });
    assert.deepEqual(
      points.map((point) => ({ label: point.label, value: point.value })),
      [
        { label: "2025-01", value: 100 },
        { label: "2025-02", value: 250 },
        { label: "2025-03", value: 50 },
      ],
    );
  });

  it("rolls up expense per bucket as positive cost values", () => {
    const entries = [
      makeEntry({
        date: "2025-01-05",
        lines: [
          { accountCode: "5000", debit: 1000 },
          { accountCode: "1000", credit: 1000 },
        ],
      }),
      makeEntry({
        date: "2025-02-05",
        lines: [
          { accountCode: "5100", debit: 200 },
          { accountCode: "1000", credit: 200 },
        ],
      }),
    ];
    const points = buildTimeSeries({
      buckets: monthBuckets("2025-01-01", "2025-02-28"),
      entries,
      accounts: ACCOUNTS,
      metric: "expense",
    });
    assert.deepEqual(
      points.map((point) => point.value),
      [1000, 200],
    );
  });

  it("netIncome = revenue − expense per bucket", () => {
    const entries = [
      // Jan: +1000 income, -300 expense → net +700
      makeEntry({
        date: "2025-01-10",
        lines: [
          { accountCode: "1000", debit: 1000 },
          { accountCode: "4000", credit: 1000 },
        ],
      }),
      makeEntry({
        date: "2025-01-20",
        lines: [
          { accountCode: "5000", debit: 300 },
          { accountCode: "1000", credit: 300 },
        ],
      }),
      // Feb: -500 expense only → net -500
      makeEntry({
        date: "2025-02-15",
        lines: [
          { accountCode: "5000", debit: 500 },
          { accountCode: "1000", credit: 500 },
        ],
      }),
    ];
    const points = buildTimeSeries({
      buckets: monthBuckets("2025-01-01", "2025-02-28"),
      entries,
      accounts: ACCOUNTS,
      metric: "netIncome",
    });
    assert.deepEqual(
      points.map((point) => point.value),
      [700, -500],
    );
  });

  it("returns 0 for buckets with no entries (continuous x-axis)", () => {
    const entries = [
      makeEntry({
        date: "2025-01-15",
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "4000", credit: 100 },
        ],
      }),
    ];
    const points = buildTimeSeries({
      buckets: monthBuckets("2025-01-01", "2025-03-31"),
      entries,
      accounts: ACCOUNTS,
      metric: "revenue",
    });
    assert.deepEqual(
      points.map((point) => point.value),
      [100, 0, 0],
    );
  });

  it("voided pairs cancel across the metric", () => {
    const original = makeEntry({
      date: "2025-01-10",
      lines: [
        { accountCode: "1000", debit: 500 },
        { accountCode: "4000", credit: 500 },
      ],
    });
    const { reverse, marker } = makeVoidEntries(original, "wrong amount", "2025-02-12");
    const points = buildTimeSeries({
      buckets: monthBuckets("2025-01-01", "2025-02-28"),
      entries: [original, reverse, marker],
      accounts: ACCOUNTS,
      metric: "revenue",
    });
    // Jan shows the original income; Feb shows the reversal cancelling
    // it. Sum across the series is zero.
    assert.equal(points[0].value, 500);
    assert.equal(points[1].value, -500);
    assert.equal(points[0].value + points[1].value, 0);
  });
});

describe("buildTimeSeries — accountBalance", () => {
  it("returns the closing balance at the end of each bucket (cumulative across buckets)", () => {
    const entries = [
      makeEntry({
        date: "2025-01-15",
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "4000", credit: 100 },
        ],
      }),
      makeEntry({
        date: "2025-02-15",
        lines: [
          { accountCode: "1000", debit: 50 },
          { accountCode: "4000", credit: 50 },
        ],
      }),
    ];
    const points = buildTimeSeries({
      buckets: monthBuckets("2025-01-01", "2025-03-31"),
      entries,
      accounts: ACCOUNTS,
      metric: "accountBalance",
      accountCode: "1000",
    });
    assert.deepEqual(
      points.map((point) => point.value),
      [100, 150, 150], // Jan: 100; Feb: 100+50; Mar: no new entries, balance carries.
    );
  });

  it("includes opening-balance entries in the cumulative running balance", () => {
    const opening = makeEntry({
      date: "2024-12-31",
      kind: "opening",
      lines: [
        { accountCode: "1000", debit: 1000 },
        { accountCode: "3000", credit: 1000 },
      ],
    });
    const newEntry = makeEntry({
      date: "2025-01-15",
      lines: [
        { accountCode: "1000", debit: 200 },
        { accountCode: "4000", credit: 200 },
      ],
    });
    const points = buildTimeSeries({
      buckets: monthBuckets("2025-01-01", "2025-02-28"),
      entries: [opening, newEntry],
      accounts: ACCOUNTS,
      metric: "accountBalance",
      accountCode: "1000",
    });
    // Opening 1000 + Jan deposit 200 = 1200 closing in Jan; Feb has no
    // new activity so balance stays at 1200.
    assert.deepEqual(
      points.map((point) => point.value),
      [1200, 1200],
    );
  });

  it("liability balances present credit-positive (Σ credits − Σ debits)", () => {
    const opening = makeEntry({
      date: "2024-12-31",
      kind: "opening",
      lines: [
        { accountCode: "1000", debit: 5000 },
        { accountCode: "2000", credit: 5000 },
      ],
    });
    const points = buildTimeSeries({
      buckets: monthBuckets("2025-01-01", "2025-01-31"),
      entries: [opening],
      accounts: ACCOUNTS,
      metric: "accountBalance",
      accountCode: "2000", // AP, liability
    });
    assert.equal(points[0].value, 5000);
  });
});
