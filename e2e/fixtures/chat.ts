// Playwright helpers that abstract user-facing chat interactions so
// tests don't hard-code the current layout of the app.
//
// The top-page UX is planned to shift (chat input moves from the left
// sidebar to the canvas bottom, etc. — see issue #253). Tests that
// call these helpers keep working across that shift because only the
// helper implementations need updating. Tests that go straight to
// `page.locator("textarea")` or walk DOM structure will break.
//
// **Rule of thumb for new tests**: reach for a helper here first.
// Drop to `page.getByTestId(...)` only when none of these fit, and
// never use raw tag / CSS selectors for chat / nav / role / session
// interactions.

import type { Locator, Page } from "@playwright/test";

/**
 * Fill the chat input with text. Does not submit — pair with
 * {@link clickSend} or {@link sendChatMessage} to actually send.
 */
export async function fillChatInput(page: Page, text: string): Promise<void> {
  await page.getByTestId("user-input").fill(text);
}

/** Click the send button. Assumes a non-empty input is already filled. */
export async function clickSend(page: Page): Promise<void> {
  await page.getByTestId("send-btn").click();
}

/** Fill + send in one call. */
export async function sendChatMessage(page: Page, text: string): Promise<void> {
  await fillChatInput(page, text);
  await clickSend(page);
}

/** Locator for the chat input textarea itself. Useful for
 *  `expect(...).toHaveValue(...)` assertions. */
export function chatInput(page: Page): Locator {
  return page.getByTestId("user-input");
}

/** Locator for the send button. Useful for `toBeEnabled()` checks. */
export function sendButton(page: Page): Locator {
  return page.getByTestId("send-btn");
}

/** Click the "New session" button (top-left plus icon). */
export async function startNewSession(page: Page): Promise<void> {
  await page.getByTestId("new-session-btn").click();
}

/** Open the session history popup (clock icon). */
export async function openSessionHistory(page: Page): Promise<void> {
  await page.getByTestId("history-btn").click();
}

/** Click an existing session tab by id (appears after opening a session). */
export async function selectSessionTab(page: Page, sessionId: string): Promise<void> {
  await page.getByTestId(`session-tab-${sessionId}`).click();
}

/** Open the Role selector dropdown. */
export async function openRoleSelector(page: Page): Promise<void> {
  await page.getByTestId("role-selector-btn").click();
}

/**
 * Switch to a different role by id. Opens the dropdown, clicks the
 * option, which also triggers the role-change handler in App.vue.
 */
export async function switchRole(page: Page, roleId: string): Promise<void> {
  await openRoleSelector(page);
  await page.getByTestId(`role-option-${roleId}`).click();
}

/** Open the Settings modal (gear icon). */
export async function openSettings(page: Page): Promise<void> {
  await page.getByTestId("settings-btn").click();
}
