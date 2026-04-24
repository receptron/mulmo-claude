// Empty wiki page states: create button (page does not exist) and
// update button (page exists but is empty).
//
// Covers the behaviour introduced in feat/wiki-empty-create-button:
//
// - /wiki/pages/<slug> where the file does not exist
//   → shows "page does not exist yet" + create button (standalone only)
// - /wiki/pages/<slug> where the file exists but is empty
//   → shows "page exists but has no content" + update button (standalone only)
// - Neither button appears inside /chat tool-result context

import { test, expect, type Page, type Request } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const INDEX_PAYLOAD = {
  action: "index",
  title: "Wiki Index",
  content: "# Wiki Index\n\nRoot page.",
  pageEntries: [{ title: "Existing", slug: "existing", description: "Has content" }],
};

const PAGE_EXISTING = {
  action: "page",
  title: "Existing",
  pageName: "existing",
  content: "# Existing\n\nThis page has content.",
  pageExists: true,
};

const PAGE_NOT_FOUND = {
  action: "page",
  title: "NonExistent",
  pageName: "NonExistent",
  content: "",
  pageExists: false,
};

const PAGE_EMPTY_FILE = {
  action: "page",
  title: "empty-file",
  pageName: "empty-file",
  content: "",
  pageExists: true,
};

const PAGE_MAP: Record<string, unknown> = {
  existing: PAGE_EXISTING,
  "empty-file": PAGE_EMPTY_FILE,
};

function resolvePagePayload(slug: string): { data: unknown } {
  const known = PAGE_MAP[slug];
  if (known) return { data: known };
  return { data: { ...PAGE_NOT_FOUND, title: slug, pageName: slug } };
}

async function mockWikiApi(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/wiki",
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        const slug = new URL(req.url()).searchParams.get("slug");
        return route.fulfill({ json: slug ? resolvePagePayload(slug) : { data: INDEX_PAYLOAD } });
      }
      if (req.method() === "POST") {
        const body = (req.postDataJSON() ?? {}) as { action?: string; pageName?: string };
        if (body.action === "page" && body.pageName) {
          return route.fulfill({ json: resolvePagePayload(body.pageName) });
        }
        return route.fulfill({ json: { data: INDEX_PAYLOAD } });
      }
      return route.fallback();
    },
  );
}

function captureNextAgentRequest(page: Page): Promise<Request> {
  return page.waitForRequest((req) => req.url().endsWith("/api/agent") && req.method() === "POST");
}

test.describe("wiki empty page — create button", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockWikiApi(page);
  });

  test("shows create button when page does not exist", async ({ page }) => {
    await page.goto("/wiki/pages/NonExistent");
    await expect(page.getByTestId("wiki-create-page-button")).toBeVisible();
    await expect(page.getByRole("heading", { name: "NonExistent" })).toBeVisible();
  });

  test("create button hidden on existing page with content", async ({ page }) => {
    await page.goto("/wiki/pages/existing");
    await expect(page.getByRole("heading", { level: 1, name: "Existing" })).toBeVisible();
    await expect(page.getByTestId("wiki-create-page-button")).toHaveCount(0);
  });

  test("clicking create button opens a new chat session", async ({ page }) => {
    await page.goto("/wiki/pages/SomeNewTopic");
    await expect(page.getByTestId("wiki-create-page-button")).toBeVisible();

    const agentReq = captureNextAgentRequest(page);
    await page.getByTestId("wiki-create-page-button").click();

    await page.waitForURL(/\/chat\//);

    const body = (await agentReq).postDataJSON() as { message?: string };
    expect(body.message).toContain("SomeNewTopic");
    expect(body.message).toContain("wiki page");
  });

  test("browser Back after create returns to the wiki page", async ({ page }) => {
    await page.goto("/wiki/pages/SomeNewTopic");
    await expect(page.getByTestId("wiki-create-page-button")).toBeVisible();

    await page.getByTestId("wiki-create-page-button").click();
    await page.waitForURL(/\/chat\//);

    await page.goBack();
    await page.waitForURL(/\/wiki\/pages\/SomeNewTopic$/);
  });
});

test.describe("wiki empty page — update button", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockWikiApi(page);
  });

  test("shows update button when page file exists but is empty", async ({ page }) => {
    await page.goto("/wiki/pages/empty-file");
    await expect(page.getByTestId("wiki-update-page-button")).toBeVisible();
    await expect(page.getByRole("heading", { name: "empty-file" })).toBeVisible();
  });

  test("clicking update button opens a new chat session", async ({ page }) => {
    await page.goto("/wiki/pages/empty-file");
    await expect(page.getByTestId("wiki-update-page-button")).toBeVisible();

    const agentReq = captureNextAgentRequest(page);
    await page.getByTestId("wiki-update-page-button").click();

    await page.waitForURL(/\/chat\//);

    const body = (await agentReq).postDataJSON() as { message?: string };
    expect(body.message).toContain("empty-file");
    expect(body.message).toMatch(/update/i);
    expect(body.message).toContain("wiki page");
  });

  test("update button hidden on page with content", async ({ page }) => {
    await page.goto("/wiki/pages/existing");
    await expect(page.getByTestId("wiki-update-page-button")).toHaveCount(0);
  });
});

test.describe("wiki empty page — tool-result context", () => {
  // When WikiView is rendered as a manageWiki tool result inside
  // /chat, neither create nor update buttons should appear (same
  // rationale as per-page chat composer: avoid spawning nested sessions).
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        {
          id: "wiki-empty-session",
          title: "Wiki Empty Session",
          roleId: "general",
          startedAt: "2026-04-22T10:00:00Z",
          updatedAt: "2026-04-22T10:05:00Z",
        },
      ],
    });
    await mockWikiApi(page);

    await page.route(
      (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
      (route) =>
        route.fulfill({
          json: [
            { type: "session_meta", roleId: "general", sessionId: "wiki-empty-session" },
            { type: "text", source: "user", message: "Show wiki NonExistent" },
            {
              type: "tool_result",
              source: "tool",
              result: {
                uuid: "wiki-empty-result",
                toolName: "manageWiki",
                title: PAGE_NOT_FOUND.title,
                message: "Page not found",
                data: PAGE_NOT_FOUND,
              },
            },
          ],
        }),
    );
  });

  test("create button hidden when rendered as manageWiki result in /chat", async ({ page }) => {
    await page.goto("/chat/wiki-empty-session");
    await page.getByText("Wiki: NonExistent").click();
    await expect(page.getByRole("heading", { name: "NonExistent" })).toBeVisible();
    await expect(page.getByTestId("wiki-create-page-button")).toHaveCount(0);
    await expect(page.getByTestId("wiki-update-page-button")).toHaveCount(0);
  });
});
