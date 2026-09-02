// E2E coverage for the "+ Chat" button in CollectionView. The button
// opens a modal text input and, on submit, starts a new general-role
// chat seeded with the collection's skill command:
//
//   typing "make a new entry" on the `reading-list` collection POSTs
//   `/reading-list make a new entry` to /api/agent with roleId "general".
//
// Pinned here: the seeded message shape (slug + trimmed text), the
// empty/whitespace-disabled send button, and Escape/cancel dismissal.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const READING_LIST = {
  collection: {
    slug: "reading-list",
    title: "Reading List",
    icon: "bookmark",
    source: "user",
    schema: {
      title: "Reading List",
      icon: "bookmark",
      dataPath: "data/reading-list/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        notes: { type: "string", label: "Notes" },
      },
    },
  },
  items: [{ id: "first", notes: "an existing row" }],
};

async function mockCollection(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/reading-list",
    (route) => route.fulfill({ json: READING_LIST }),
  );
}

test.describe("collection + Chat button", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockCollection(page);
  });

  test("opens the chat modal and gates submit on non-empty input", async ({ page }) => {
    await page.goto("/collections/reading-list");
    await page.getByTestId("collections-chat").click();

    const modal = page.getByTestId("collections-chat-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("role", "dialog");
    await expect(modal).toHaveAttribute("aria-modal", "true");

    // Empty → disabled; whitespace-only → still disabled; real text → enabled.
    const send = page.getByTestId("collections-chat-send");
    await expect(send).toBeDisabled();
    await page.getByTestId("collections-chat-input").fill("   ");
    await expect(send).toBeDisabled();
    await page.getByTestId("collections-chat-input").fill("make a new entry");
    await expect(send).toBeEnabled();

    // The footer's `options` slot is for HOSTS that need one (MulmoTerminal names the agent the
    // chat will start as). MulmoClaude passes nothing, so the footer stays the two buttons it
    // always was — that the slot is invisible here is the whole reason it could be added.
    await expect(modal.locator("footer button")).toHaveCount(2);
  });

  test("submitting seeds a general-role chat with `/<slug> <message>`", async ({ page }) => {
    await page.goto("/collections/reading-list");
    await page.getByTestId("collections-chat").click();
    await page.getByTestId("collections-chat-input").fill("  make a new entry  ");

    const agentPost = page.waitForRequest((req) => req.url().endsWith("/api/agent") && req.method() === "POST");
    await page.getByTestId("collections-chat-send").click();
    const body = (await agentPost).postDataJSON();

    expect(body.message).toBe("/reading-list make a new entry");
    expect(body.roleId).toBe("general");
  });

  test("Escape and Cancel both dismiss the modal without starting a chat", async ({ page }) => {
    await page.goto("/collections/reading-list");

    await page.getByTestId("collections-chat").click();
    await expect(page.getByTestId("collections-chat-modal")).toBeVisible();
    await page.getByTestId("collections-chat-input").press("Escape");
    await expect(page.getByTestId("collections-chat-modal")).toBeHidden();

    await page.getByTestId("collections-chat").click();
    await expect(page.getByTestId("collections-chat-modal")).toBeVisible();
    await page.getByTestId("collections-chat-cancel").click();
    await expect(page.getByTestId("collections-chat-modal")).toBeHidden();
  });
});
