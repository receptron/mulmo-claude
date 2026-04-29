// Live-mode helpers for e2e-live. Mirrors the surface of
// `e2e/fixtures/chat.ts` for the shared interactions, but does NOT
// install any API mocks — the real Claude API runs end-to-end. Use
// these helpers from specs in `e2e-live/tests/`.

import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Download, type FrameLocator, type Page, expect } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the user's mulmoclaude workspace. Honours the env override
 * the server itself respects so the tests still work when a custom
 * workspace is in use.
 */
function workspaceRoot(): string {
  return process.env.MULMOCLAUDE_WORKSPACE ?? path.join(homedir(), "mulmoclaude");
}

/**
 * Copy a fixture file (relative to `e2e-live/fixtures/`) into the
 * workspace at the given relative path. Creates intermediate dirs.
 * Returns the absolute destination path so the spec can pass it on
 * to {@link removeFromWorkspace} for cleanup. The destination
 * filename should be unique per spec to avoid stomping on real
 * user data.
 */
export async function placeFixtureInWorkspace(fixtureRel: string, workspaceRel: string): Promise<string> {
  const src = path.join(FIXTURES_DIR, fixtureRel);
  const dst = path.join(workspaceRoot(), workspaceRel);
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(src, dst);
  return dst;
}

/** Best-effort delete; never throws if the file is already gone. */
export async function removeFromWorkspace(workspaceRel: string): Promise<void> {
  await rm(path.join(workspaceRoot(), workspaceRel), { force: true });
}

const PRESENT_HTML_IFRAME_SELECTOR = '[data-testid="present-html-iframe"]';

/** Open the app root and start a fresh chat session. */
export async function startNewSession(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("new-session-btn").click();
}

/** Fill the chat input and click send. */
export async function sendChatMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("user-input").fill(text);
  await page.getByTestId("send-btn").click();
}

/**
 * Wait for an `<img>` matching the selector to appear *inside* the
 * presentHtml iframe. The iframe element itself is appended to the
 * DOM before its srcdoc finishes rendering, so a plain `iframe`
 * `toBeVisible` check returns too early — we have to reach into
 * the frame and wait for the actual rendered child.
 */
export async function waitForImgInPresentHtml(page: Page, imgSelector: string, timeoutMs: number = ONE_MINUTE_MS): Promise<FrameLocator> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  await expect(frame.locator(imgSelector)).toBeVisible({ timeout: timeoutMs });
  return frame;
}

/**
 * Wait for Claude to finish its full turn — the `thinking-indicator`
 * disappears when the assistant has stopped streaming. Without this
 * the test would end the moment any earlier assertion passes, and
 * the trace / video would cut off mid-response, hiding any later
 * regression that only surfaces after the iframe is rendered (for
 * example a text reply that fails because of a downstream error).
 *
 * If the indicator was never rendered (response was instant) this
 * still resolves cleanly because Playwright's `toBeHidden` treats
 * a detached element as hidden.
 */
export async function waitForAssistantResponseComplete(page: Page, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  await expect(page.getByTestId("thinking-indicator")).toBeHidden({ timeout: timeoutMs });
}

/**
 * Read the unresolved `src` attribute of the first matching `<img>`
 * inside the presentHtml iframe. We use Playwright's `frameLocator`
 * + `getAttribute` rather than `page.evaluate` + `contentDocument`
 * because the srcdoc iframe is recreated whenever Vue updates the
 * `srcdoc` prop. A `contentDocument` reference held by an in-page
 * `evaluate` block can land on the previous (empty) document and
 * miss the rendered child entirely, even after the iframe element
 * is "visible" in the DOM. `frameLocator` re-resolves the live
 * frame each time, matching the wait helper above.
 *
 * Reading the unresolved attribute (not `img.src`) lets assertions
 * check the rewritten path verbatim instead of the absolute
 * resolved URL the browser computes.
 */
export async function readImgSrcInPresentHtml(page: Page, imgSelector: string): Promise<string | null> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  const img = frame.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.getAttribute("src");
}

/**
 * Read `naturalWidth` and `naturalHeight` for an `<img>` inside the
 * presentHtml iframe. Both are 0 when the image is broken (404,
 * blocked by sandbox, etc.), so the caller can assert that the
 * rewritten URL actually resolves to a real, decodable image.
 */
export async function readImgNaturalSize(page: Page, imgSelector: string): Promise<{ width: number; height: number } | null> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  const img = frame.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return { width: 0, height: 0 };
    return { width: node.naturalWidth, height: node.naturalHeight };
  });
}

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

/**
 * Read a Playwright `Download` into memory and check that it is a
 * real PDF rather than an HTML error page or empty stub. Returns
 * the buffer so the caller can run extra assertions (file size,
 * inline image search, etc.).
 */
export async function readPdfDownload(download: Download): Promise<Buffer> {
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Download has no on-disk path; was failOnStatusCode triggered?");
  }
  const buf = await readFile(downloadPath);
  if (!buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    const head = buf.subarray(0, 64).toString("utf8");
    throw new Error(`Downloaded file is not a PDF (first bytes: ${JSON.stringify(head)})`);
  }
  return buf;
}
