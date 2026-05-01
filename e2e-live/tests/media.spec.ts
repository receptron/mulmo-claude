import { execSync } from "node:child_process";
import path from "node:path";

import { type Page, expect, test } from "@playwright/test";

import { TOOL_NAME as PRESENT_MULMO_SCRIPT_TOOL } from "../../src/plugins/presentMulmoScript/definition.ts";
import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  deleteSession,
  getCurrentSessionId,
  placeFixtureInWorkspace,
  readImgNaturalSize,
  readImgRepairAttempted,
  readImgSrcInPresentHtml,
  readMovieDownload,
  readPdfDownload,
  removeFromWorkspace,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
  waitForImgInPresentHtml,
} from "../fixtures/live-chat.ts";

const L01_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const L02_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
// L-03 has to absorb both the LLM authoring the script and the
// server-side TTS + ffmpeg compose. 2-beat scripts in practice
// finish in a couple of minutes; the 10-minute ceiling leaves
// headroom for the slowest TTS provider on a cold cache.
const L03_TIMEOUT_MS = 10 * ONE_MINUTE_MS;
const L03_GENERATION_TIMEOUT_MS = 8 * ONE_MINUTE_MS;
// Floor for "the route returned a real PDF, not a stub". The actual
// size depends on how verbose the LLM's reply happens to be that
// run, so this is loose on purpose — `readPdfDownload` already
// asserts the %PDF- magic bytes plus %%EOF tail, this number just
// keeps obviously empty stubs out.
const MIN_PDF_BYTES = 500;
// Same idea for the movie: `readMovieDownload` already validates
// the MP4 `ftyp` marker, so we just need a floor that excludes
// truncated stubs. 1 KiB is well below any real 2-beat output.
const MIN_MOVIE_BYTES = 1024;

const L01_IMG_ALT = "sample";
const L01_IMG_LOCATOR = `img[alt="${L01_IMG_ALT}"]`;

// Each scenario opens its own chat session, so they do not share
// state. Run them in parallel to cut wall time — the server happily
// services multiple chat sessions concurrently (verified by hand
// before turning this on).
test.describe.configure({ mode: "parallel" });

test.describe("media (real LLM)", () => {
  test("L-01: presentHtml の <img src='../../../images/...'> が /artifacts/html 経由で描画される", async ({ page }) => {
    test.setTimeout(L01_TIMEOUT_MS);
    // Spec-unique flat path — see comment in seedL01Fixture.
    const workspaceImageRel = "artifacts/images/e2e-live-l01.png";
    await seedL01Fixture(workspaceImageRel);
    try {
      await startNewSession(page);
      await sendL01Prompt(page, workspaceImageRel);
      await assertL01PresentHtml(page);
      await waitForAssistantResponseComplete(page);
    } finally {
      await cleanupSessionAndWorkspace(page, workspaceImageRel);
    }
  });

  test("L-02: 画像参照を含む Markdown 応答が PDF として DL できる", async ({ page }) => {
    test.setTimeout(L02_TIMEOUT_MS);
    // Seeding the image makes B-19 / B-20 actually exercisable —
    // without it, /api/pdf/markdown can return a "PDF with broken
    // image" that still passes magic-bytes + size checks.
    const workspaceImageRel = "artifacts/images/e2e-live-l02.png";
    await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);
    try {
      await startNewSession(page);
      await sendL02Prompt(page, workspaceImageRel);
      await waitForAssistantResponseComplete(page);
      await downloadAndAssertPdf(page);
    } finally {
      await cleanupSessionAndWorkspace(page, workspaceImageRel);
    }
  });

  test("L-03: 既存 mulmoScript → 動画生成 → 動画 DL が成功する", async ({ page }, testInfo) => {
    test.setTimeout(L03_TIMEOUT_MS);
    // mulmocast spawns system ffmpeg via fluent-ffmpeg (not bundled).
    // Without it, movie compose fails silently and the test times
    // out at the 8-minute mark. Skip with a loud reason instead so
    // teammates know to install ffmpeg locally — see issue #1049
    // for the matching docs gap on the user-facing side.
    test.skip(!isFFmpegAvailable(), "ffmpeg not in PATH; required for the mulmoScript movie compose pipeline (see issue #1049)");
    // L-03 is scoped to B-21 (download-movie bearer-auth flow). To
    // remove LLM-script-authoring drift and skip TTS / image-gen
    // APIs entirely, we seed a pre-built mulmoScript fixture and
    // ask the LLM only to re-display it via filePath mode. Empty
    // beat `text` plus textSlide images means: no API calls, no
    // GEMINI key needed, just ffmpeg locally composing two short
    // silent slides.
    //
    // Disk lives under artifacts/stories/ (WORKSPACE_DIRS.stories);
    // the wire form passed to the LLM keeps the canonical
    // "stories/<file>" prefix that the server's resolveStoryPath
    // strips before resolving against artifacts/stories/.
    //
    // Suffixing the filename with the Playwright project name
    // keeps chromium and webkit from contending for the same
    // absoluteFilePath inside server's inFlightMovies guard —
    // without this they race and only one worker's generateMovie
    // SSE stream completes (the loser hangs for the full timeout).
    const slug = testInfo.project.name;
    const fixtureBasename = `e2e-live-l03-${slug}.json`;
    // path.posix.join keeps the separator forward-slash on every
    // host so the wire form matches the server's POSIX-shaped
    // resolveStoryPath input regardless of the runner OS.
    const workspaceScriptRel = path.posix.join("artifacts/stories", fixtureBasename);
    const wireFilePath = path.posix.join("stories", fixtureBasename);
    await placeFixtureInWorkspace("mulmo/l03-two-beat.json", workspaceScriptRel);
    try {
      await startNewSession(page);
      await sendL03FilePathPrompt(page, wireFilePath);
      await waitForMulmoScriptViewReady(page);
      await waitForAssistantResponseComplete(page);
      await generateAndDownloadMovie(page);
    } finally {
      const sessionId = getCurrentSessionId(page);
      if (sessionId) await deleteSession(page, sessionId);
      await removeFromWorkspace(workspaceScriptRel);
    }
  });
});

