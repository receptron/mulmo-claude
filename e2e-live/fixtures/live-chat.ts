// Live-mode helpers for e2e-live. Mirrors the surface of
// `e2e/fixtures/chat.ts` for the shared interactions, but does NOT
// install any API mocks — the real Claude API runs end-to-end. Use
// these helpers from specs in `e2e-live/tests/`.

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Download, type FrameLocator, type Page, expect } from "@playwright/test";

import { API_ROUTES } from "../../src/config/apiRoutes";
import { ONE_MINUTE_MS } from "../../server/utils/time.ts";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the user's mulmoclaude workspace. Honours the env override
 * the server itself respects so the tests still work when a custom
 * workspace is in use.
 *
 * Caveat: if you set `MULMOCLAUDE_WORKSPACE` in your shell to point
 * tests at a sandbox dir, `unset` it before running mulmoclaude
 * itself — fixture cleanup writes inside whatever this resolves to,
 * and a stale env in the parent shell will silently target the
 * wrong workspace.
 */
function workspaceRoot(): string {
  return process.env.MULMOCLAUDE_WORKSPACE ?? path.join(homedir(), "mulmoclaude");
}

/**
 * Resolve a workspace-relative path to an absolute path inside the
 * workspace root, refusing anything that escapes the root via `..`
 * or absolute paths. Defensive guard so a mistyped fixture target
 * cannot delete arbitrary files on the host.
 */
