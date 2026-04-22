// E2E coverage for ChatInput attachment discoverability (#499, PR #598).
//
// Three behaviours we care about:
//  1. The placeholder advertises file attachment (drop / paste / attach).
//  2. The paperclip button is present + wired to a hidden <input type="file">
//     with the right `accept` filter derived from ACCEPTED_MIME_*.
//  3. Dropping an unsupported file type surfaces a visible error banner,
//     instead of the pre-PR silent-drop.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { chatInput } from "../fixtures/chat";

test.describe("ChatInput attach discoverability", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
  });

  test("placeholder hints at file attachment", async ({ page }) => {
    const placeholder = await chatInput(page).getAttribute("placeholder");
    expect(placeholder).toBeTruthy();
    // Either language: the three affordances we want the user to
    // discover must all be named. Matches both EN ("drop / paste /
    // attach") and JA ("ドロップ・ペースト・添付").
    const lower = placeholder!.toLowerCase();
    const hasAllEn = lower.includes("drop") && lower.includes("paste") && lower.includes("attach");
    const hasAllJa = placeholder!.includes("ドロップ") && placeholder!.includes("ペースト") && placeholder!.includes("添付");
    expect(hasAllEn || hasAllJa, `placeholder "${placeholder}" should mention drop/paste/attach`).toBeTruthy();
  });

  test("paperclip attach button is present with a title", async ({ page }) => {
    const button = page.getByTestId("attach-file-btn");
    await expect(button).toBeVisible();
    // Title is the accessible tooltip; empty/missing would regress discoverability.
    const title = await button.getAttribute("title");
    expect(title && title.length > 0).toBeTruthy();
  });

  test("hidden file input has an accept filter covering supported types", async ({ page }) => {
    const input = page.getByTestId("file-input");
    // Exists in DOM but hidden — Playwright's default `toBeVisible` would
    // fail, so assert presence via locator count + attribute reads.
    await expect(input).toHaveCount(1);
    const accept = await input.getAttribute("accept");
    expect(accept).toBeTruthy();
    // Spot-check: the filter must cover images + PDFs + the
    // Office-document trio + text/*. These are the core formats the
    // server side converts today.
    expect(accept!).toContain("image/");
    expect(accept!).toContain("text/");
    expect(accept!).toContain("application/pdf");
    expect(accept!).toContain("wordprocessingml"); // DOCX
    expect(accept!).toContain("spreadsheetml"); // XLSX
    expect(accept!).toContain("presentationml"); // PPTX
  });

  test("clicking the attach button opens the picker (fires a click on the hidden input)", async ({ page }) => {
    // Can't reliably drive the OS file chooser across platforms, but
    // we can verify the button wires through to input.click() by
    // listening for a filechooser event from Playwright.
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 2000 }), page.getByTestId("attach-file-btn").click()]);
    expect(chooser).toBeTruthy();
  });

  test("dropping an unsupported file type surfaces a visible error", async ({ page }) => {
    const dropTarget = page.locator("[data-testid=user-input]").locator("..").locator("..");
    // Synthesize a DragEvent with a DataTransfer carrying a single
    // bogus `.zip` file — readAttachmentFile should now route it to
    // the fileError banner instead of returning silently.
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.zip", { type: "application/zip" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    const banner = page.getByTestId("file-error");
    await expect(banner).toBeVisible();
    const text = (await banner.textContent())?.trim() ?? "";
    expect(text.length).toBeGreaterThan(0);
  });

  test("dropping an oversized accepted file still shows the too-large error (regression)", async ({ page }) => {
    // Pre-existing fileTooLarge branch — guard against the new
    // unsupported-type branch accidentally swallowing it.
    const dropTarget = page.locator("[data-testid=user-input]").locator("..").locator("..");
    await dropTarget.evaluate((element) => {
      const bigPayload = new Uint8Array(31 * 1024 * 1024); // 31 MB — over the 30 MB cap
      const transfer = new DataTransfer();
      transfer.items.add(new File([bigPayload], "huge.pdf", { type: "application/pdf" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    const banner = page.getByTestId("file-error");
    await expect(banner).toBeVisible();
    const text = (await banner.textContent()) ?? "";
    // Message body is i18n'd; both EN and JA mention "30" (the cap).
    expect(text).toContain("30");
  });
});
