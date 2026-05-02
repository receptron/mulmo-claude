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
  getLedgerReport,
  getOpeningBalances,
  getProfitLossReport,
  listAccounts,
  listBooks,
  listEntries,
  rebuildSnapshots,
  setOpeningBalances,
  upsertAccount,
  voidEntry,
} from "../../accounting/service.js";
import type { BookSummary } from "../../accounting/types.js";
import { ACCOUNTING_ACTIONS } from "../../../src/plugins/accounting/actions.js";
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

// Tool-result envelope for the MCP-driven `openBook` action. The
// frontend tool-result renderer keys off `kind: "accounting-app"`
// to mount `<AccountingApp>` (vs the compact `Preview.vue` which
// renders summaries for every other action). `message` is picked
// up by the MCP bridge and surfaced as the tool's text response
// to the LLM (server/agent/mcp-server.ts).
interface OpenBookToolResult {
  kind: "accounting-app";
  bookId: string;
  initialTab?: string;
  /** Same shape getBooks returns — included so an LLM that calls
   *  openBook doesn't need a follow-up getBooks round-trip to learn
   *  what other books exist before its next action. */
  books: BookSummary[];
}

type ActionRest = Omit<AccountingActionBody, "action">;
type ActionHandler = (rest: ActionRest) => Promise<unknown>;

// Each action is a tiny adapter that pulls the typed slice it needs
// out of the loosely-typed body. Validation of the slice shape
// itself lives inside the service layer (validateEntry,
// validateOpening) so the adapters can stay one-liners.

async function handleOpenBook(rest: ActionRest): Promise<OpenBookToolResult> {
  // openBook requires an explicit `bookId` that resolves to an
  // existing book. On a fresh workspace the LLM is expected to
  // call `createBook` first and then `openBook` with the new id.
  if (typeof rest.bookId !== "string" || rest.bookId === "") {
    throw new AccountingError(400, "openBook: bookId is required. Call 'getBooks' to enumerate, or 'createBook' first on a fresh workspace.");
  }
  const list = await listBooks();
  if (!list.books.some((book) => book.id === rest.bookId)) {
    throw new AccountingError(404, `openBook: book ${JSON.stringify(rest.bookId)} not found`);
  }
  const initialTab = typeof rest.initialTab === "string" ? rest.initialTab : undefined;
  return { kind: "accounting-app", bookId: rest.bookId, initialTab, books: list.books };
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
  [ACCOUNTING_ACTIONS.openBook]: handleOpenBook,
  [ACCOUNTING_ACTIONS.getBooks]: () => listBooks(),
  [ACCOUNTING_ACTIONS.createBook]: async (rest) => {
    // Surface bookId at the top level so the dispatch envelope's
    // `data` carries it like every other write action — the View
    // uses it to preselect the new book on mount.
    const result = await createBook({
      name: String(rest.name ?? ""),
      currency: typeof rest.currency === "string" ? rest.currency : undefined,
    });
    return { bookId: result.book.id, ...result };
  },
  [ACCOUNTING_ACTIONS.deleteBook]: (rest) => deleteBook({ bookId: String(rest.bookId ?? ""), confirm: rest.confirm === true }),
  [ACCOUNTING_ACTIONS.getAccounts]: (rest) => listAccounts({ bookId: rest.bookId as string | undefined }),
  [ACCOUNTING_ACTIONS.upsertAccount]: (rest) =>
    upsertAccount({
      bookId: rest.bookId as string | undefined,
      // Service validates the shape — route doesn't reach into it.
      account: rest.account as never,
    }),
  [ACCOUNTING_ACTIONS.addEntry]: (rest) =>
    addEntry({
      bookId: rest.bookId as string | undefined,
      date: String(rest.date ?? ""),
      lines: (rest.lines ?? []) as never,
      memo: rest.memo as string | undefined,
    }),
  [ACCOUNTING_ACTIONS.voidEntry]: (rest) =>
    voidEntry({
      bookId: rest.bookId as string | undefined,
      entryId: String(rest.entryId ?? ""),
      reason: rest.reason as string | undefined,
      voidDate: rest.voidDate as string | undefined,
    }),
  [ACCOUNTING_ACTIONS.getJournalEntries]: (rest) =>
    listEntries({
      bookId: rest.bookId as string | undefined,
      from: rest.from as string | undefined,
      to: rest.to as string | undefined,
      accountCode: rest.accountCode as string | undefined,
    }),
  [ACCOUNTING_ACTIONS.getOpeningBalances]: (rest) => getOpeningBalances({ bookId: rest.bookId as string | undefined }),
  [ACCOUNTING_ACTIONS.setOpeningBalances]: (rest) =>
    setOpeningBalances({
      bookId: rest.bookId as string | undefined,
      asOfDate: String(rest.asOfDate ?? ""),
      lines: (rest.lines ?? []) as never,
      memo: rest.memo as string | undefined,
    }),
  [ACCOUNTING_ACTIONS.getReport]: handleGetReport,
  [ACCOUNTING_ACTIONS.rebuildSnapshots]: (rest) => rebuildSnapshots({ bookId: rest.bookId as string | undefined }),
};

