// Plugin launcher buttons that sit above the canvas, to the left of
// the view-mode toggle. "view" buttons (todos, scheduler, files) switch
// the canvas view mode directly. "invoke" buttons (skills, wiki, roles)
// call the matching plugin's REST endpoint locally (no LLM round-trip),
// push the resulting ToolResult into the current session, and switch
// the canvas to single view.
//
// First slice of issue #253.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

test.describe("plugin launcher — view path", () => {
  test("Todos button switches canvas to todos view", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-todos").click();

    await page.waitForURL(/view=todos/);
    expect(page.url()).toContain("view=todos");
  });

  test("Scheduler button switches canvas to scheduler view", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-scheduler").click();

    await page.waitForURL(/view=scheduler/);
    expect(page.url()).toContain("view=scheduler");
  });

  test("Files button switches canvas to files view", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-files").click();

    await page.waitForURL(/view=files/);
    expect(page.url()).toContain("view=files");
    expect(page.url()).not.toContain("path=");
  });
});

test.describe("plugin launcher — invoke path", () => {
  test("Skills button hits GET /api/skills + surfaces the skills View", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/api/skills",
      (route) =>
        route.fulfill({
          json: {
            skills: [
              {
                name: "daily-plan",
                description: "Generate a daily plan",
                source: "user",
              },
            ],
          },
        }),
    );

    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-skills").click();

    // The skills View renders each skill with its own testid.
    await expect(page.getByTestId("skill-item-daily-plan")).toBeVisible();
  });

  test("Wiki button hits POST /api/wiki + surfaces page entries", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/api/wiki",
      (route) =>
        route.fulfill({
          json: {
            data: {
              action: "index",
              title: "Wiki",
              content: "",
              pageEntries: [
                {
                  slug: "home",
                  title: "Welcome home page",
                  description: "",
                },
              ],
            },
            title: "Wiki",
            message: "1 page",
          },
        }),
    );

    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-wiki").click();

    // The wiki View renders page entries as cards containing the title.
    await expect(page.getByText("Welcome home page").first()).toBeVisible();
  });

  test("endpoint error surfaces as a text-response in the stack", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/api/skills",
      (route) =>
        route.fulfill({
          status: 500,
          json: { error: "boom" },
        }),
    );

    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-skills").click();

    await expect(
      page.getByText("manageSkills failed: boom").first(),
    ).toBeVisible();
  });
});
