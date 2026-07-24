// E2E: the standalone /collections/:slug table's filter menu
// (plans/done/feat-collection-flag-fields.md, reframing #2174). Predicate-shaped
// fields — `flag`, `boolean`, `toggle` — each get a tri-state entry
// (all → hide → only) in a dropdown behind a single "Filters" trigger; the
// entries narrow the table rows and persist per-collection in localStorage.
// A legacy completion-pair schema (no flag field) gets a synthesized "done"
// entry driven by the same predicate, so hide-completed works without a
// schema edit.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const TASKS = {
  collection: {
    slug: "tasks",
    title: "Tasks",
    icon: "checklist",
    source: "user",
    schema: {
      title: "Tasks",
      icon: "checklist",
      dataPath: "data/tasks/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
        status: { type: "enum", label: "Status", values: ["todo", "doing", "done", "canceled"] },
        urgent: { type: "boolean", label: "Urgent" },
        finished: { type: "toggle", label: "Finished", field: "status", onValue: "done", offValue: "todo" },
        isDone: { type: "flag", label: "Done", where: [{ field: "status", op: "in", value: ["done", "canceled"] }] },
        // Deliberately named after an Object.prototype member: chip-state
        // lookups must read OWN properties, or this chip reads the
        // inherited function as "active" and can never cycle.
        toString: { type: "flag", label: "Open", where: [{ field: "status", op: "eq", value: "todo" }] },
      },
    },
  },
  items: [
    { id: "t1", name: "Open task", status: "todo", urgent: true },
    { id: "t2", name: "Finished task", status: "done", urgent: false },
    { id: "t3", name: "Dropped task", status: "canceled" },
  ],
};

// Same records, but done-ness declared ONLY via the legacy completion
// pair — no flag field in the schema.
const TODOS = {
  collection: {
    slug: "todos",
    title: "Todos",
    icon: "check_circle",
    source: "user",
    schema: {
      title: "Todos",
      icon: "check_circle",
      dataPath: "data/todos/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
        status: { type: "enum", label: "Status", values: ["todo", "done"] },
      },
      completionField: "status",
      completionDoneValues: ["done"],
    },
  },
  items: [
    { id: "t1", name: "Open todo", status: "todo" },
    { id: "t2", name: "Finished todo", status: "done" },
  ],
};

// The real-world todos shape: a "Done" toggle projecting the status enum
// AND the legacy completion pair over the same value. The toggle's chip
// expresses the completion predicate exactly, so NO extra done chip may
// be synthesized (else the menu shows two "Done" filters).
const CHORES = {
  collection: {
    slug: "chores",
    title: "Chores",
    icon: "checklist",
    source: "user",
    schema: {
      title: "Chores",
      icon: "checklist",
      dataPath: "data/chores/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        done: { type: "toggle", label: "Done", field: "status", onValue: "done", offValue: "todo" },
        name: { type: "string", label: "Name" },
        status: { type: "enum", label: "Status", values: ["todo", "done"] },
      },
      completionField: "status",
      completionDoneValues: ["done"],
    },
  },
  items: [
    { id: "c1", name: "Open chore", status: "todo" },
    { id: "c2", name: "Finished chore", status: "done" },
  ],
};

