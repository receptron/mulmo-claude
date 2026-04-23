// E2E for the session-history dropdown — the button-triggered popup
// that lists past sessions. Covers:
// - lazy fetch: /api/sessions is fetched when the button is clicked
// - click-outside guard: popup dismisses when clicking elsewhere
// - session click → navigate to /chat/:id
//
// Companion to chat-flow.spec.ts (which covers list sort order and
// AI-title preference): this file focuses on the button+popup UX
// extracted into useSessionHistory + SessionHistoryPanel.

import { test, expect, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

test.describe("history panel (useSessionHistory)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("clicking the history button opens the panel with server sessions", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Panel is closed initially — session items should not be in DOM.
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeHidden();

    await page.getByTestId("history-btn").click();

    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();
  });

  test("history button navigates to /history route", async ({ page }) => {
    // Promotion from overlay to page route (#653): clicking the
    // history button should flip the URL so the panel is bookmarkable
    // and browser back works.
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByTestId("history-btn").click();
    await expect(page).toHaveURL(/\/history$/);
  });

  test("direct link to /history opens the panel", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();
  });

  test("browser back from /chat/:id after selecting returns to /history", async ({ page }) => {
    // /history is a real page in browser history. After selecting a
    // session from the panel, back should return to /history (not
    // skip over it) — that matches the mental model of "I visited
    // the history page, clicked a session, now go back".
    await page.goto("/chat");
    // Wait for the /chat → /chat/<newId> redirect before opening
    // history — clicking mid-bootstrap makes the stack timing-dependent.
    await page.waitForURL(/\/chat\//);
    await page.getByTestId("history-btn").click();
    await expect(page).toHaveURL(/\/history$/);
    await page.getByTestId(`session-item-${SESSION_A.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/chat/${SESSION_A.id}`));

    await page.goBack();
    await expect(page).toHaveURL(/\/history$/);
    // Panel re-renders with the session list.
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
  });

  test("second click on history button (while on /history) returns to prior page", async ({ page }) => {
    await page.goto("/chat");
    // Wait for the `/chat` → `/chat/<newSessionId>` redirect to
    // settle before capturing the "prior" URL — reading before the
    // redirect gives the bare /chat which isn't what the close push
    // lands on.
    await page.waitForURL(/\/chat\//);
    const priorUrl = page.url();

    await page.getByTestId("history-btn").click();
    await expect(page).toHaveURL(/\/history$/);
    await page.getByTestId("history-btn").click();
    await expect(page).toHaveURL(priorUrl);
  });

  test("history button on direct-linked /history falls back to /chat (no prior entry)", async ({ page }) => {
    // Direct-link opens /history as the first navigation of the tab —
    // router.back() has nowhere to go. The button should still close
    // the panel by navigating to /chat instead of escaping the app.
    await page.goto("/history");
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await page.getByTestId("history-btn").click();
    await expect(page).toHaveURL(/\/chat/);
  });

  test("clicking a session navigates to /chat/:id", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTestId("history-btn").click();
    await page.getByTestId(`session-item-${SESSION_A.id}`).click();

    await expect(page).toHaveURL(new RegExp(`/chat/${SESSION_A.id}`));
  });

  // Note: the old "clicking outside closes the panel" test was
  // removed when history was promoted from an overlay to the
  // /history page route. There's no "outside" to click anymore —
  // the panel is the whole canvas. Closing it means navigating
  // elsewhere (session click, browser back, or the history
  // button again). Covered by the "browser back" / "second click"
  // tests below.

  test("button click triggers a fresh /api/sessions fetch", async ({ page }) => {
    // Count /api/sessions GETs so we can verify the button fires a
    // lazy fetch (not just the onMount one).
    let sessionFetchCount = 0;
    await page.route(urlEndsWith("/api/sessions"), (route: Route) => {
      if (route.request().method() === "GET") {
        sessionFetchCount++;
      }
      return route.fulfill({
        json: {
          sessions: [SESSION_A, SESSION_B],
          cursor: "v1:0",
          deletedIds: [],
        },
      });
    });

    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // Let onMount fetches settle.
    await page.waitForTimeout(200);
    const countAfterMount = sessionFetchCount;

    await page.getByTestId("history-btn").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();

    // One additional fetch should have happened on button click.
    expect(sessionFetchCount).toBeGreaterThan(countAfterMount);
  });

  test("filter bar is visible with All/Human/Scheduler/Skill/Bridge buttons", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTestId("history-btn").click();

    const filterBar = page.getByTestId("session-filter-bar");
    await expect(filterBar).toBeVisible();

    await expect(page.getByTestId("session-filter-all")).toBeVisible();
    await expect(page.getByTestId("session-filter-human")).toBeVisible();
    await expect(page.getByTestId("session-filter-scheduler")).toBeVisible();
    await expect(page.getByTestId("session-filter-skill")).toBeVisible();
    await expect(page.getByTestId("session-filter-bridge")).toBeVisible();
  });

  test("clicking a filter hides non-matching sessions", async ({ page }) => {
    // Override sessions with origin data
    await page.route(urlEndsWith("/api/sessions"), (route: Route) => {
      return route.fulfill({
        json: {
          sessions: [
            { ...SESSION_A, origin: "bridge" },
            { ...SESSION_B }, // no origin = human
          ],
          cursor: "v1:0",
          deletedIds: [],
        },
      });
    });

    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTestId("history-btn").click();
    // Both visible initially
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();

    // Click Bridge filter
    await page.getByTestId("session-filter-bridge").click();
    // Only bridge session visible
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeHidden();

    // Click All to reset
    await page.getByTestId("session-filter-all").click();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();
  });
});
