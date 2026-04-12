import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const SCRIPT_TITLE = "Test Mulmo Script";
const SCRIPT_DESCRIPTION = "A short test script used by the smoke test.";

const SAMPLE_SCRIPT = {
  $mulmocast: { version: "1.1" },
  title: SCRIPT_TITLE,
  description: SCRIPT_DESCRIPTION,
  lang: "en",
  beats: [
    {
      speaker: "Narrator",
      text: "Beat one narration.",
      image: {
        type: "textSlide",
        slide: { title: "Slide 1", bullets: ["one"] },
      },
    },
    {
      speaker: "Narrator",
      text: "Beat two narration.",
      imagePrompt: "Something visual",
    },
  ],
  imageParams: {},
};

async function setupScriptSession(page: Page) {
  await mockAllApis(page, {
    sessions: [
      {
        id: "mulmo-session",
        title: "Mulmo Session",
        roleId: "general",
        startedAt: "2026-04-12T10:00:00Z",
        updatedAt: "2026-04-12T10:05:00Z",
      },
    ],
  });

  // Session transcript with a presentMulmoScript tool result.
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/sessions/") &&
      url.pathname !== "/api/sessions",
    (route) => {
      return route.fulfill({
        json: [
          {
            type: "session_meta",
            roleId: "general",
            sessionId: "mulmo-session",
          },
          { type: "text", source: "user", message: "Make me a slideshow" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "mulmo-result-1",
              toolName: "presentMulmoScript",
              title: SCRIPT_TITLE,
              message: "Script saved",
              data: {
                script: SAMPLE_SCRIPT,
                filePath: "scripts/test-mulmo-script.json",
              },
            },
          },
        ],
      });
    },
  );

  // Stub every mulmo-script endpoint the View touches on mount. All
  // of them are allowed to fail silently in View.vue's code (try/catch
  // with `// silently ignore`), so a 200 with an empty payload is
  // enough to keep the UI stable.
  await page.route(
    (url) => url.pathname.startsWith("/api/mulmo-script/"),
    (route) => {
      return route.fulfill({ json: {} });
    },
  );
}

test.describe("presentMulmoScript plugin", () => {
  test.beforeEach(async ({ page }) => {
    await setupScriptSession(page);
  });

  test("Preview shows the script title in the sidebar", async ({ page }) => {
    await page.goto("/chat/mulmo-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // The Preview component in the sidebar renders the script title.
    await expect(page.getByText(SCRIPT_TITLE).first()).toBeVisible();
  });

  test("View renders script title, description and beat count when selected", async ({
    page,
  }) => {
    await page.goto("/chat/mulmo-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Click the sidebar preview to select the tool result → View
    // mounts in the canvas (single view mode is the default).
    await page.getByText(SCRIPT_TITLE).first().click();

    // View header: title, description (as a <p>, not the sidebar's
    // <div>), and "N beats" live text.
    await expect(
      page.getByRole("heading", { name: SCRIPT_TITLE, level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("paragraph").filter({ hasText: SCRIPT_DESCRIPTION }),
    ).toBeVisible();
    await expect(page.getByText("2 beats")).toBeVisible();
  });

  test("View does not crash when the mulmo-script API endpoints return empty", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/chat/mulmo-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText(SCRIPT_TITLE).first().click();

    // Give the View a beat to mount and kick off its fetches.
    await page.waitForTimeout(500);
    // Title should be rendered; no uncaught exceptions should fire.
    await expect(
      page.getByRole("heading", { name: SCRIPT_TITLE, level: 2 }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