// Actions whose tool-result envelope should carry a `data` field so
// the sidebar renders a preview card. Everything else returns
// without `data` and the host gates the preview off (silent action).
// Reads (lists / reports) and View-driven maintenance ops stay
// silent — they're invoked from inside the canvas and the LLM will
// summarise reads in its text reply anyway.
const PREVIEW_ACTIONS = new Set<string>([
  ACCOUNTING_ACTIONS.openBook,
  ACCOUNTING_ACTIONS.createBook,
  ACCOUNTING_ACTIONS.upsertAccount,
  ACCOUNTING_ACTIONS.addEntry,
  ACCOUNTING_ACTIONS.voidEntry,
  ACCOUNTING_ACTIONS.setOpeningBalances,
]);

// LLM-facing `message` tacked onto YES actions. The shared trailer
// ("The accounting view is shown to the user.") tells the LLM that a
// canvas / sidebar surface is already visible, so its text reply
// shouldn't redundantly enumerate the result the user can see — it
// should narrate what was *done*, not re-list what's on screen.
const VIEW_VISIBLE_TRAILER = "The accounting view is shown to the user.";

type MessageBuilder = (fields: Record<string, unknown>) => string;

const MESSAGE_BUILDERS: Record<string, MessageBuilder> = {
  [ACCOUNTING_ACTIONS.openBook]: (fields) => {
    // Include the books list inline so the LLM doesn't need a
    // follow-up getBooks round-trip before deciding what to do
    // next.
    const { books, bookId } = fields;
    const booksFragment = Array.isArray(books) ? ` Books available: ${JSON.stringify(books)}.` : "";
    const idFragment = typeof bookId === "string" ? ` (book id: ${bookId})` : "";
    return `Mounted the accounting app in the canvas${idFragment}.${booksFragment}`;
  },
  [ACCOUNTING_ACTIONS.createBook]: (fields) => {
    const book = fields.book as { id?: string; name?: string } | undefined;
    const subject = book?.name ? `A new book named ${JSON.stringify(book.name)}` : "A new book";
    // The LLM needs book.id to call any follow-up action on this
    // book (getAccounts, addEntry, etc.), so include it in the
    // status message instead of forcing a round-trip via getBooks.
    const idFragment = book?.id ? ` (id: ${book.id})` : "";
    return `${subject} has been created${idFragment}.`;
  },
  [ACCOUNTING_ACTIONS.upsertAccount]: (fields) => {
    const account = fields.account as { code?: string; name?: string } | undefined;
    if (account?.code && account?.name) {
      return `Upserted account ${account.code} ${JSON.stringify(account.name)}.`;
    }
    return "Updated the chart of accounts.";
  },
  [ACCOUNTING_ACTIONS.addEntry]: (fields) => {
    const entry = fields.entry as { id?: string; date?: string } | undefined;
    const idFragment = entry?.id ? ` (id: ${entry.id})` : "";
    // The LLM needs the entry id to act on this entry later (e.g.
    // voidEntry), so return it as part of the status message.
    return `Posted a journal entry on ${entry?.date ?? "the requested date"}${idFragment}.`;
  },
  [ACCOUNTING_ACTIONS.voidEntry]: (fields) => {
    const reverse = fields.reverseEntry as { date?: string } | undefined;
    return `Voided the entry; a reversing pair was posted on ${reverse?.date ?? "today"}.`;
  },
  [ACCOUNTING_ACTIONS.setOpeningBalances]: (fields) => {
    const opening = fields.openingEntry as { date?: string; lines?: unknown } | undefined;
    const verb = fields.replacedExisting === true ? "replaced" : "set";
    const date = opening?.date ?? "the requested date";
    // Surface the actual lines so the LLM can answer follow-up
    // questions like "what's my opening cash?" without a separate
    // getOpeningBalances round-trip. An empty-marker opening
    // (zero lines, used to unlock the gate) gets no fragment.
    const lines = Array.isArray(opening?.lines) ? (opening.lines as unknown[]) : [];
    const linesFragment = lines.length > 0 ? ` Lines: ${JSON.stringify(lines)}.` : "";
    return `Opening balances were ${verb} as of ${date}.${linesFragment}`;
  },
  [ACCOUNTING_ACTIONS.deleteBook]: (fields) => {
    const bookId = fields.deletedBookId as string | undefined;
    const name = fields.deletedBookName as string | undefined;
    const subject = name ? `the book ${JSON.stringify(name)}` : "the book";
    const idFragment = bookId ? ` (id: ${bookId})` : "";
    return `Deleted ${subject}${idFragment}.`;
  },
};

