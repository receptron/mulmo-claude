// Shared API mock helpers for Playwright tests.
//
// IMPORTANT: Playwright matches routes in REVERSE registration order
// (last registered is checked first). So we register the catch-all
// FIRST and specific routes AFTER, ensuring specific handlers take
// priority.

import type { Page, Route } from "@playwright/test";
import {
  SESSION_A,
  SESSION_B,
  makeSessionEntries,
  type SessionFixture,
} from "./sessions";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

function urlStartsWith(prefix: string): (url: URL) => boolean {
  return (url) => url.pathname.startsWith(prefix);
}

const DEFAULT_ROLES: unknown[] = [];

const DEFAULT_TODOS = {
  data: {
    items: [],
    columns: [
      { id: "backlog", label: "Backlog" },
      { id: "todo", label: "Todo" },
      { id: "in_progress", label: "In Progress" },
      { id: "done", label: "Done", isDone: true },
    ],
  },
};

const DEFAULT_HEALTH = {
  status: "OK",
  geminiAvailable: false,
  sandboxEnabled: false,
};

export interface MockApiOptions {
  sessions?: SessionFixture[];
}

export async function mockAllApis(
  page: Page,
  opts: MockApiOptions = {},
): Promise<void> {
  const sessions = opts.sessions ?? [SESSION_A, SESSION_B];

  // Catch-all FIRST (checked last by Playwright)
  await page.route(urlStartsWith("/api/"), (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();
    console.warn(`[mock] unhandled: ${method} ${url}`);
    return route.fulfill({
      status: 501,
      json: { error: "Unhandled mocked API route", method, url },
    });
  });

  // Specific routes AFTER (checked first by Playwright)
  await page.route(urlEndsWith("/api/health"), (route) =>
    route.fulfill({ json: DEFAULT_HEALTH }),
  );

  await page.route(urlEndsWith("/api/roles"), (route) =>
    route.fulfill({ json: DEFAULT_ROLES }),
  );

  await page.route(urlEndsWith("/api/sessions"), (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: sessions });
    }
    return route.fallback();
  });

  await page.route(
    (url) =>
      url.pathname.startsWith("/api/sessions/") &&
      url.pathname !== "/api/sessions",
    (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const id = route.request().url().split("/api/sessions/").pop() ?? "";
      const match = sessions.find((s) => s.id === id);
      if (match) {
        return route.fulfill({ json: makeSessionEntries(match.id) });
      }
      return route.fulfill({ status: 404, json: { error: "not found" } });
    },
  );

  await page.route(urlEndsWith("/api/todos"), (route) =>
    route.fulfill({ json: DEFAULT_TODOS }),
  );

  await page.route(urlStartsWith("/api/todos/"), (route) =>
    route.fulfill({ json: DEFAULT_TODOS }),
  );

  await page.route(urlStartsWith("/api/mcp-tools"), (route) =>
    route.fulfill({ json: { tools: [], disabled: [] } }),
  );

  await page.route(urlStartsWith("/api/chat-index"), (route) =>
    route.fulfill({ json: {} }),
  );

  await page.route(urlEndsWith("/api/files/tree"), (route) =>
    route.fulfill({
      json: { name: "", path: "", type: "dir", children: [] },
    }),
  );
}
