// E2E for the session-history side-panel toggle (#707).
//
// Covers:
// - Toggle button visible in both Single and Stack canvas views
// - Clicking the toggle adds SessionHistoryPanel as the leftmost
//   column (w-80) next to the existing chat sidebar / canvas
// - State persists in localStorage across reloads
// - Panel renders the session list fetched via /api/sessions
// - Panel only appears on /chat — navigating to /files etc. hides it
//   even when the preference is on

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

test.describe("session-history side-panel toggle", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page, { sessions: [SESSION_A, SESSION_B] });
    // Each Playwright test gets a fresh browser context with empty
    // localStorage by default, so the side-panel preference starts
    // OFF without needing an init-script reset. Tests that want the
    // panel pre-enabled set it up inline before `page.goto`.
  });

  test("Single view: toggle button hidden → visible shows the left session-history column", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Off by default — side-panel DOM is absent.
    await expect(page.getByTestId("session-history-side-panel")).toBeHidden();
    await expect(page.getByTestId("session-history-toggle-off")).toBeVisible();

    // Click the toggle — SessionTabBar disappears, panel appears with
    // its own toggle in the header.
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();
    // Only one toggle-on button (in the panel) — the SessionTabBar is
    // unmounted so its toggle is gone too.
    await expect(page.getByTestId("session-history-toggle-on")).toHaveCount(1);

    const sidePanel = page.getByTestId("session-history-side-panel");
    await expect(sidePanel.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(sidePanel.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();
  });

  test("Stack view: toggle button (lives in SessionTabBar) controls the side-panel", async ({ page }) => {
    // Preset localStorage to Stack layout so we don't have to flip
    // it via the UI first.
    await page.addInitScript(() => {
      localStorage.setItem("canvas_layout_mode", "stack");
    });

    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Side panel off initially in Stack too.
    await expect(page.getByTestId("session-history-side-panel")).toBeHidden();

    // Toggle lives in SessionTabBar (top bar Row 2) — the same
    // button is used regardless of Single / Stack layout. Flipping
    // it reveals the leftmost session-history column, which Stack
    // normally has no sidebar for at all.
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();
    await expect(page.getByTestId("session-history-side-panel").getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
  });

  test("preference persists in localStorage across reloads", async ({ page }) => {
    await page.goto("/chat");
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem("chat_show_session_history"));
    expect(stored).toBe("1");

    // Reload — panel should still be visible without clicking again.
    await page.reload();
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();
  });

  test("clicking a session in the side panel navigates to /chat/:id", async ({ page }) => {
    await page.goto("/chat");
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();

    // The panel uses the shared SessionHistoryPanel component, so
    // clicking a session item triggers the same load-session handler
    // that /history uses.
    await page.getByTestId("session-history-side-panel").getByTestId(`session-item-${SESSION_A.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/chat/${SESSION_A.id}`));
  });

  test("opening the side panel replaces the SessionTabBar entirely", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // SessionTabBar is present with its tabs and toggle when the panel is off.
    await expect(page.getByTestId(`session-tab-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId("session-history-toggle-off")).toBeVisible();

    // Click the toggle — SessionTabBar unmounts completely; the panel
    // takes over and carries its own toggle in the header.
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();
    await expect(page.getByTestId(`session-tab-${SESSION_A.id}`)).toBeHidden();
    await expect(page.getByTestId("session-history-toggle-off")).toBeHidden();

    // The in-panel toggle returns to the tabs-on-top layout.
    await page.getByTestId("session-history-toggle-on").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeHidden();
    await expect(page.getByTestId(`session-tab-${SESSION_A.id}`)).toBeVisible();
  });

  test("history-btn entrypoint to /history stays reachable while the panel is open", async ({ page }) => {
    // Regression guard for the first Codex review pass: hiding Row 2
    // removes the SessionTabBar, which contained the only in-app
    // link to /history. The panel header now mirrors that button so
    // a one-click jump to the full-page history view survives.
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();

    // The button still exists (inside the panel header now) and
    // navigates to /history when clicked.
    await expect(page.getByTestId("history-btn")).toBeVisible();
    await page.getByTestId("history-btn").click();
    await expect(page).toHaveURL(/\/history(\/|$)/);
  });

  test("side panel is hidden on non-chat pages even when toggled on", async ({ page }) => {
    // Enable the toggle on /chat first so the preference is on.
    await page.goto("/chat");
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();

    // Navigate off chat — panel disappears (the side-panel is gated
    // on isChatPage so /files / /wiki / etc. don't duplicate it next
    // to their own content).
    await page.goto("/files");
    await expect(page.getByTestId("session-history-side-panel")).toBeHidden();
  });
});
