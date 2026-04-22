// Per-page chat composer on wiki leaf pages (see plans/feat-wiki-page-chat.md).
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
  pageEntries: [{ title: "Onboarding", slug: "onboarding", description: "Getting started" }],
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

async function mockWikiApi(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/wiki",
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        const slug = new URL(req.url()).searchParams.get("slug");
        if (slug === "onboarding") return route.fulfill({ json: { data: PAGE_ONBOARDING } });
        return route.fulfill({ json: { data: INDEX_PAYLOAD } });
      }
      if (req.method() === "POST") {
        const body = (req.postDataJSON() ?? {}) as { action?: string; pageName?: string };
        if (body.action === "page" && body.pageName === "onboarding") {
          return route.fulfill({ json: { data: PAGE_ONBOARDING } });
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
    await page.goto("/wiki?view=log");
    await expect(page.getByText("Did stuff")).toBeVisible();
    await expect(page.getByTestId("wiki-page-chat-input")).toHaveCount(0);
  });

  test("composer visible on a leaf page with the send button disabled when empty", async ({ page }) => {
    await page.goto("/wiki?page=onboarding");
    await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible();
    const input = page.getByTestId("wiki-page-chat-input");
    await expect(input).toBeVisible();
    await expect(page.getByTestId("wiki-page-chat-send")).toBeDisabled();
    await input.fill("   ");
    await expect(page.getByTestId("wiki-page-chat-send")).toBeDisabled();
  });

  test("sending prepends the read-page instruction and lands on /chat", async ({ page }) => {
    await page.goto("/wiki?page=onboarding");
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
});
