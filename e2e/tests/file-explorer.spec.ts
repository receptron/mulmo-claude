import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Override the files/tree mock with a small fixture tree.
async function mockFileTree(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/files/tree",
    (route) =>
      route.fulfill({
        json: {
          name: "",
          path: "",
          type: "dir",
          children: [
            {
              name: "wiki",
              path: "wiki",
              type: "dir",
              children: [
                {
                  name: "hello.md",
                  path: "wiki/hello.md",
                  type: "file",
                  size: 42,
                },
              ],
            },
            {
              name: "todos",
              path: "todos",
              type: "dir",
              children: [
                {
                  name: "todos.json",
                  path: "todos/todos.json",
                  type: "file",
                  size: 100,
                },
              ],
            },
          ],
        },
      }),
  );

  // Mock file content for wiki/hello.md
  await page.route(
    (url) =>
      url.pathname === "/api/files/content" &&
      url.searchParams.get("path") === "wiki/hello.md",
    (route) =>
      route.fulfill({
        json: {
          kind: "text",
          path: "wiki/hello.md",
          content: "# Hello\n\nThis is a test.",
          size: 42,
          modifiedMs: Date.now(),
        },
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
  await mockFileTree(page);
});

test.describe("file explorer path in URL", () => {
  test("selecting a file puts ?path= in the URL", async ({ page }) => {
    // Navigate to files view
    await page.goto("/chat?view=files");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Expand the wiki dir and click hello.md
    // FileTree dirs start collapsed; click to expand
    await page.locator('[data-testid="file-tree-dir-wiki"]').click();
    await page.locator('[data-testid="file-tree-file-hello.md"]').click();

    // URL should now contain ?path=wiki/hello.md
    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("path")).toBe("wiki/hello.md");
    }).toPass({ timeout: 5000 });
  });

  test("direct URL with ?path= opens the file", async ({ page }) => {
    await page.goto("/chat?view=files&path=wiki/hello.md");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // The file content should be visible
    await expect(page.getByText("This is a test.")).toBeVisible({
      timeout: 5000,
    });
  });

  test("?path= with traversal attempt is stripped by guard", async ({
    page,
  }) => {
    await page.goto("/chat?view=files&path=../../../etc/passwd");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // The path param should be stripped
    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("path")).toBeNull();
    }).toPass({ timeout: 5000 });
  });

  test("?path= with absolute path is stripped by guard", async ({ page }) => {
    await page.goto("/chat?view=files&path=/etc/passwd");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("path")).toBeNull();
    }).toPass({ timeout: 5000 });
  });
});