function resolveWorkspacePath(workspaceRel: string): string {
  const root = path.resolve(workspaceRoot());
  const target = path.resolve(root, workspaceRel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Workspace-relative path escapes workspace root: ${workspaceRel}`);
  }
  return target;
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
  const dst = resolveWorkspacePath(workspaceRel);
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(src, dst);
  return dst;
}

/** Best-effort delete; never throws if the file is already gone. */
export async function removeFromWorkspace(workspaceRel: string): Promise<void> {
  await rm(resolveWorkspacePath(workspaceRel), { force: true });
}

/**
 * Drop a wiki page directly onto disk at `data/wiki/pages/<slug>.md`.
 * The wiki view fetches /api/wiki?slug=<slug> on navigate, which
 * reads the same file — so seeding the file is enough to make a page
 * accessible via the standalone /wiki/pages/<slug> route. Spec-unique
 * slugs only; do not stomp real user pages.
 */
export async function placeWikiPage(slug: string, body: string): Promise<void> {
  const target = resolveWorkspacePath(`data/wiki/pages/${slug}.md`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, "utf8");
}

export async function removeWikiPage(slug: string): Promise<void> {
  await removeFromWorkspace(`data/wiki/pages/${slug}.md`);
}

const WIKI_PAGE_BODY_SELECTOR = '[data-testid="wiki-page-body"]';

/**
 * Open a wiki page directly via its standalone route. The SPA's wiki
 * router fetches /api/wiki?slug=... and renders the page body into
 * `[data-testid="wiki-page-body"]` (the v-html surface inside
 * `WikiPageBody.vue`). Used as the entry point for L-W-S-* specs.
 */
export async function navigateToWikiPage(page: Page, slug: string): Promise<void> {
  await page.goto(`/wiki/pages/${encodeURIComponent(slug)}`);
}

/**
 * Wait for an `<img>` matching `imgSelector` to appear inside the
 * rendered wiki page body. Counterpart to `waitForImgInPresentHtml`
 * for the markdown surface — no iframe boundary, the body is a
 * direct DOM child of the page.
 */
export async function waitForImgInWiki(page: Page, imgSelector: string, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  const body = page.locator(WIKI_PAGE_BODY_SELECTOR);
  await expect(body.locator(imgSelector)).toBeVisible({ timeout: timeoutMs });
}

/**
 * Read the unresolved `src` attribute of the first matching `<img>`
 * in the wiki body. Lets the caller assert the rewriter produced the
 * expected `/api/files/raw?path=...` path (or, for self-repair tests,
 * the final repaired URL).
 */
export async function readImgSrcInWiki(page: Page, imgSelector: string): Promise<string | null> {
  const body = page.locator(WIKI_PAGE_BODY_SELECTOR);
  const img = body.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.getAttribute("src");
}

/**
 * Read `naturalWidth` / `naturalHeight` of the first matching `<img>`
 * in the wiki body. Both 0 means the rewritten URL did not resolve to
 * a decodable image — that's the failure mode every L-W-S-* spec
 * guards against.
 */
export async function readImgNaturalSizeInWiki(page: Page, imgSelector: string): Promise<{ width: number; height: number } | null> {
  const body = page.locator(WIKI_PAGE_BODY_SELECTOR);
  const img = body.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return { width: 0, height: 0 };
    return { width: node.naturalWidth, height: node.naturalHeight };
  });
}

/**
 * Pull the chat session id out of the current URL. Returns null if
 * the page is not on a /chat/<id> route (e.g. before the first
 * navigation, or while sitting on /wiki).
 */
export function getCurrentSessionId(page: Page): string | null {
  const match = /\/chat\/([^/?#]+)/.exec(page.url());
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Best-effort hard-delete a chat session through the server's
 * DELETE /api/sessions/:id endpoint — same path the kebab → 削除
 * button hits in the UI. Used as cleanup so the test does not
 * leave debug sessions piling up in the user's history.
 *
 * Never throws. Cleanup failures (page already closed, server
 * restarting, session already gone) must not turn a passing test
 * red.
 */
/** Build the workspace-relative DELETE URL from the shared API_ROUTES table. */
function buildSessionDeleteUrl(sessionId: string): string {
  return API_ROUTES.sessions.detail.replace(":id", encodeURIComponent(sessionId));
}

/**
 * Issue the DELETE call from inside the page so the SPA's
 * bearer-auth meta tag is reachable. Logs HTTP / network failures
 * via console.warn to keep the suite running.
 */
async function performInPageSessionDelete(page: Page, url: string): Promise<void> {
  await page.evaluate(async (target) => {
    const meta = document.querySelector('meta[name="mulmoclaude-auth"]');
    const token = meta?.getAttribute("content") ?? "";
    try {
      const response = await fetch(target, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        console.warn(`deleteSession: ${target} returned HTTP ${response.status}`);
      }
    } catch (err) {
      console.warn(`deleteSession: network error for ${target}`, err);
    }
  }, url);
}

export async function deleteSession(page: Page, sessionId: string): Promise<void> {
  if (page.isClosed()) return;
  try {
    await performInPageSessionDelete(page, buildSessionDeleteUrl(sessionId));
  } catch {
    // best-effort: page already closed, server restarting, etc.
  }
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

/**
 * Detect whether the in-iframe onerror self-repair (PR #974) fired
 * on an `<img>`. The repair script tags the element with
 * `data-image-repair-tried="1"` before rewriting `src` to
 * `/artifacts/images/<rest>`, so the marker's presence after the
 * image has loaded is a direct signal that the original LLM-emitted
 * src was broken and the browser silently rescued it.
 *
 * Without this check, an LLM regression that emits a path containing
 * the `artifacts/images/` segment behind a wrong prefix would still
 * pass `naturalWidth > 0` because self-repair masks the 404. Reading
 * the marker preserves the suite's ability to catch convention drift.
 */
export async function readImgRepairAttempted(page: Page, imgSelector: string): Promise<boolean | null> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  const img = frame.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  const marker = await img.getAttribute("data-image-repair-tried");
  return marker !== null;
}

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");
const PDF_EOF = Buffer.from("%%EOF", "ascii");
// PDF spec writes %%EOF in the last few hundred bytes; widen to
// 2 KiB so trailing whitespace, line endings, or `<startxref>`
// blocks don't shift it past our search window.
const PDF_EOF_TAIL_BYTES = 2048;

/**
 * Read a Playwright `Download` into memory and check that it is a
 * real PDF rather than an HTML error page or a truncated stream.
 * Validates both the `%PDF-` header and the `%%EOF` tail marker,
 * so a connection that drops mid-response is rejected. Returns
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
  const tail = buf.subarray(Math.max(0, buf.length - PDF_EOF_TAIL_BYTES));
  if (tail.indexOf(PDF_EOF) === -1) {
    throw new Error(`Downloaded PDF appears truncated (missing %%EOF marker, length ${buf.length})`);
  }
  return buf;
}
