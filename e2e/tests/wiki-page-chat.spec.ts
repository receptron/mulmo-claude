// Per-page chat composer on wiki leaf pages (see plans/done/feat-wiki-page-chat.md).
//
// Sending from the composer spawns a fresh chat session with a
// "read data/wiki/pages/<slug>.md first" instruction prepended to
// the user's text.

import { test, expect, type Page, type Request } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const INDEX_PAYLOAD = {
  action: "index",
  title: "Wiki Index",
  content: "# Wiki Index\n\nRoot page.",
  pageEntries: [{ title: "Onboarding", slug: "onboarding", description: "Getting started", tags: [] }],
};

const PAGE_ONBOARDING = {
  action: "page",
  title: "Onboarding",
  pageName: "onboarding",
  content: "# Onboarding\n\nWelcome to the project.",
};

const LOG_PAYLOAD = {
  action: "log",
  title: "Activity Log",
  content: "## 2026-04-22\n- Did stuff",
};

// Simulates a traversal attempt where the server naively echoes the
// slug back as a page response. The client-side safety net must
// still refuse to send a chat prompt containing it.
const PAGE_TRAVERSAL = {
  action: "page",
  title: "../secrets",
  pageName: "../secrets",
  content: "# Escape\nCompromised.",
};

async function mockWikiApi(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/wiki",
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        const slug = new URL(req.url()).searchParams.get("slug");
        if (slug === "onboarding") return route.fulfill({ json: { data: PAGE_ONBOARDING } });
        if (slug === "../secrets") return route.fulfill({ json: { data: PAGE_TRAVERSAL } });
        return route.fulfill({ json: { data: INDEX_PAYLOAD } });
      }
      if (req.method() === "POST") {
        const body = (req.postDataJSON() ?? {}) as { action?: string; pageName?: string };
        if (body.action === "page" && body.pageName === "onboarding") {
          return route.fulfill({ json: { data: PAGE_ONBOARDING } });
        }
        if (body.action === "page" && body.pageName === "../secrets") {
          return route.fulfill({ json: { data: PAGE_TRAVERSAL } });
        }
        if (body.action === "log") return route.fulfill({ json: { data: LOG_PAYLOAD } });
        return route.fulfill({ json: { data: INDEX_PAYLOAD } });
      }
      return route.fallback();
    },
  );
}

// Capture the next POST /api/agent so tests can assert on its body.
function captureNextAgentRequest(page: Page): Promise<Request> {
  return page.waitForRequest((req) => req.url().endsWith("/api/agent") && req.method() === "POST");
}