async function mockCollection(page: Page, slug: string, payload: object): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/collections/${slug}`,
    (route) => route.fulfill({ json: payload }),
  );
}

/** Open the "Filters" dropdown that hosts the chips. */
async function openFilterMenu(page: Page): Promise<void> {
  await page.getByTestId("collections-filter-menu").click();
  await expect(page.getByTestId("collections-filter-menu-panel")).toBeVisible();
}

/** Assert exactly `ids` render as table rows (order-insensitive here —
 *  the chip filters, sorting is pinned elsewhere). */
async function expectRows(page: Page, ids: string[]): Promise<void> {
  const rows = page.locator('[data-testid^="collections-row-"]');
  await expect(rows).toHaveCount(ids.length);
  for (const rowId of ids) {
    await expect(page.getByTestId(`collections-row-${rowId}`)).toBeVisible();
  }
}

test("flag chip cycles all → hide → only, filters the table, and persists", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "tasks", TASKS);

  await page.goto("/collections/tasks");
  await expectRows(page, ["t1", "t2", "t3"]);

  await openFilterMenu(page);
  const chip = page.getByTestId("collections-flag-chip-isDone");
  await expect(chip).toContainText("Done");

  // hide → only the open task remains; the menu stays open for chaining.
  await chip.click();
  await expectRows(page, ["t1"]);

  // only → just the done/canceled rows.
  await chip.click();
  await expectRows(page, ["t2", "t3"]);

  // Reload: the "only" state must survive (localStorage, keyed by slug)
  // and show on the collapsed trigger as an active-count badge.
  await page.reload();
  await expectRows(page, ["t2", "t3"]);
  await expect(page.getByTestId("collections-filter-menu")).toContainText("1");

  // Third click clears the filter → everything again.
  await openFilterMenu(page);
  await page.getByTestId("collections-flag-chip-isDone").click();
  await expectRows(page, ["t1", "t2", "t3"]);
});

test("boolean and toggle fields get filter chips too", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "tasks", TASKS);

  await page.goto("/collections/tasks");
  await expectRows(page, ["t1", "t2", "t3"]);
  await openFilterMenu(page);

  // boolean: hide urgent (t1) → only urgent → back to all.
  const urgent = page.getByTestId("collections-flag-chip-urgent");
  await urgent.click();
  await expectRows(page, ["t2", "t3"]);
  await urgent.click();
  await expectRows(page, ["t1"]);
  await urgent.click();
  await expectRows(page, ["t1", "t2", "t3"]);

  // toggle: checked ⇔ projected enum equals onValue ("done" — t2 only;
  // the canceled row is NOT the toggle's on-state even though the isDone
  // flag counts it).
  const finished = page.getByTestId("collections-flag-chip-finished");
  await finished.click(); // hide
  await expectRows(page, ["t1", "t3"]);
  await finished.click(); // only
  await expectRows(page, ["t2"]);
});

test("a flag named after an Object.prototype member still cycles", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "tasks", TASKS);

  await page.goto("/collections/tasks");
  await expectRows(page, ["t1", "t2", "t3"]);
  await openFilterMenu(page);

  // `toString` shadows Object.prototype — a plain-object lookup would read
  // the inherited function, leaving this chip stuck in the default state.
  const chip = page.getByTestId("collections-flag-chip-toString");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click(); // hide the open task
  await expectRows(page, ["t2", "t3"]);
  await chip.click(); // only the open task
  await expectRows(page, ["t1"]);
  await chip.click(); // back to all
  await expectRows(page, ["t1", "t2", "t3"]);
  await expect(chip).toHaveAttribute("aria-pressed", "false");
});

test("flag cells render as read-only checks in the table", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "tasks", TASKS);

  await page.goto("/collections/tasks");
  await expect(page.getByTestId("collections-flag-isDone-t2")).toHaveText("check_circle");
  await expect(page.getByTestId("collections-flag-isDone-t1")).toHaveText("radio_button_unchecked");
});

test("legacy completion pair gets a synthesized done chip (no schema edit)", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "todos", TODOS);

  await page.goto("/collections/todos");
  await expectRows(page, ["t1", "t2"]);

  // hide → the done todo disappears; the count summary reflects it.
  await openFilterMenu(page);
  await page.getByTestId("collections-flag-chip-__completion").click();
  await expectRows(page, ["t1"]);
  await expect(page.getByText("Showing 1 of 2")).toBeVisible();
});

test("a toggle covering the completion pair suppresses the synthesized done chip", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page, "chores", CHORES);

  await page.goto("/collections/chores");
  await expectRows(page, ["c1", "c2"]);
  await openFilterMenu(page);

  // Exactly ONE "Done" filter: the toggle's own chip; no __completion twin.
  await expect(page.getByTestId("collections-flag-chip-done")).toBeVisible();
  await expect(page.getByTestId("collections-flag-chip-__completion")).toHaveCount(0);
  await expect(page.getByTestId("collections-filter-menu-panel").getByText("Done", { exact: true })).toHaveCount(1);

  // And the surviving chip filters done-ness as before.
  await page.getByTestId("collections-flag-chip-done").click();
  await expectRows(page, ["c1"]);
});
