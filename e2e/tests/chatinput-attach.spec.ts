// E2E coverage for ChatInput attachment discoverability (#499, PR #598).
//
// Two behaviours we care about:
//  1. The paperclip button is present + wired to a hidden <input type="file">
//     with the right `accept` filter derived from ACCEPTED_MIME_*.
//  2. Dropping an unsupported file type surfaces a visible error banner,
//     instead of the pre-PR silent-drop.
//
// The placeholder used to spell out "drop / paste / attach", but was
// shortened to "Message Claude…" — discoverability now rides on the
// paperclip button (title) and the drop-overlay (`dropHint`), both
// covered below.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.describe("ChatInput attach discoverability", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
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
    expect(accept).toContain("image/");
    expect(accept).toContain("text/");
    expect(accept).toContain("application/pdf");
    expect(accept).toContain("wordprocessingml"); // DOCX
    expect(accept).toContain("spreadsheetml"); // XLSX
    expect(accept).toContain("presentationml"); // PPTX
    // Multi-attach (plans/feat-chat-input-multi-attach.md): the picker
    // must allow several files in a single open. Without `multiple`,
    // the browser caps the selection at 1 and the multi-screenshot
    // workflow regresses.
    await expect(input).toHaveAttribute("multiple", "");
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

  test("dropping multiple accepted files surfaces a preview chip per file", async ({ page }) => {
    // Multi-attach (plans/feat-chat-input-multi-attach.md): all three
    // entry points — picker, paste, drop — should accept several
    // files in one go. Drop is the easiest to drive synthetically;
    // verify that the preview list grows to match.
    const dropTarget = page.locator("[data-testid=user-input]").locator("..").locator("..");
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      // Tiny 1x1 PNG so the FileReader actually parses something.
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      transfer.items.add(new File([pngBytes], "first.png", { type: "image/png" }));
      transfer.items.add(new File([pngBytes], "second.png", { type: "image/png" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    const previews = page.getByTestId("chat-attachment-preview");
    await expect(previews).toHaveCount(2);
    // Clicking the remove × on the first chip should leave one behind.
    await page.getByTestId("chat-attachment-remove").first().click();
    await expect(previews).toHaveCount(1);
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

test.describe("ChatInput drop-target affordance (#1289 Step 1 + Step 2)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
  });

  test("file dragenter reveals the overlay, drop clears it", async ({ page }) => {
    const dropTarget = page.locator("[data-testid=user-input]").locator("..").locator("..");
    const overlay = page.getByTestId("chat-drop-overlay");

    // Pre-condition: overlay is not present before the drag starts.
    await expect(overlay).toHaveCount(0);

    // Fire a synthetic dragenter carrying a File. The handler should
    // flip `isDragging` true and render the overlay.
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(overlay).toBeVisible();

    // A drop must clear the overlay — the counter is forced to zero
    // even if the synthetic events skipped a paired dragleave.
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(overlay).toHaveCount(0);
  });

  test("a text-selection drag (no 'Files' type) does NOT trigger the overlay", async ({ page }) => {
    const dropTarget = page.locator("[data-testid=user-input]").locator("..").locator("..");
    const overlay = page.getByTestId("chat-drop-overlay");

    // Dragging selected text inside the page populates dataTransfer
    // with `text/plain` only. The Files-only guard must keep the
    // overlay hidden for these.
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", "some selected words");
      element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(overlay).toHaveCount(0);
  });

  test("window-leave dragleave (no Files type) clears the stuck overlay", async ({ page }) => {
    // Regression for the Codex review on #1327: some browsers strip
    // `Files` from `dataTransfer.types` when the dragleave event
    // crosses a window boundary. The old handler bailed early on
    // that case → counter stayed at 1 → overlay stuck `true` until
    // the next drop.
    const dropTarget = page.locator("[data-testid=user-input]").locator("..").locator("..");
    const overlay = page.getByTestId("chat-drop-overlay");

    // Enter with a real file drag → overlay shows.
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(overlay).toBeVisible();

    // Leave the window — Firefox / WebKit sometimes deliver this
    // dragleave with `relatedTarget === null` and an empty
    // `dataTransfer.types`. Reproduce that shape.
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer(); // no items / no types
      element.dispatchEvent(
        new DragEvent("dragleave", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          relatedTarget: null,
        }),
      );
    });

    // Overlay must clear — the leave handler decrements regardless
    // of the missing `Files` type once the counter is positive.
    await expect(overlay).toHaveCount(0);
  });

  test("window-level drop outside the wrapper resets the overlay", async ({ page }) => {
    // Belt-and-suspenders: if the user releases the file on a part
    // of the page that ISN'T the chat input, the wrapper never sees
    // a `drop`. The window-level `drop` listener catches it.
    const dropTarget = page.locator("[data-testid=user-input]").locator("..").locator("..");
    const overlay = page.getByTestId("chat-drop-overlay");

    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(overlay).toBeVisible();

    // Drop somewhere on document body (not inside the wrapper).
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.txt", { type: "text/plain" }));
      window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });

    await expect(overlay).toHaveCount(0);
  });

  test("counter pattern absorbs child-element enter/leave pairs without flicker", async ({ page }) => {
    const dropTarget = page.locator("[data-testid=user-input]").locator("..").locator("..");
    const child = page.getByTestId("user-input");
    const overlay = page.getByTestId("chat-drop-overlay");

    // Real browsers fire `dragenter` on the wrapper, then again on
    // each child the pointer crosses (textarea, buttons). A naive
    // toggle would flicker the overlay off when the pointer leaves
    // the wrapper to "enter" the textarea. The counter must keep it
    // open across that transition.
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(overlay).toBeVisible();

    // Simulate the pointer crossing into the textarea (browser fires
    // dragenter on the new target, then dragleave on the previous
    // one — both bubble up to the wrapper handler).
    await child.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      element.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    // Overlay stays open — the counter was at 2 (wrapper + child)
    // and only one leave landed, so it stays positive.
    await expect(overlay).toBeVisible();
  });

  test("Step 2: dragging onto the chat-sidebar (panel-wide) shows the overlay and attaches on drop", async ({ page }) => {
    // The panel-wide drop zone (#1289 Step 2) wires the handlers on
    // the chat-sidebar div instead of the ChatInput wrapper.
    // Dragging onto an element above the input (i.e. the sessions
    // list region) should now reveal the overlay, and a drop there
    // should still route the file through ChatInput.readFile().
    const panel = page.getByTestId("chat-sidebar");
    const overlay = page.getByTestId("chat-drop-overlay");

    await expect(overlay).toHaveCount(0);

    await panel.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(overlay).toBeVisible();

    // Dropping an unsupported type at the panel level surfaces the
    // SAME error banner the textarea-drop path surfaces — verifies
    // App.vue actually routes the dropped file into ChatInput.readFile.
    await panel.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["payload"], "thing.zip", { type: "application/zip" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId("file-error")).toBeVisible();
  });
});
