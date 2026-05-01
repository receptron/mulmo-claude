import type { ToolDefinition } from "gui-chat-protocol";
import { TOOL_NAMES } from "../../config/toolNames";
import { ACCOUNTING_ACTIONS } from "./actions";

// MCP tool definition for the accounting plugin.
//
// **Opt-in only.** Not added to any built-in Role's
// `availablePlugins` (see plans/feat-accounting.md hard
// constraint 1). A user wanting access creates a custom Role and
// includes `manageAccounting` in its plugin list.
//
// The `openApp` action returns an "accounting-app" tool-result
// envelope that the frontend renderer mounts as the full
// `<AccountingApp>` View. Every other action returns a compact
// data payload that renders inline via `Preview.vue`.

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAMES.manageAccounting,
  prompt:
    "When the user asks to open / view their books, or to record, look up, or summarise journal entries / balances / opening balances, use manageAccounting. Use action='openApp' to bring up the full accounting UI; use the specific action (addEntry / getReport / etc.) for narrowly-scoped operations the user asked about by name.",
  description:
    "Manage a double-entry accounting book stored in the workspace file system. Supports multiple books (entities), opening balances for adoption from existing books, journal entries, voiding (append-only — corrections are reversing pairs), and balance-sheet / profit-loss / ledger reports. Action='openApp' mounts the full accounting UI in the canvas; specific actions return compact results that render inline.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: Object.values(ACCOUNTING_ACTIONS),
        description:
          "Operation to perform. 'openApp' mounts the full UI; others perform a single read or write. Use 'openApp' when the user wants to browse / interact, and a specific action when the user named the operation.",
      },
      bookId: {
        type: "string",
        description:
          "Target book id. Required for every action that reads or writes book data; call 'getBooks' first to enumerate available ids. The only actions that do NOT take a bookId are 'getBooks' and 'createBook' (which creates a fresh one).",
      },
      // openApp / createBook
      name: { type: "string", description: "For 'createBook': human-readable book name." },
      currency: { type: "string", description: "For 'createBook': ISO 4217 currency code (default USD). Single-currency per book." },
      initialTab: { type: "string", description: "For 'openApp': initial tab to show (e.g. 'journal', 'opening', 'balanceSheet')." },
      confirm: { type: "boolean", description: "For 'deleteBook': must be true to actually delete (guard against accidental deletion)." },
      // accounts
      account: {
        type: "object",
        description: "For 'upsertAccount': the account to insert or update (matched by code).",
        properties: {
          code: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["asset", "liability", "equity", "income", "expense"] },
          note: { type: "string" },
        },
        required: ["code", "name", "type"],
      },
      // entry
      date: { type: "string", description: "For 'addEntry': YYYY-MM-DD booking date." },
      lines: {
        type: "array",
        description:
          "For 'addEntry' / 'setOpeningBalances': journal lines. Each line sets exactly one of debit or credit (positive amount). Σ debit must equal Σ credit. For opening balances, only balance-sheet accounts (asset / liability / equity) are accepted.",
        items: {
          type: "object",
          properties: {
            accountCode: { type: "string" },
            debit: { type: "number" },
            credit: { type: "number" },
            memo: { type: "string" },
          },
          required: ["accountCode"],
        },
      },
      memo: { type: "string", description: "Optional entry-level memo." },
      // void
      entryId: { type: "string", description: "For 'voidEntry': id of the entry to void. The reverse + marker pair is appended (journal stays append-only)." },
      reason: { type: "string", description: "For 'voidEntry': human-readable reason." },
      voidDate: { type: "string", description: "For 'voidEntry': YYYY-MM-DD date for the reverse entry (defaults to today)." },
      // getJournalEntries / getReport ranges
      from: { type: "string", description: "For 'getJournalEntries': inclusive YYYY-MM-DD lower bound on entry date." },
      to: { type: "string", description: "For 'getJournalEntries': inclusive YYYY-MM-DD upper bound on entry date." },
      accountCode: {
        type: "string",
        description: "For 'getJournalEntries' / 'getReport' (kind=ledger): filter to entries that touch a specific account code.",
      },
      // opening
      asOfDate: {
        type: "string",
        description: "For 'setOpeningBalances': YYYY-MM-DD date the balances are stated as-of. Must be on or before any existing entry.",
      },
      // getReport
      kind: {
        type: "string",
        enum: ["balance", "pl", "ledger"],
        description: "For 'getReport': which report. 'balance' = balance sheet; 'pl' = profit & loss; 'ledger' = per-account running balance.",
      },
      period: {
        type: "object",
        description: "For 'getReport': either a single closing month or a date range.",
        properties: {
          kind: { type: "string", enum: ["month", "range"] },
          period: { type: "string", description: "For kind='month': YYYY-MM." },
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["kind"],
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
