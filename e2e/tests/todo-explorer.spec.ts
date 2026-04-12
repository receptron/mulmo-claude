import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { TODOS_RESPONSE, TODO_ITEMS, TODO_COLUMNS } from "../fixtures/todos";

// Override todo + file mocks so TodoExplorer renders.
async function setupTodoMocks(page: Page) {
  await mockAllApis(page);

  // Override todos with fixture data (registered AFTER mockAllApis
  // so Playwright checks it first).
  await page.route(
    (url) => url.pathname === "/api/todos",
    (route) => route.fulfill({ json: TODOS_RESPONSE }),
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/todos/"),
    (route) => {
      // POST/PATCH/DELETE — return the same fixture for simplicity.
      return route.fulfill({ json: TODOS_RESPONSE });
    },
  );

  // File tree with todos/todos.json so the file explorer can open it.
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
              name: "todos",
              path: "todos",
              type: "dir",
              children: [
                {
                  name: "todos.json",
                  path: "todos/todos.json",
                  type: "file",
                  size: 500,
                },
              ],
            },
          ],
        },
      }),
  );

  // File content for todos.json (needed by FilesView to detect the
  // special-case TodoExplorer rendering).
  await page.route(
    (url) =>
      url.pathname === "/api/files/content" &&
      url.searchParams.get("path") === "todos/todos.json",
    (route) =>
      route.fulfill({
        json: {
          kind: "text",
          path: "todos/todos.json",
          content: JSON.stringify(TODO_ITEMS),
          size: 500,
          modifiedMs: Date.now(),
        },
      }),
  );
}

test.describe("Todo Explorer", () => {
  test.beforeEach(async ({ page }) => {
    await setupTodoMocks(page);
  });

  test("opens TodoExplorer when selecting todos/todos.json in files view", async ({
    page,
  }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    // Wait for the TodoExplorer to render (it has the "Todo" heading).
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("kanban view shows 4 status columns", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    for (const col of TODO_COLUMNS) {
      await expect(
        page.locator(`[data-testid="todo-column-${col.id}"]`),
      ).toBeVisible();
    }
  });

  test("kanban view shows todo cards with text", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    // Check some card texts are visible
    await expect(page.getByText("Buy groceries")).toBeVisible();
    await expect(page.getByText("Write report")).toBeVisible();
    await expect(page.getByText("Fix login bug")).toBeVisible();
  });

  test("switching to table view shows a table", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-view-table"]').click();
    // Table should show column headers
    await expect(page.getByText("Status")).toBeVisible();
    await expect(page.getByText("Priority")).toBeVisible();
  });

  test("switching to list view shows a flat list", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-view-list"]').click();
    // List items should be visible as checkboxes
    await expect(page.getByText("Buy groceries")).toBeVisible();
    await expect(page.getByText("Clean kitchen")).toBeVisible();
  });

  test("search filters items", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    // Switch to list view for simpler checking
    await page.locator('[data-testid="todo-view-list"]').click();

    await page.locator('[data-testid="todo-search"]').fill("bug");
    // Only "Fix login bug" should match
    await expect(page.getByText("Fix login bug")).toBeVisible();
    await expect(page.getByText("Buy groceries")).not.toBeVisible();
  });

  test("label filter chips are shown when labels exist", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    // Labels bar should show the label names. Use locator with
    // exact: false since labels might be inside button chips.
    await expect(page.locator("text=work").first()).toBeVisible();
    await expect(page.locator("text=personal").first()).toBeVisible();
  });

  test("priority badges are displayed on cards", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    // Priority badges — use locator since getByText with exact
    // matching might miss badges nested in spans.
    await expect(page.locator("text=Urgent").first()).toBeVisible();
    await expect(page.locator("text=High").first()).toBeVisible();
  });

  test("completed count is shown in the header", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    // "1/5 done" — 1 completed out of 5
    await expect(page.getByText("1/5 done")).toBeVisible({ timeout: 5000 });
  });

  test("+ Add button opens the add dialog", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-add-btn"]').click();
    await expect(page.getByText("Add Todo")).toBeVisible();
    // The dialog should have a text input and status select
    await expect(page.locator('input[placeholder="What needs doing?"]')).toBeVisible();
  });

  test("Escape closes the add dialog", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-add-btn"]').click();
    await expect(page.getByText("Add Todo")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Add Todo")).not.toBeVisible();
  });

  test("clicking a kanban card opens the edit dialog", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    // Click the first card
    await page.locator('[data-testid="todo-card-todo_a"]').click();
    await expect(page.getByText("Edit Todo")).toBeVisible();
  });

  test("Escape closes the edit dialog", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-card-todo_a"]').click();
    await expect(page.getByText("Edit Todo")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Edit Todo")).not.toBeVisible();
  });

  test("checkbox is rendered for each item in list view", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-view-list"]').click();
    // Each list item has a checkbox
    const checkboxes = page.locator('input[type="checkbox"]');
    await expect(async () => {
      expect(await checkboxes.count()).toBeGreaterThanOrEqual(5);
    }).toPass({ timeout: 5000 });
  });

  test("delete button (✕) is visible on hover in list view", async ({
    page,
  }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-view-list"]').click();
    // Hover over a list item to reveal the ✕ button
    await page.getByText("Buy groceries").hover();
    await expect(page.locator("text=✕").first()).toBeVisible();
  });
});
