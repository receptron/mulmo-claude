import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { setupMutableTodoMocks } from "../fixtures/todos-mutable";
import { TODO_COLUMNS } from "../fixtures/todos";
import { WORKSPACE_FILES } from "../../src/config/workspacePaths";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";
const TODOS_URL = `/chat?view=files&path=${WORKSPACE_FILES.todosItems}`;

// Read-only TodoExplorer spec — the kanban / list / search / add-dialog
// flows exercised here don't persist mutations, so we reuse the shared
// mutable-state fixture with no dispatchers (missing dispatchers echo
// the current state, which is exactly the behaviour this spec wants).
async function setupTodoMocks(page: Page) {
  await mockAllApis(page);
  await setupMutableTodoMocks(page);
}

test.describe("Todo Explorer", () => {
  test.beforeEach(async ({ page }) => {
    await setupTodoMocks(page);
  });

  test("opens TodoExplorer when selecting data/todos/todos.json in files view", async ({ page }) => {
    await page.goto(TODOS_URL);
    // Wait for the TodoExplorer to render (it has the "Todo" heading).
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });
  });

  test("kanban view shows 4 status columns", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    for (const col of TODO_COLUMNS) {
      await expect(page.locator(`[data-testid="todo-column-${col.id}"]`)).toBeVisible();
    }
  });

  test("kanban view shows todo cards with text", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // Check some card texts are visible
    await expect(page.getByText("Buy groceries")).toBeVisible();
    await expect(page.getByText("Write report")).toBeVisible();
    await expect(page.getByText("Fix login bug")).toBeVisible();
  });

  test("switching to table view shows a table", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-view-table"]').click();
    // Table should show column headers
    await expect(page.getByText("Status")).toBeVisible();
    await expect(page.getByText("Priority")).toBeVisible();
  });

  test("switching to list view shows a flat list", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-view-list"]').click();
    // List items should be visible as checkboxes
    await expect(page.getByText("Buy groceries")).toBeVisible();
    await expect(page.getByText("Clean kitchen")).toBeVisible();
  });

  test("search filters items", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // Switch to list view for simpler checking
    await page.locator('[data-testid="todo-view-list"]').click();

    await page.locator('[data-testid="todo-search"]').fill("bug");
    // Only "Fix login bug" should match
    await expect(page.getByText("Fix login bug")).toBeVisible();
    await expect(page.getByText("Buy groceries")).not.toBeVisible();
  });

  test("label filter chips are shown when labels exist", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // Labels bar should show the label names. Use locator with
    // exact: false since labels might be inside button chips.
    await expect(page.locator("text=work").first()).toBeVisible();
    await expect(page.locator("text=personal").first()).toBeVisible();
  });

  test("priority badges are displayed on cards", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // Priority badges — use locator since getByText with exact
    // matching might miss badges nested in spans.
    await expect(page.locator("text=Urgent").first()).toBeVisible();
    await expect(page.locator("text=High").first()).toBeVisible();
  });

  test("completed count is shown in the header", async ({ page }) => {
    await page.goto(TODOS_URL);
    // "1/5 done" — 1 completed out of 5
    await expect(page.getByText("1/5 done")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  });

  test("+ Add button opens the add dialog", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-add-btn"]').click();
    await expect(page.getByText("Add Todo")).toBeVisible();
    // The dialog should have a text input and status select
    await expect(page.locator('input[placeholder="What needs doing?"]')).toBeVisible();
  });

  test("Escape closes the add dialog", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-add-btn"]').click();
    await expect(page.getByText("Add Todo")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Add Todo")).not.toBeVisible();
  });

  test("clicking a kanban card opens the edit dialog", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // Click the first card
    await page.locator('[data-testid="todo-card-todo_a"]').click();
    await expect(page.getByText("Edit Todo")).toBeVisible();
  });

  test("Escape closes the edit dialog", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-card-todo_a"]').click();
    await expect(page.getByText("Edit Todo")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Edit Todo")).not.toBeVisible();
  });

  test("checkbox is rendered for each item in list view", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-view-list"]').click();
    // Each list item has a checkbox
    const checkboxes = page.locator('input[type="checkbox"]');
    await expect(async () => {
      expect(await checkboxes.count()).toBeGreaterThanOrEqual(5);
    }).toPass({ timeout: 5 * ONE_SECOND_MS });
  });

  test("delete button (✕) is visible on hover in list view", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-view-list"]').click();
    // Hover over a list item to reveal the ✕ button
    await page.getByText("Buy groceries").hover();
    await expect(page.locator("text=✕").first()).toBeVisible();
  });
});
