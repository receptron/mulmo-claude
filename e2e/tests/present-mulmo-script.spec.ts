import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

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
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
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
      }),
  );

  // Stub every mulmo-script endpoint the View touches on mount. All
  // of them are allowed to fail silently in View.vue's code (try/catch
  // with `// silently ignore`), so a 200 with an empty payload is
  // enough to keep the UI stable.
  await page.route(
    (url) => url.pathname.startsWith("/api/mulmo-script/"),
    (route) => route.fulfill({ json: {} }),
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

  test("View renders script title, description and beat count when selected", async ({ page }) => {
    await page.goto("/chat/mulmo-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Click the sidebar preview to select the tool result → View
    // mounts in the canvas (single view mode is the default).
    await page.getByText(SCRIPT_TITLE).first().click();

    // View header: title, description (as a <p>, not the sidebar's
    // <div>), and "N beats" live text.
    await expect(page.getByRole("heading", { name: SCRIPT_TITLE, level: 2 })).toBeVisible();
    await expect(page.getByRole("paragraph").filter({ hasText: SCRIPT_DESCRIPTION })).toBeVisible();
    await expect(page.getByText("2 beats")).toBeVisible();
  });

  test("View does not crash when the mulmo-script API endpoints return empty", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/chat/mulmo-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText(SCRIPT_TITLE).first().click();

    // Give the View a beat to mount and kick off its fetches.
    await page.waitForTimeout(ONE_SECOND_MS / 2);
    // Title should be rendered; no uncaught exceptions should fire.
    await expect(page.getByRole("heading", { name: SCRIPT_TITLE, level: 2 })).toBeVisible();
    expect(errors).toEqual([]);
  });

  // The refactored server handlers all go through withStoryContext →
  // `{ error: <string> }` on failure, `{ image: "data:..." }` on
  // success. The View reads exactly those shapes, so the frontend
  // wiring is the regression net for the refactor.

  test("render-beat success: mocked image surfaces in the View", async ({ page }) => {
    // 1×1 transparent PNG.
    const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

    const renderBeatCalls: unknown[] = [];
    await page.route(
      (url) => url.pathname === "/api/mulmo-script/render-beat",
      async (route) => {
        renderBeatCalls.push(route.request().postDataJSON());
        return route.fulfill({ json: { image: PNG_1X1 } });
      },
    );

    await page.goto("/chat/mulmo-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText(SCRIPT_TITLE).first().click();
    await expect(page.getByRole("heading", { name: SCRIPT_TITLE, level: 2 })).toBeVisible();

    // Beat 0 is a textSlide → auto-rendered on mount via renderBeat,
    // which hits /api/mulmo-script/render-beat. Wait for the mocked
    // image to surface in the DOM — proves the server→frontend
    // contract (`{ image: <data-uri> }` on 200) still holds through
    // the withStoryContext refactor.
    await page.waitForFunction(() => Array.from(document.querySelectorAll("img")).some((img) => img.src.startsWith("data:image/png;base64,iVBOR")), undefined, {
      timeout: 5 * ONE_SECOND_MS,
    });

    expect(renderBeatCalls.length).toBeGreaterThan(0);
    for (const call of renderBeatCalls) {
      expect(call).toMatchObject({
        filePath: expect.any(String),
        beatIndex: expect.any(Number),
      });
    }
  });

  test("render-beat error: mocked { error } surfaces to the UI", async ({ page }) => {
    await page.route(
      (url) => url.pathname === "/api/mulmo-script/render-beat",
      (route) =>
        route.fulfill({
          status: 500,
          json: { error: "Image was not generated" },
        }),
    );

    await page.goto("/chat/mulmo-session");
    await page.getByText(SCRIPT_TITLE).first().click();
    await expect(page.getByRole("heading", { name: SCRIPT_TITLE, level: 2 })).toBeVisible();

    // Auto-render on mount hits render-beat for textSlide beats,
    // which now returns 500 { error }. The View renders the error
    // string in the placeholder slot.
    await expect(page.getByText("Image was not generated")).toBeVisible();
  });

  // E2E for the update-beat save-failure UX is covered manually —
  // see docs/manual-testing.md. It kept flaking when run in the full
  // suite (the Update button fetch was occasionally never seen by the
  // per-test mock even though it passed in isolation), so the check
  // lives in manual testing rather than gating CI.

  // Regression for #839 + the in-PR follow-up. The slide view must
  // light up the shared ThinkingIndicator while the active session
  // has a chat turn in flight — same signal the chat sidebar uses,
  // not just the slide-local generation flags.
  test("ThinkingIndicator lights up when the active session is running", async ({ page }) => {
    // Override only the session-list endpoint so mulmo-session
    // reports isRunning=true. setupScriptSession (in beforeEach)
    // already mocks everything else; calling mockAllApis again
    // would clobber the script transcript route. Playwright routes
    // are LIFO, so this added handler takes precedence.
    await page.route(
      (url) => url.pathname === "/api/sessions",
      (route) =>
        route.fulfill({
          json: {
            sessions: [
              {
                id: "mulmo-session",
                title: "Mulmo Session",
                roleId: "general",
                startedAt: "2026-04-12T10:00:00Z",
                updatedAt: "2026-04-12T10:05:00Z",
                isRunning: true,
              },
            ],
            cursor: "v1:0",
            deletedIds: [],
          },
        }),
    );

    await page.goto("/chat/mulmo-session");
    await page.getByText(SCRIPT_TITLE).first().click();
    await expect(page.getByRole("heading", { name: SCRIPT_TITLE, level: 2 })).toBeVisible();

    // The indicator lives in the chat sidebar (above ChatInput),
    // not inside the slide view itself — App.vue is now the
    // canonical mount slot.
    //
    // Two complementary assertions:
    //   1. Page-wide count == 1 catches duplicate role=status
    //      regions reappearing anywhere in the DOM (Codex iter-1).
    //   2. The sidebar-scoped lookup pins the canonical mount slot
    //      so a stray copy outside the sidebar would still fail
    //      the count check above (Codex iter-2/3).
    await expect(page.getByTestId("thinking-indicator")).toHaveCount(1);
    const sidebarIndicator = page.getByTestId("chat-sidebar").getByTestId("thinking-indicator");
    await expect(sidebarIndicator).toBeVisible();
    await expect(sidebarIndicator).toContainText("Thinking");
  });
});
