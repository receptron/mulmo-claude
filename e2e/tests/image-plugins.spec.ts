import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// A 1x1 red PNG as base64 for testing image rendering.
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

async function setupImageSession(page: Page) {
  await mockAllApis(page, {
    sessions: [
      {
        id: "img-session",
        title: "Image Session",
        roleId: "general",
        startedAt: "2026-04-12T10:00:00Z",
        updatedAt: "2026-04-12T10:05:00Z",
      },
    ],
  });

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
            sessionId: "img-session",
          },
          { type: "text", source: "user", message: "Generate an image" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "result-gen-1",
              toolName: "generateImage",
              message: "Image generated",
              title: "Generated Image",
              data: {
                imageData: "images/test123.png",
                prompt: "A sunset over mountains",
              },
            },
          },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "result-empty-1",
              toolName: "generateImage",
              message: "No image",
              title: "Failed Image",
              data: { imageData: "", prompt: "Something" },
            },
          },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "result-legacy-1",
              toolName: "generateImage",
              message: "Legacy image",
              title: "Legacy Image",
              data: {
                imageData: `data:image/png;base64,${TINY_PNG}`,
                prompt: "Legacy test",
              },
            },
          },
        ],
      });
    },
  );

  await page.route(
    (url) =>
      url.pathname === "/api/files/raw" &&
      typeof url.searchParams.get("path") === "string",
    (route) => {
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(TINY_PNG, "base64"),
      });
    },
  );
}

test.describe("image plugin rendering", () => {
  test.beforeEach(async ({ page }) => {
    await setupImageSession(page);
  });

  test("image session loads without crashing", async ({ page }) => {
    await page.goto("/chat/img-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // The session has tool results — at least one image should render.
    // The sidebar shows preview components for each result.
    await page.waitForTimeout(1000);
    // No crash, page is interactive.
    await expect(page.getByText("Generate an image")).toBeVisible();
  });

  test("empty imageData does not produce a broken <img> tag", async ({
    page,
  }) => {
    await page.goto("/chat/img-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.waitForTimeout(1000);
    // No <img> with empty src should exist.
    const brokenImages = page.locator('img[src=""]');
    await expect(brokenImages).toHaveCount(0);
  });

  test("legacy data URI image renders as an actual <img>", async ({ page }) => {
    await page.goto("/chat/img-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.waitForTimeout(1000);
    // At least one <img> with a data: src should exist (the legacy entry).
    const dataImages = page.locator('img[src^="data:image"]');
    await expect(async () => {
      expect(await dataImages.count()).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 5000 });
  });

  test("file-path image uses /api/files/raw for src", async ({ page }) => {
    await page.goto("/chat/img-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.waitForTimeout(1000);
    // At least one <img> with a /api/files/raw src should exist.
    const fileImages = page.locator('img[src*="/api/files/raw"]');
    await expect(async () => {
      expect(await fileImages.count()).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 5000 });
  });
});
