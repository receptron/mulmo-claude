// REST endpoint for the accounting plugin. Single POST dispatch
// route with an `action` discriminator — matches the todos /
// scheduler convention so the LLM-facing MCP bridge (which invokes
// `apiPost` with the tool args verbatim) plugs in without
// translation.
//
// The mounted `<AccountingApp>` View hits this same endpoint
// directly for tab switches, filter changes, and form submits — no
// LLM round trip per click. The MCP bridge calls into the same
// service layer, so manual clicks and Claude tool calls produce
// identical state changes.

import { Router, Request, Response } from "express";

import {
  AccountingError,
  addEntry,
  createBook,
  deleteBook,
  getBalanceSheetReport,
  getBookMeta,
  getLedgerReport,
  getOpeningBalances,
  getProfitLossReport,
  listAccounts,
  listBooks,
  listEntries,
  rebuildSnapshots,
  setActiveBook,
  setOpeningBalances,
  upsertAccount,
  voidEntry,
} from "../../accounting/service.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { log } from "../../system/logger/index.js";

const router = Router();

interface AccountingActionBody {
  action: string;
  [key: string]: unknown;
}

interface AccountingErrorResponse {
  error: string;
  details?: unknown;
}

// Tool-result envelope for the MCP-driven `openApp` action. The
// frontend tool-result renderer keys off `kind: "accounting-app"`
// to mount `<AccountingApp>` (vs the compact `Preview.vue` which
// renders summaries for every other action).
interface OpenAppToolResult {
  kind: "accounting-app";
  /** `null` when the workspace has zero books — the View shows its
   *  empty state and prompts the user to create one. */
  bookId: string | null;
  initialTab?: string;
}

type ActionRest = Omit<AccountingActionBody, "action">;
type ActionHandler = (rest: ActionRest) => Promise<unknown>;

// Each action is a tiny adapter that pulls the typed slice it needs
// out of the loosely-typed body. Validation of the slice shape
// itself lives inside the service layer (validateEntry,
// validateOpening) so the adapters can stay one-liners.

async function handleOpenApp(rest: ActionRest): Promise<OpenAppToolResult> {
  // Resolving the bookId server-side ensures the LLM's tool result
  // *describes* what's in the canvas (which book, which tab) so
  // historical chat replays render accurately. The View handles
  // the empty-state flow (auto-opening the New Book modal so the
  // user can pick name + currency); the server doesn't try to
  // bootstrap a default book.
  const list = await listBooks();
  const requested = typeof rest.bookId === "string" ? rest.bookId : undefined;
  const bookId = requested && list.books.some((book) => book.id === requested) ? requested : list.activeBookId;
  const initialTab = typeof rest.initialTab === "string" ? rest.initialTab : undefined;
  return { kind: "accounting-app", bookId, initialTab };
}

