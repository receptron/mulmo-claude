// Default chart of accounts seeded into a freshly created book.
// The active set is intentionally minimal — covers the common
// categories users need to record their first opening balance and
// post their first entries, without overwhelming a brand-new user.
//
// A second tier of `active: false` entries is included so the user
// can flip on common-but-not-universal accounts (Inventory, Travel,
// Depreciation Expense, …) from Manage Accounts with one click
// rather than typing them in by hand. Inactive accounts stay
// hidden from journal entry / ledger dropdowns until the user
// reactivates them. Tax-related accounts (1400 / 2400) are an
// exception — they ship active by default since almost every
// jurisdiction levies a consumption / sales / VAT tax.

import type { Account } from "../shared/types.js";

export const DEFAULT_ACCOUNTS: readonly Account[] = [
  // Assets
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1001", name: "Petty Cash", type: "asset", active: false },
  { code: "1010", name: "Bank — Checking", type: "asset" },
  { code: "1020", name: "Bank — Savings", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "1200", name: "Inventory", type: "asset", active: false },
  { code: "1300", name: "Prepaid Expenses", type: "asset", active: false },
  // 14xx is the reserved "tax-related current assets" band — pairs
  // with 24xx on the liability side for the tax-excluded (税抜)
  // booking method: input tax paid on purchases sits here as an
  // asset and is netted against output-tax collected at filing
  // time. The Ledger view's T-number column and the
  // JournalEntryForm's per-line taxRegistrationId input key off
  // the 14xx prefix only (see `isTaxAccountCode`) — the
  // counterparty registration ID is load-bearing for input-tax
  // credit on purchases, not for the seller-side liability — so
  // any custom 14xx account a user adds participates without an
  // opt-in step. Active by default — most jurisdictions levy a
  // consumption / sales / VAT tax; tax-free contexts can
  // deactivate from Manage Accounts.
  // 1400 was briefly named "Sales Tax Receivable" — that label
  // conventionally means *output* tax billed to customers but not
  // yet collected. Renamed to "Input Tax Receivable" so the
  // purchase-side meaning matches the 14xx / 24xx booking pair and
  // the non-US naming the rest of the world uses (EU "Input VAT" /
  // UK VAT input / Japan 仮払消費税). CodeRabbit review on PR #1120.
  { code: "1400", name: "Input Tax Receivable", type: "asset" },
  { code: "1500", name: "Equipment", type: "asset" },
  { code: "1510", name: "Furniture & Fixtures", type: "asset", active: false },
  { code: "1520", name: "Vehicles", type: "asset", active: false },
  { code: "1590", name: "Accumulated Depreciation", type: "asset", active: false },
  // Liabilities
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Credit Card", type: "liability" },
  { code: "2200", name: "Loans Payable", type: "liability" },
  { code: "2300", name: "Accrued Expenses", type: "liability", active: false },
  // 24xx is the reserved "tax-related current liabilities" band;
  // pairs with 14xx on the asset side. See the 1400 comment above.
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
