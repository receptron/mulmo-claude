// Default chart of accounts seeded into a freshly created book.
// Intentionally minimal — covers the common categories users need
// to record their first opening balance and post their first
// entries, without overwhelming a brand-new user with a 200-line
// taxonomy.
//
// Users can edit (`upsertAccount`), and (in a follow-up) import a
// fuller chart specific to their jurisdiction.

import type { Account } from "./types.js";

export const DEFAULT_ACCOUNTS: readonly Account[] = [
  // Assets
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1010", name: "Bank — Checking", type: "asset" },
  { code: "1020", name: "Bank — Savings", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "1500", name: "Equipment", type: "asset" },
  // Liabilities
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Credit Card", type: "liability" },
  { code: "2200", name: "Loans Payable", type: "liability" },
  // Equity
  // Required for opening balances: setOpeningBalances dumps the
  // plug into "Retained Earnings" by convention.
  { code: "3000", name: "Owner's Equity", type: "equity" },
  { code: "3100", name: "Retained Earnings", type: "equity" },
  // Income
  { code: "4000", name: "Sales", type: "income" },
  { code: "4100", name: "Other Income", type: "income" },
  // Expenses
  { code: "5000", name: "Cost of Goods Sold", type: "expense" },
  { code: "5100", name: "Rent", type: "expense" },
  { code: "5200", name: "Utilities", type: "expense" },
  { code: "5300", name: "Salaries", type: "expense" },
  { code: "5400", name: "Office Supplies", type: "expense" },
  { code: "5900", name: "Miscellaneous Expense", type: "expense" },
];
