// Shared mutable-state todo mock for E2E specs that exercise CRUD
// flows against the Todo explorer. Consolidates the scaffolding that
// `todo-columns.spec.ts` and `todo-items-crud.spec.ts` each had
// privately into a single fixture with optional per-resource
// dispatchers.
//
// Design:
//   - `items` and `columns` live in per-call closures so every test
//     run starts from a fresh clone of TODO_ITEMS / TODO_COLUMNS
//     (no cross-test leakage).
//   - `mockAllApis(page)` is NOT called here — the caller handles
//     that ordering so specs can register per-test overrides before
//     or after as needed. Playwright's reverse-order matching means
//     the order of mockAllApis vs this helper matters.
//   - Item + column dispatchers are handed in as callbacks. Specs
//     that only exercise columns skip the item dispatcher; specs
//     that only exercise items skip the column dispatcher. Missing
//     dispatchers return the current state unchanged for that verb.

import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { TODO_COLUMNS, TODO_ITEMS, type TodoFixture } from "./todos";
import { WORKSPACE_FILES } from "../../src/config/workspacePaths";

export interface StatusColumnFixture {
  id: string;
  label: string;
  isDone?: boolean;
}

export interface MutableTodoState {
  items: TodoFixture[];
  columns: StatusColumnFixture[];
}

type DispatchResult = {
  items?: TodoFixture[];
  columns?: StatusColumnFixture[];
  /** Optional extra fields merged into the response body. */
  extra?: Record<string, unknown>;
};

export type ItemDispatcher = (method: string, path: string, body: Record<string, unknown>, state: MutableTodoState) => DispatchResult | void;

export type ColumnDispatcher = (method: string, id: string | null, body: Record<string, unknown>, state: MutableTodoState) => DispatchResult | void;

export interface MutableTodoOptions {
  items?: TodoFixture[];
  columns?: StatusColumnFixture[];
  /** Called for every `/api/todos/items*` request. */
  dispatchItem?: ItemDispatcher;
  /** Called for every `/api/todos/columns*` request. */
  dispatchColumn?: ColumnDispatcher;
}

// Mirror of server/utils/slug.ts used when the column dispatcher needs
// to derive an id from a human label. Kept inline to avoid a
// Vite/server import boundary; the server-side helper is unit-tested.
export function mockSlugifyColumnId(label: string): string {
  let slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_");
  let start = 0;
  while (start < slug.length && slug[start] === "_") start++;
  let end = slug.length;
  while (end > start && slug[end - 1] === "_") end--;
  slug = slug.slice(start, end);
  // eslint-disable-next-line no-control-regex
  const hasNonAscii = /[^\x00-\x7F]/.test(label);
  if (!hasNonAscii) return slug.length > 0 ? slug : "column";
  const hash = createHash("sha256").update(label.trim(), "utf-8").digest("base64url").slice(0, 16);
  if (slug.length >= 3) return `${slug}_${hash}`;
  return hash;
}

/**
 * Register route handlers for the Todo explorer's REST API plus the
 * file-tree + file-content endpoints it needs to even mount. Caller
 * is responsible for having called `mockAllApis(page)` first.
 *
 * Returns the mutable state handle so individual tests can inspect
 * it after the fact (e.g. to assert a final columns.length).
 */
export async function setupMutableTodoMocks(page: Page, options: MutableTodoOptions = {}): Promise<MutableTodoState> {
  const state: MutableTodoState = {
    items: (options.items ?? TODO_ITEMS).map((i) => ({ ...i })),
    columns: (options.columns ?? TODO_COLUMNS).map((c) => ({ ...c })),
  };

  const buildResponse = (extra?: Record<string, unknown>) => ({
    data: { items: state.items, columns: state.columns },
    ...extra,
  });

  // /api/todos — plain GET hydrate
  await page.route(
    (url) => url.pathname === "/api/todos",
    (route: Route) => route.fulfill({ json: buildResponse() }),
  );

  // /api/todos/items/* — delegate to the item dispatcher, fall back
  // to echoing current state
  await page.route(
    (url) => url.pathname.startsWith("/api/todos/items"),
    (route: Route) => {
      const method = route.request().method();
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api\/todos\/items\/?/, "");
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      const outcome = options.dispatchItem?.(method, path, body, state) ?? undefined;
      if (outcome?.items) state.items = outcome.items;
      if (outcome?.columns) state.columns = outcome.columns;
      return route.fulfill({ json: buildResponse(outcome?.extra) });
    },
  );

  // /api/todos/columns/* — delegate to the column dispatcher, fall
  // back to echoing current state
  await page.route(
    (url) => url.pathname.startsWith("/api/todos/columns"),
    (route: Route) => {
      const method = route.request().method();
      const url = new URL(route.request().url());
      const id = url.pathname.replace(/^\/api\/todos\/columns\/?/, "") || null;
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      const outcome = options.dispatchColumn?.(method, id, body, state) ?? undefined;
      if (outcome?.items) state.items = outcome.items;
      if (outcome?.columns) state.columns = outcome.columns;
      return route.fulfill({ json: buildResponse(outcome?.extra) });
    },
  );

  // File-explorer wiring so the TodoExplorer view can actually mount
  // when navigated via deep-link `?path=data/todos/todos.json`.
  // Only /api/files/content and /api/files/tree are mocked here —
  // /api/files/dir (lazy-expand) is intentionally not mocked because
  // todo tests deep-link straight into the content view.
  await page.route(
    (url) => url.pathname === "/api/files/content" && url.searchParams.get("path") === WORKSPACE_FILES.todosItems,
    (route: Route) =>
      route.fulfill({
        json: {
          kind: "text",
          path: WORKSPACE_FILES.todosItems,
          content: JSON.stringify(state.items),
          size: 500,
          modifiedMs: Date.now(),
        },
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/files/tree",
    (route: Route) =>
      route.fulfill({
        json: {
          name: "",
          path: "",
          type: "dir",
          children: [
            {
              name: "data",
              path: "data",
              type: "dir",
              children: [
                {
                  name: "todos",
                  path: "data/todos",
                  type: "dir",
                  children: [
                    {
                      name: "todos.json",
                      path: WORKSPACE_FILES.todosItems,
                      type: "file",
                      size: 500,
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
  );

  return state;
}
