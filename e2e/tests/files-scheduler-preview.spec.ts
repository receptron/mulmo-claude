import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { WORKSPACE_FILES } from "../../src/config/workspacePaths";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";
// Opening data/scheduler/items.json in the Files view should render
// the scheduler plugin's calendar/tasks view instead of a raw JSON
// blob. This covers `toSchedulerResult` + the FileContentRenderer
// dispatch in the composables/components extracted by #517.
const SCHEDULER_URL = `/chat?view=files&path=${WORKSPACE_FILES.schedulerItems}`;

const SAMPLE_ITEMS = [
  {
    id: "s1",
    title: "Daily standup",
    createdAt: Date.now(),
    props: { schedule: "daily" },
  },
  {
    id: "s2",
    title: "Weekly review",
    createdAt: Date.now(),
    props: { schedule: "weekly" },
  },
];

test.describe("Files view — scheduler preview", () => {
  test("renders SchedulerView (Calendar + Tasks tabs) when opening the items file", async ({ page }) => {
    await mockAllApis(page);

    // Serve the raw JSON body via /api/files/content so the renderer
    // can parse it into SchedulerData.
    await page.route("**/api/files/content?**", (route) => {
      return route.fulfill({
        json: {
          kind: "text",
          path: WORKSPACE_FILES.schedulerItems,
          content: JSON.stringify(SAMPLE_ITEMS),
          size: JSON.stringify(SAMPLE_ITEMS).length,
          modifiedMs: Date.now(),
        },
      });
    });

    await page.goto(SCHEDULER_URL);

    // Tabs from SchedulerView (not present in a raw-JSON code view)
    await expect(page.locator('[data-testid="scheduler-tab-calendar"]')).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await expect(page.locator('[data-testid="scheduler-tab-tasks"]')).toBeVisible();
  });

  test("falls back to raw JSON rendering when the body is malformed", async ({ page }) => {
    await mockAllApis(page);
    await page.route("**/api/files/content?**", (route) =>
      route.fulfill({
        json: {
          kind: "text",
          path: WORKSPACE_FILES.schedulerItems,
          content: "{not: json",
          size: 10,
          modifiedMs: Date.now(),
        },
      }),
    );

    await page.goto(SCHEDULER_URL);

    // Scheduler-specific tabs must NOT appear (toSchedulerResult rejects
    // malformed JSON and the renderer falls through to the .json branch).
    await expect(page.getByTestId("scheduler-tab-calendar")).toHaveCount(0);
  });
});
