import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { TODO_ITEMS, TODO_COLUMNS, type TodoFixture } from "../fixtures/todos";

async function setupTodoMocks(page: Page) {
  await mockAllApis(page);

  // Mutable state for column operations.
  let columns = [...TODO_COLUMNS];
  let items = [...TODO_ITEMS];

  const buildResponse = () => ({ data: { items, columns } });

  await page.route(
    (url) => url.pathname === "/api/todos",
    (route) => route.fulfill({ json: buildResponse() }),
  );

  // Column operations — return updated state.
  await page.route(
    (url) => url.pathname.startsWith("/api/todos/columns"),
    (route) => {
      const method = route.request().method();
      if (method === "POST") {
        // Add column
        columns = [
          ...columns,
          { id: "new_col", label: "New Column" },
        ];
      } else if (method === "DELETE") {
        const id = route.request().url().split("/api/todos/columns/").pop();
        columns = columns.filter((c) => c.id !== id);
      } else if (method === "PATCH") {
        const id = route.request().url().split("/api/todos/columns/").pop();
        columns = columns.map((c) =>
          c.id === id ? { ...c, label: "Renamed" } : c,
        );
      }
      return route.fulfill({ json: buildResponse() });
    },
  );

  await page.route(
    (url) => url.pathname.startsWith("/api/todos/items"),
    (route) => route.fulfill({ json: buildResponse() }),
  );

  await page.route(
    (url) =>
      url.pathname === "/api/files/content" &&
      url.searchParams.get("path") === "todos/todos.json",
    (route) =>
      route.fulfill({
        json: {
          kind: "text",
          path: "todos/todos.json",
          content: JSON.stringify(items),
          size: 500,
          modifiedMs: Date.now(),
        },
      }),
  );

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
}

test.describe("Todo column management", () => {
  test.beforeEach(async ({ page }) => {
    await setupTodoMocks(page);
  });

  test("+ Column button opens add-column dialog", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-column-add-btn"]').click();
    await expect(page.getByText("Add Column")).toBeVisible();
  });

  test("column header menu opens on click", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    // Click the first column's menu button (more_horiz icon)
    const firstColumn = page.locator(
      '[data-testid="todo-column-backlog"]',
    );
    await firstColumn.locator("text=more_horiz").click();
    await expect(page.getByText("Rename")).toBeVisible();
    await expect(page.getByText("Delete column")).toBeVisible();
  });

  test("Escape closes the add-column dialog", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-column-add-btn"]').click();
    await expect(page.getByText("Add Column")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Add Column")).not.toBeVisible();
  });

  test("all 4 kanban columns are rendered", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    // Check columns exist via data-testid (more reliable than text)
    await expect(
      page.locator('[data-testid="todo-column-backlog"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="todo-column-todo"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="todo-column-in_progress"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="todo-column-done"]'),
    ).toBeVisible();
  });

  test("menu shows Mark as done column option", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    // Open a non-done column's menu
    const todoColumn = page.locator('[data-testid="todo-column-todo"]');
    await todoColumn.locator("text=more_horiz").click();
    await expect(page.getByText("Mark as done column")).toBeVisible();
  });

  test("done column's menu shows Already done column", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    const doneColumn = page.locator('[data-testid="todo-column-done"]');
    await doneColumn.locator("text=more_horiz").click();
    await expect(page.getByText("Already done column")).toBeVisible();
  });
});