/**
 * Place the fixture image at a flat `artifacts/images/<file>` path.
 * Flat (no YYYY/MM shard) is what makes `../../../images/<file>`
 * correct from the saved `artifacts/html/<YYYY>/<MM>/page.html`. If
 * presentHtml's save depth ever changes, the relative path in the
 * prompt below has to shift in lock step.
 */
async function seedL01Fixture(workspaceImageRel: string): Promise<void> {
  await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);
}

async function sendL01Prompt(page: Page, workspaceImageRel: string): Promise<void> {
  // Filename only — the relative-path prefix below pulls the LLM
  // toward the convention introduced in PR #982.
  const filename = workspaceImageRel.split("/").pop() ?? "";
  const message = [
    "以下の HTML を presentHtml ツールでそのまま表示してください。",
    "",
    "<h1>e2e-live L-01 test</h1>",
    `<img src="../../../images/${filename}" alt="${L01_IMG_ALT}" />`,
  ].join("\n");
  await sendChatMessage(page, message);
}

/**
 * Verify that the rendered iframe contains the image, that the LLM
 * kept the relative-path convention from PR #982, and that the
 * mount + path-traversal guard chain actually serves the file
 * (`naturalWidth > 0` is the end-to-end signal — B-18's failure
 * mode is `naturalWidth = 0`).
 */
