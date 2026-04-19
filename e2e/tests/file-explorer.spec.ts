import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { WORKSPACE_FILES } from "../../src/config/workspacePaths";

// Override the lazy-expand endpoint with a small fixture tree. Each
// directory returns its immediate children only — recursion is
// emulated by the client via subsequent fetches on expand.
async function mockFileTree(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/files/dir",
    (route) => {
      const path =
        new URL(route.request().url()).searchParams.get("path") ?? "";
      if (path === "") {
        return route.fulfill({
          json: {
            name: "",
            path: "",
            type: "dir",
            children: [
              { name: "data", path: "data", type: "dir" },
              { name: "wiki", path: "wiki", type: "dir" },
            ],
          },
        });
      }
      if (path === "wiki") {
        return route.fulfill({
          json: {
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
        });
      }
      if (path === "data") {
        return route.fulfill({
          json: {
            name: "data",
            path: "data",
            type: "dir",
            children: [{ name: "todos", path: "data/todos", type: "dir" }],
          },
        });
      }
      if (path === "data/todos") {
        return route.fulfill({
          json: {
            name: "todos",
            path: "data/todos",
            type: "dir",
            children: [
              {
                name: "todos.json",
                path: WORKSPACE_FILES.todosItems,
                type: "file",
                size: 100,
              },
            ],
          },
        });
      }
      return route.fulfill({
        json: { name: path, path, type: "dir", children: [] },
      });
    },
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
    await page.goto("/chat?view=files");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Wait for the root dir's shallow listing to land — with lazy
    // expand (#200 phase 2), the tree only renders children after
    // `/api/files/dir?path=` resolves.
    await expect(
      page.locator('[data-testid="file-tree-dir-wiki"]'),
    ).toBeVisible();

    // Expand the wiki dir and click hello.md. FileTree dirs start
    // collapsed; click toggles expand + triggers a lazy-fetch of
    // wiki's children (resolved by the mockFileTree dispatcher).
    await page.locator('[data-testid="file-tree-dir-wiki"]').click();
    await expect(
      page.locator('[data-testid="file-tree-file-hello.md"]'),
    ).toBeVisible();
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
