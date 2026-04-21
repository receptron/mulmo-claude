// Pseudo-E2E for IME Enter handling (useImeAwareEnter composable).
//
// Real IME input can't be automated in Playwright, so we dispatch
// synthetic compositionstart / compositionend / keydown events in
// the correct browser-specific order to verify the composable's
// suppression logic wired into the textarea.
//
// "Sent" is detected by intercepting POST /api/agent calls — if the
// array is empty after a simulated keypress sequence, no message was
// dispatched.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { chatInput, fillChatInput } from "../fixtures/chat";

// Dispatch a composition event on the textarea.
async function dispatchComposition(textarea: ReturnType<typeof chatInput>, type: "compositionstart" | "compositionend") {
  await textarea.evaluate((el, t) => el.dispatchEvent(new CompositionEvent(t, { bubbles: true })), type);
}

// Dispatch a keydown Enter on the textarea.
async function dispatchEnterKeydown(textarea: ReturnType<typeof chatInput>, opts: { isComposing?: boolean } = {}) {
  await textarea.evaluate(
    (el, o) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          isComposing: o.isComposing ?? false,
          bubbles: true,
          cancelable: true,
        }),
      ),
    opts,
  );
}

// Dispatch a Shift+Enter keydown on the textarea.
async function dispatchShiftEnterKeydown(textarea: ReturnType<typeof chatInput>) {
  await textarea.evaluate((el) =>
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

test.describe("IME Enter handling", () => {
  let agentCalls: string[];

  test.beforeEach(async ({ page }) => {
    agentCalls = [];
    await mockAllApis(page);

    // Track POST /api/agent calls to detect sends.
    await page.route(
      (url) => url.pathname === "/api/agent",
      (route) => {
        if (route.request().method() === "POST") {
          agentCalls.push(route.request().postData() ?? "");
          return route.fulfill({
            status: 202,
            json: { chatSessionId: "mock-session" },
          });
        }
        return route.fallback();
      },
    );

    await page.goto("/");
    await expect(page.getByTestId("user-input")).toBeVisible();
  });

  test("Chrome IME: compositionstart → keydown(isComposing) → compositionend does not send", async ({ page }) => {
    const input = chatInput(page);
    await fillChatInput(page, "テスト");

    // Chrome order: compositionstart → keydown(Enter, isComposing=true) → compositionend
    await dispatchComposition(input, "compositionstart");
    await dispatchEnterKeydown(input, { isComposing: true });
    await dispatchComposition(input, "compositionend");

    // Wait a tick to ensure no async send was queued.
    await page.waitForTimeout(100);
    expect(agentCalls).toHaveLength(0);
  });

  test("Safari IME: compositionstart → compositionend → keydown(isComposing=false) does not send", async ({ page }) => {
    const input = chatInput(page);
    await fillChatInput(page, "テスト");

    // Safari order: compositionstart → compositionend → keydown(Enter, isComposing=false)
    // The keydown follows compositionend synchronously (within the 30ms race window).
    await dispatchComposition(input, "compositionstart");
    await dispatchComposition(input, "compositionend");
    await dispatchEnterKeydown(input, { isComposing: false });

    await page.waitForTimeout(100);
    expect(agentCalls).toHaveLength(0);
  });

  test("normal Enter after IME confirmation sends the message", async ({ page }) => {
    const input = chatInput(page);
    await fillChatInput(page, "テスト");

    // Complete an IME sequence first (Safari order).
    await dispatchComposition(input, "compositionstart");
    await dispatchComposition(input, "compositionend");
    await dispatchEnterKeydown(input, { isComposing: false });

    // Wait past the 30ms race window, then send a real Enter.
    await page.waitForTimeout(100);
    expect(agentCalls).toHaveLength(0);

    await dispatchEnterKeydown(input, { isComposing: false });
    await page.waitForTimeout(100);
    expect(agentCalls).toHaveLength(1);
  });

  test("Shift+Enter does not send", async ({ page }) => {
    const input = chatInput(page);
    await fillChatInput(page, "改行テスト");

    await dispatchShiftEnterKeydown(input);

    await page.waitForTimeout(100);
    expect(agentCalls).toHaveLength(0);
  });
});