async function assertL01PresentHtml(page: Page): Promise<void> {
  await waitForImgInPresentHtml(page, L01_IMG_LOCATOR);
  const src = await readImgSrcInPresentHtml(page, L01_IMG_LOCATOR);
  if (src === null) {
    throw new Error(`presentHtml iframe should contain ${L01_IMG_LOCATOR}`);
  }
  expect(src).toContain("e2e-live-l01.png");
  expect(src, "the LLM must follow the relative-path convention from PR #982").not.toMatch(/^\/artifacts\//);
  const size = await readImgNaturalSize(page, L01_IMG_LOCATOR);
  if (size === null) {
    throw new Error("naturalSize should be readable");
  }
  expect(size.width, "image must actually decode (B-18 regression)").toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
  await assertL01NoSelfRepair(page);
}

/**
 * PR #974's onerror self-repair would otherwise mask an LLM
 * regression that embeds `artifacts/images/...` behind a wrong
 * prefix — the browser rewrites the src to `/artifacts/images/<rest>`,
 * the image loads, naturalWidth > 0, and the convention drift goes
 * unnoticed. The repair script tags the element on activation, so
 * an unset marker means the original src was already correct.
 */
async function assertL01NoSelfRepair(page: Page): Promise<void> {
  const repaired = await readImgRepairAttempted(page, L01_IMG_LOCATOR);
  expect(repaired, "self-repair must not fire — LLM regressed from the relative-path convention").toBe(false);
}

async function sendL02Prompt(page: Page, workspaceImageRel: string): Promise<void> {
  // textResponse plugin's PDF download route inlines images on the
  // server (B-19 / B-20 fix). Pointing the markdown at the seeded
  // workspace path is what exercises that inline path end-to-end.
  const absPath = `/${workspaceImageRel}`;
  const message = [
    "次の Markdown を **そのまま** 1 ターンの返信本文として返してください。",
    "ツールは何も呼ばないでください。前置きや締めの一文も付けないでください。",
    "",
    "# L-02 PDF DL test",
    "",
    `![sample](${absPath})`,
    "",
    "本文サンプル。",
  ].join("\n");
  await sendChatMessage(page, message);
}

async function downloadAndAssertPdf(page: Page): Promise<void> {
  const pdfBtn = page.getByTestId("text-response-pdf-button").first();
  await expect(pdfBtn).toBeVisible({ timeout: ONE_MINUTE_MS });
  const downloadPromise = page.waitForEvent("download");
  await pdfBtn.click();
  const pdf = await readPdfDownload(await downloadPromise);
  expect(pdf.length, "PDF should not be a near-empty stub").toBeGreaterThan(MIN_PDF_BYTES);
}

/**
 * Ask the LLM to re-display the seeded mulmoScript via filePath.
 * Reduces script-authoring drift to "the LLM picked the right tool
 * and passed one argument" — both of which are reliable. The
 * fixture itself controls beats / TTS / image type.
 */
async function sendL03FilePathPrompt(page: Page, workspaceScriptRel: string): Promise<void> {
  const message = [
    `\`${PRESENT_MULMO_SCRIPT_TOOL}\` ツールに \`filePath: "${workspaceScriptRel}"\` を渡して、 既存スクリプトをそのまま表示してください。`,
    "",
    "- ツールには filePath だけを渡し、 script は省略してください",
    "- 動画生成 (Generate Movie / generateMovie ツール) は呼ばないでください — テスト側でボタンを押します",
  ].join("\n");
  await sendChatMessage(page, message);
}

/**
 * mulmocast's video pipeline shells out to system ffmpeg via
 * fluent-ffmpeg, so the host needs ffmpeg on PATH. We probe with
 * `which ffmpeg` and skip the test cleanly when it's missing.
 */
function isFFmpegAvailable(): boolean {
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until presentMulmoScript has rendered the script panel with
 * no movie attached yet — that's the moment the Generate Movie pill
 * becomes the visible action. If the LLM refuses to call the tool
 * and just drops markdown, this never appears and the test fails
 * cleanly on the timeout instead of misleading downstream errors.
 */
async function waitForMulmoScriptViewReady(page: Page): Promise<void> {
  await expect(page.getByTestId("mulmo-script-generate-movie-button").first()).toBeVisible({ timeout: ONE_MINUTE_MS });
}

/**
 * Drive the Generate → Download flow end-to-end. The Download pill
 * only appears once the server has finished compose, so its
 * visibility doubles as a "generation complete" signal.
 */
async function generateAndDownloadMovie(page: Page): Promise<void> {
  await page.getByTestId("mulmo-script-generate-movie-button").first().click();
  const downloadBtn = page.getByTestId("mulmo-script-download-movie-button").first();
  await expect(downloadBtn).toBeVisible({ timeout: L03_GENERATION_TIMEOUT_MS });
  const downloadPromise = page.waitForEvent("download");
  await downloadBtn.click();
  const movie = await readMovieDownload(await downloadPromise);
  expect(movie.length, "movie should not be a near-empty stub").toBeGreaterThan(MIN_MOVIE_BYTES);
}

/**
 * Best-effort teardown — never throws. Removes the session from
 * history (so the user's chat list isn't littered with debug runs)
 * and deletes the seeded fixture file.
 */
async function cleanupSessionAndWorkspace(page: Page, workspaceImageRel: string): Promise<void> {
  const sessionId = getCurrentSessionId(page);
  if (sessionId) await deleteSession(page, sessionId);
  await removeFromWorkspace(workspaceImageRel);
}
