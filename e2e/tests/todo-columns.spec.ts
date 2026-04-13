import { createHash } from "crypto";
import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { TODO_ITEMS, TODO_COLUMNS } from "../fixtures/todos";

// Mirror of server/utils/slug.ts for deterministic id generation in
// the mock. Keeping this inline avoids a Vite/server import boundary;
// the unit tests cover correctness of the real implementation.
function mockSlugifyColumnId(label: string): string {
  let slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_");
  // Trim leading/trailing underscores by character walk — avoids the
  // `^_+|_+$` alternation that sonarjs/slow-regex flags for
  // potential backtracking.
  let start = 0;
  while (start < slug.length && slug[start] === "_") start++;
  let end = slug.length;
  while (end > start && slug[end - 1] === "_") end--;
  slug = slug.slice(start, end);
  // eslint-disable-next-line no-control-regex
  const hasNonAscii = /[^\x00-\x7F]/.test(label);
  if (!hasNonAscii) return slug.length > 0 ? slug : "column";
  const hash = createHash("sha256")
    .update(label.trim(), "utf-8")
    .digest("base64url")
    .slice(0, 16);
  if (slug.length >= 3) return `${slug}_${hash}`;
  return hash;
}

async function setupTodoMocks(page: Page) {
  await mockAllApis(page);

  // Mutable state for column operations.
  let columns = [...TODO_COLUMNS];
  const items = [...TODO_ITEMS];

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
        const body = route.request().postDataJSON() ?? {};
        const label: string =
          typeof body.label === "string" && body.label.length > 0
            ? body.label
            : "New Column";
        const baseId = mockSlugifyColumnId(label);
        const existing = new Set(columns.map((c) => c.id));
        let id = baseId;
        let n = 2;
        while (existing.has(id)) id = `${baseId}_${n++}`;
        columns = [...columns, { id, label }];
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
    const firstColumn = page.locator('[data-testid="todo-column-backlog"]');
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

  test("adds a column with a Japanese label (#161)", async ({ page }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="todo-column-add-btn"]').click();
    const input = page.locator('input[placeholder="Review"]');
    await input.fill("完了");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // The new column's header shows the Japanese label, proving the
    // UI round-trip accepted the non-ASCII input without crashing.
    await expect(page.getByText("完了")).toBeVisible({ timeout: 5000 });
  });

  test("two distinct Japanese labels produce two distinct columns (#161)", async ({
    page,
  }) => {
    await page.goto("/chat?view=files&path=todos/todos.json");
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5000,
    });

    // First Japanese column
    await page.locator('[data-testid="todo-column-add-btn"]').click();
    await page.locator('input[placeholder="Review"]').fill("完了");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("完了")).toBeVisible({ timeout: 5000 });

    // Second Japanese column — previously would collide on id="column"
    // and the kanban board would fail to render the second column.
    await page.locator('[data-testid="todo-column-add-btn"]').click();
    await page.locator('input[placeholder="Review"]').fill("進行中です");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("進行中です")).toBeVisible({
      timeout: 5000,
    });

    // Both labels coexist → distinct column ids were generated.
    await expect(page.getByText("完了")).toBeVisible();
    await expect(page.getByText("進行中です")).toBeVisible();
  });
});
