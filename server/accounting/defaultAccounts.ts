// Default chart of accounts seeded into a freshly created book.
// The active set is intentionally minimal — covers the common
// categories users need to record their first opening balance and
// post their first entries, without overwhelming a brand-new user.
//
// A second tier of `active: false` entries is included so the user
// can flip on common-but-not-universal accounts (Inventory, Sales
// Tax Payable, Travel, Depreciation Expense, …) from Manage
// Accounts with one click rather than typing them in by hand.
// Inactive accounts stay hidden from journal entry / ledger
// dropdowns until the user reactivates them.

import type { Account } from "./types.js";

export const DEFAULT_ACCOUNTS: readonly Account[] = [
  // Assets
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1001", name: "Petty Cash", type: "asset", active: false },
  { code: "1010", name: "Bank — Checking", type: "asset" },
  { code: "1020", name: "Bank — Savings", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "1200", name: "Inventory", type: "asset", active: false },
  { code: "1300", name: "Prepaid Expenses", type: "asset", active: false },
  // Pairs with 2400 Sales Tax Payable for the tax-excluded (税抜)
  // booking method: input tax paid on purchases sits here as an
  // asset and is netted against output-tax collected at filing time.
  // Active by default — most jurisdictions levy a consumption /
  // sales / VAT tax, so flipping this on out of the box matches
  // first-run expectations. Users in genuinely tax-free contexts
  // can deactivate from Manage Accounts.
  { code: "1310", name: "Sales Tax Receivable", type: "asset" },
  { code: "1500", name: "Equipment", type: "asset" },
  { code: "1510", name: "Furniture & Fixtures", type: "asset", active: false },
  { code: "1520", name: "Vehicles", type: "asset", active: false },
  { code: "1590", name: "Accumulated Depreciation", type: "asset", active: false },
  // Liabilities
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Credit Card", type: "liability" },
  { code: "2200", name: "Loans Payable", type: "liability" },
  { code: "2300", name: "Accrued Expenses", type: "liability", active: false },
  // Active by default; pairs with 1310 Sales Tax Receivable.
  { code: "2400", name: "Sales Tax Payable", type: "liability" },
  { code: "2500", name: "Payroll Liabilities", type: "liability", active: false },
  // Equity
  // Required for opening balances: setOpeningBalances dumps the
  // plug into "Retained Earnings" by convention.
  { code: "3000", name: "Owner's Equity", type: "equity" },
  { code: "3100", name: "Retained Earnings", type: "equity" },
  { code: "3200", name: "Owner's Draws", type: "equity", active: false },
  // Income
  { code: "4000", name: "Sales", type: "income" },
  { code: "4010", name: "Service Revenue", type: "income", active: false },
  { code: "4100", name: "Other Income", type: "income" },
  { code: "4200", name: "Interest Income", type: "income", active: false },
  { code: "4300", name: "Sales Returns & Discounts", type: "income", active: false },
  // Expenses
  { code: "5000", name: "Cost of Goods Sold", type: "expense" },
  { code: "5100", name: "Rent", type: "expense" },
  { code: "5200", name: "Utilities", type: "expense" },
  { code: "5300", name: "Salaries", type: "expense" },
  { code: "5400", name: "Office Supplies", type: "expense" },
  { code: "5500", name: "Advertising & Marketing", type: "expense", active: false },
  { code: "5600", name: "Travel", type: "expense", active: false },
  { code: "5610", name: "Meals & Entertainment", type: "expense", active: false },
  { code: "5700", name: "Professional Fees", type: "expense", active: false },
  { code: "5710", name: "Insurance", type: "expense", active: false },
  { code: "5720", name: "Software & Subscriptions", type: "expense", active: false },
  { code: "5730", name: "Bank Fees", type: "expense", active: false },
  { code: "5800", name: "Depreciation Expense", type: "expense", active: false },
  { code: "5810", name: "Taxes", type: "expense", active: false },
  { code: "5900", name: "Miscellaneous Expense", type: "expense" },
];