async function handleGetReport(rest: ActionRest): Promise<unknown> {
  const kind = String(rest.kind ?? "");
  const periodInput = rest.period as { kind: "month"; period: string } | { kind: "range"; from: string; to: string } | undefined;
  const bookId = rest.bookId as string | undefined;
  if (kind === "balance") {
    if (!periodInput) throw new AccountingError(400, "getReport balance: period is required");
    return getBalanceSheetReport({ bookId, period: periodInput });
  }
  if (kind === "pl") {
    if (!periodInput) throw new AccountingError(400, "getReport pl: period is required");
    return getProfitLossReport({ bookId, period: periodInput });
  }
  if (kind === "ledger") {
    // period is optional for ledger — full-history view from the
    // UI calls getLedger(accountCode, undefined, bookId). The
    // account code, however, is mandatory; without it the request
    // is meaningless and the service would 404 on a blank code.
    if (typeof rest.accountCode !== "string" || rest.accountCode === "") {
      throw new AccountingError(400, "getReport ledger: accountCode is required");
    }
    return getLedgerReport({ bookId, accountCode: rest.accountCode, period: periodInput });
  }
  throw new AccountingError(400, `getReport: unknown kind ${JSON.stringify(kind)}`);
}

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  openApp: handleOpenApp,
  listBooks: () => listBooks(),
  createBook: (rest) =>
    createBook({
      id: typeof rest.id === "string" ? rest.id : undefined,
      name: String(rest.name ?? ""),
      currency: typeof rest.currency === "string" ? rest.currency : undefined,
    }),
  setActiveBook: (rest) => setActiveBook({ bookId: String(rest.bookId ?? "") }),
  deleteBook: (rest) => deleteBook({ bookId: String(rest.bookId ?? ""), confirm: rest.confirm === true }),
  listAccounts: (rest) => listAccounts({ bookId: rest.bookId as string | undefined }),
  upsertAccount: (rest) =>
    upsertAccount({
      bookId: rest.bookId as string | undefined,
      // Service validates the shape — route doesn't reach into it.
      account: rest.account as never,
    }),
  addEntry: (rest) =>
    addEntry({
      bookId: rest.bookId as string | undefined,
      date: String(rest.date ?? ""),
      lines: (rest.lines ?? []) as never,
      memo: rest.memo as string | undefined,
    }),
  voidEntry: (rest) =>
    voidEntry({
      bookId: rest.bookId as string | undefined,
      entryId: String(rest.entryId ?? ""),
      reason: rest.reason as string | undefined,
      voidDate: rest.voidDate as string | undefined,
    }),
  listEntries: (rest) =>
    listEntries({
      bookId: rest.bookId as string | undefined,
      from: rest.from as string | undefined,
      to: rest.to as string | undefined,
      accountCode: rest.accountCode as string | undefined,
    }),
  getOpeningBalances: (rest) => getOpeningBalances({ bookId: rest.bookId as string | undefined }),
  setOpeningBalances: (rest) =>
    setOpeningBalances({
      bookId: rest.bookId as string | undefined,
      asOfDate: String(rest.asOfDate ?? ""),
      lines: (rest.lines ?? []) as never,
      memo: rest.memo as string | undefined,
    }),
  getReport: handleGetReport,
  getBookMeta: (rest) => getBookMeta({ bookId: rest.bookId as string | undefined }),
  rebuildSnapshots: (rest) => rebuildSnapshots({ bookId: rest.bookId as string | undefined }),
};

async function dispatch(body: AccountingActionBody): Promise<unknown> {
  const { action, ...rest } = body;
  const handler = ACTION_HANDLERS[action];
  if (!handler) throw new AccountingError(400, `unknown action ${JSON.stringify(action)}`);
  // Stamp the dispatch verb onto the response so the MCP bridge's
  // spread `{ toolName, uuid, ...result }` surfaces it as
  // `ToolResult.action`. The sidebar reads this to label cards as
  // `manageAccounting(openApp)` etc., and it round-trips a refresh
  // because the result envelope is persisted to the chat log.
  // Direct browser callers (the AccountingApp view) ignore the field.
  // Service responses that already set `action` win via the spread.
  const result = await handler(rest);
  return { action, ...(result && typeof result === "object" ? result : { value: result }) };
}

router.post(API_ROUTES.accounting.dispatch, async (req: Request<object, unknown, AccountingActionBody>, res: Response<unknown | AccountingErrorResponse>) => {
  // Validate the body shape up front so a missing / non-object body
  // surfaces as a 400 instead of crashing `dispatch` and bubbling
  // through to the 500 catch-all.
  const { body } = req;
  if (!body || typeof body !== "object" || typeof body.action !== "string") {
    log.warn("accounting", "POST dispatch: invalid body");
    res.status(400).json({ error: "request body must be an object with a string `action` field" });
    return;
  }
  const { action } = body;
  log.info("accounting", "POST dispatch: start", { action });
  try {
    const result = await dispatch(body);
    log.info("accounting", "POST dispatch: ok", { action });
    res.json(result);
  } catch (err) {
    if (err instanceof AccountingError) {
      log.warn("accounting", "POST dispatch: error", { action, status: err.status, message: err.message });
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    log.error("accounting", "POST dispatch: unexpected error", { action, error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