test.describe("wiki page chat composer", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockWikiApi(page);
  });

  test("composer hidden on the index view", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByTestId("wiki-page-entry-onboarding")).toBeVisible();
    await expect(page.getByTestId("wiki-page-chat-input")).toHaveCount(0);
  });

  test("composer hidden on the log view", async ({ page }) => {
    await page.goto("/wiki/log");
    await expect(page.getByText("Did stuff")).toBeVisible();
    await expect(page.getByTestId("wiki-page-chat-input")).toHaveCount(0);
  });

  test("composer visible on a leaf page with the send button disabled when empty", async ({ page }) => {
    await page.goto("/wiki/pages/onboarding");
    await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible();
    const input = page.getByTestId("wiki-page-chat-input");
    await expect(input).toBeVisible();
    await expect(page.getByTestId("wiki-page-chat-send")).toBeDisabled();
    await input.fill("   ");
    await expect(page.getByTestId("wiki-page-chat-send")).toBeDisabled();
  });

  test("traversal URL is redirected to /wiki by the router guard", async ({ page }) => {
    // After the guard was added (plans/done/feat-wiki-path-urls.md review
    // pass), dangerous slugs like `../secrets` never reach the view —
    // the guard `replace:true`-redirects to `/wiki` before mount. So
    // the composer isn't just disabled, it doesn't exist: we should
    // land on the index with no page-chat input rendered at all.
    await page.goto("/wiki/pages/" + encodeURIComponent("../secrets"));
    await expect(page.getByTestId("wiki-page-entry-onboarding")).toBeVisible();
    await expect(page.getByTestId("wiki-page-chat-input")).toHaveCount(0);
    await expect(async () => {
      expect(new URL(page.url()).pathname).toMatch(/^\/wiki\/?$/);
    }).toPass({ timeout: 5000 });
  });

  test("sending prepends the read-page instruction and lands on /chat", async ({ page }) => {
    await page.goto("/wiki/pages/onboarding");
    await expect(page.getByTestId("wiki-page-chat-input")).toBeVisible();

    const agentReq = captureNextAgentRequest(page);
    await page.getByTestId("wiki-page-chat-input").fill("What does onboarding cover?");
    await page.getByTestId("wiki-page-chat-send").click();

    const req = await agentReq;
    const body = (req.postDataJSON() ?? {}) as { message?: string };
    // The prefix comes verbatim from View.vue::submitChat.
    expect(body.message).toContain("data/wiki/pages/onboarding.md");
    expect(body.message).toContain("What does onboarding cover?");
    // User text must follow the instruction — belt-and-suspenders.
    expect(body.message?.indexOf("data/wiki/pages/onboarding.md") ?? -1).toBeLessThan(body.message?.indexOf("What does onboarding cover?") ?? -1);

    await page.waitForURL(/\/chat\//);
    expect(page.url()).not.toContain("/wiki");
  });

  test("browser Back after sending returns to the originating wiki page", async ({ page }) => {
    // createNewSession defaults to router.replace (cheaper for
    // intra-chat /chat/:old → /chat/:new transitions), but the
    // cross-route flow from /wiki must push so the wiki URL stays in
    // history. Otherwise the user loses their way back after a quick
    // handoff.
    await page.goto("/wiki/pages/onboarding");
    await expect(page.getByTestId("wiki-page-chat-input")).toBeVisible();

    await page.getByTestId("wiki-page-chat-input").fill("What does onboarding cover?");
    await page.getByTestId("wiki-page-chat-send").click();
    await page.waitForURL(/\/chat\//);

    await page.goBack();
    await page.waitForURL(/\/wiki\/pages\/onboarding$/);
    await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible();
  });
});

test.describe("wiki page chat composer — tool-result context", () => {
  // When WikiView is rendered as a manageWiki tool result inside
  // /chat, the enclosing chat already has its own composer. Showing a
  // second composer that spawns a NEW session from here would nest
  // sessions in a confusing way, so the per-page composer is hidden.
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        {
          id: "wiki-page-session",
          title: "Wiki Page Session",
          roleId: "general",
          startedAt: "2026-04-22T10:00:00Z",
          updatedAt: "2026-04-22T10:05:00Z",
        },
      ],
    });
    await mockWikiApi(page);

    // Transcript: a single manageWiki tool result already showing the
    // Onboarding leaf page.
    await page.route(
      (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
      (route) =>
        route.fulfill({
          json: [
            { type: "session_meta", roleId: "general", sessionId: "wiki-page-session" },
            { type: "text", source: "user", message: "Show me onboarding" },
            {
              type: "tool_result",
              source: "tool",
              result: {
                uuid: "wiki-page-result",
                toolName: "manageWiki",
                title: PAGE_ONBOARDING.title,
                message: "Page loaded",
                data: PAGE_ONBOARDING,
              },
            },
          ],
        }),
    );
  });

  test("composer hidden when page rendered as a manageWiki result in /chat", async ({ page }) => {
    await page.goto("/chat/wiki-page-session");
    // Preview label (`Wiki: Onboarding`) is unique to the sidebar
    // card — using it avoids matching the `# Onboarding` heading
    // that would appear in the canvas once the page renders.
    await page.getByText("Wiki: Onboarding").click();
    // The leaf-page heading confirms WikiView is rendering the page.
    await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible();
    // And the per-page composer must not appear.
    await expect(page.getByTestId("wiki-page-chat-input")).toHaveCount(0);
    await expect(page.getByTestId("wiki-page-chat-send")).toHaveCount(0);
  });
});
