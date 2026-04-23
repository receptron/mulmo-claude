// E2E for the session-tab row (SessionTabBar.vue): verifies that
// each existing session now shows a visible label under the role
// icon so users can tell sessions apart at a glance, and that
// supplemental indicators (unread dot, origin glyph) render on
// the tabs that carry those flags.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

test.describe("session tab bar — visible per-tab info", () => {
  test("shows a short label under the role icon on each tab", async ({ page }) => {
    await mockAllApis(page, { sessions: [SESSION_A, SESSION_B] });
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const tabA = page.getByTestId(`session-tab-${SESSION_A.id}`);
    const tabB = page.getByTestId(`session-tab-${SESSION_B.id}`);

    // Assert on the distinguishing suffix ("session A" / "session B")
    // rather than the shared "Hello from" prefix — otherwise the test
    // would pass even if the tabs got swapped and each rendered the
    // wrong session's label.
    await expect(tabA).toContainText("session A");
    await expect(tabB).toContainText("session B");

    // Tab tooltip keeps the full preview for users who want more.
    await expect(tabA).toHaveAttribute("title", SESSION_A.preview ?? "");
    await expect(tabB).toHaveAttribute("title", SESSION_B.preview ?? "");
  });

  test("shows an unread dot on inactive tabs that have unread replies", async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        { ...SESSION_A, hasUnread: true },
        { ...SESSION_B, hasUnread: false },
      ],
    });
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const tabA = page.getByTestId(`session-tab-${SESSION_A.id}`);
    const tabB = page.getByTestId(`session-tab-${SESSION_B.id}`);

    // Dot is an aria-labeled span inside the tab.
    await expect(tabA.getByLabel("New reply")).toBeVisible();
    await expect(tabB.getByLabel("New reply")).toBeHidden();
  });

  test("shows an origin glyph for non-human-started sessions", async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        { ...SESSION_A, origin: "scheduler" },
        { ...SESSION_B, origin: "bridge" },
      ],
    });
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const tabA = page.getByTestId(`session-tab-${SESSION_A.id}`);
    const tabB = page.getByTestId(`session-tab-${SESSION_B.id}`);

    await expect(tabA.getByLabel("Started by scheduler")).toBeVisible();
    await expect(tabB.getByLabel("Started by bridge")).toBeVisible();
  });

  test("unread dot stays visible when the user leaves /chat for a plugin page", async ({ page }) => {
    // Regression: the dot was gated on `sessions[i].id !==
    // currentSessionId`, which evaluates the same way on /wiki /files
    // etc. because `currentSessionId` doesn't clear when the user
    // navigates off chat. That meant the tab the user was reading
    // before navigating away would silently lose its unread dot the
    // moment a new reply arrived — exactly when they need it most.
    await mockAllApis(page, {
      sessions: [
        { ...SESSION_A, hasUnread: true },
        { ...SESSION_B, hasUnread: true },
      ],
    });

    // On /chat, the active session's dot is suppressed (the user is
    // literally looking at that conversation).
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await expect(page.getByTestId(`session-tab-${SESSION_B.id}`)).toBeVisible();
    // Query by `aria-current="page"` to identify the active tab —
    // reading data-testid from a tab we selected by id (the previous
    // approach) was tautological and would pass even if the tabs
    // were swapped. SESSION_B is newer → it's the displayed chat.
    const activeTabId = await page.locator("button[aria-current='page'][data-testid^='session-tab-']").getAttribute("data-testid");
    expect(activeTabId).toBe(`session-tab-${SESSION_B.id}`);

    // Navigate off chat. The dot on tab B must now appear, because
    // B is no longer on-screen.
    await page.goto("/wiki");
    await expect(page.getByTestId(`session-tab-${SESSION_B.id}`).getByLabel("New reply")).toBeVisible();
    await expect(page.getByTestId(`session-tab-${SESSION_A.id}`).getByLabel("New reply")).toBeVisible();
  });
});