function previewMessage(action: string, fields: Record<string, unknown>): string {
  const head = MESSAGE_BUILDERS[action]?.(fields);
  return head ? `${head} ${VIEW_VISIBLE_TRAILER}` : VIEW_VISIBLE_TRAILER;
}

async function dispatch(body: AccountingActionBody): Promise<unknown> {
  const { action, ...rest } = body;
  const handler = ACTION_HANDLERS[action];
  if (!handler) throw new AccountingError(400, `unknown action ${JSON.stringify(action)}`);
  // Stamp the dispatch verb onto the response so the MCP bridge's
  // spread `{ toolName, uuid, ...result }` surfaces it as
  // `ToolResult.action`. The sidebar reads this to label cards as
  // `manageAccounting(openBook)` etc., and it round-trips a refresh
  // because the result envelope is persisted to the chat log.
  // Direct browser callers (the AccountingApp view) ignore the field.
  // Service responses that already set `action` win via the spread.
  const result = await handler(rest);
  const handlerFields = result && typeof result === "object" ? (result as Record<string, unknown>) : { value: result };
  // `data` is the host's preview-eligibility signal (see
  // SessionSidebar.vue's v-if gate). Mirror the handler payload
  // into it for the actions that should render a card; leave it
  // off for silent ones so the gate suppresses the preview.
  const dataField = PREVIEW_ACTIONS.has(action) ? { data: { action, ...handlerFields } } : {};
  // The MCP bridge only forwards `message` / `instructions` to the
  // LLM (`data` / `jsonData` reach the view but not the model). So
  // every action MUST set a message — silence resolves to "Done"
  // and gives the LLM nothing to reason about. Resolution order:
  //   1. handler-set `message` wins (reserved for special-case
  //      narration that the standard MESSAGE_BUILDER can't capture);
  //   2. an action with a registered MESSAGE_BUILDER gets the
  //      per-action human-friendly summary; this is decoupled from
  //      PREVIEW_ACTIONS so silent ops like deleteBook can still
  //      narrate without earning a card;
  //   3. everything else returns the JSON-stringified handler
  //      payload so the LLM can read the raw data.
  const handlerMessage = typeof handlerFields.message === "string" ? handlerFields.message : undefined;
  const messageField = handlerMessage
    ? {}
    : MESSAGE_BUILDERS[action]
      ? { message: previewMessage(action, handlerFields) }
      : { message: JSON.stringify(handlerFields) };
  return { action, ...handlerFields, ...messageField, ...dataField };
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
