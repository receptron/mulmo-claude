import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  deleteSession,
  getCurrentSessionId,
  placeFixtureInWorkspace,
  readImgNaturalSize,
  readImgSrcInPresentHtml,
  readPdfDownload,
  removeFromWorkspace,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
  waitForImgInPresentHtml,
} from "../fixtures/live-chat.ts";

const L01_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const L02_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
// Floor for "the route returned a real PDF, not a stub". The actual
// size depends on how verbose the LLM's reply happens to be that
// run, so this is loose on purpose — `readPdfDownload` already
// asserts the %PDF- magic bytes, this number just keeps obviously
// empty stubs out.
const MIN_PDF_BYTES = 500;

// Each scenario opens its own chat session, so they do not share
// state. Run them in parallel to cut wall time — the server happily
// services multiple chat sessions concurrently (verified by hand
// before turning this on).
test.describe.configure({ mode: "parallel" });

test.describe("media (real LLM)", () => {
  test("L-01: presentHtml の <img src='../../../images/...'> が /artifacts/html 経由で描画される", async ({ page }) => {
    test.setTimeout(L01_TIMEOUT_MS);

    // Spec-unique workspace path so concurrent runs do not stomp
    // each other and we never delete a real user image by accident.
    const workspaceImageRel = "artifacts/images/e2e-live-l01.png";
    await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);

    try {
      await startNewSession(page);

      // Ask the LLM to call presentHtml with an <img> whose src
      // points at the workspace path we just populated. PR #982
      // (plans/feat-presenthtml-filepath-only.md) switched
      // presentHtml to render via `<iframe :src="/artifacts/html/...">`
      // and trains the LLM to use **relative paths** — the HTML
      // file is saved at `artifacts/html/<YYYY>/<MM>/page.html`
      // so reaching `artifacts/images/<file>` is `../../../images/<file>`.
      // The end-to-end success criterion is `naturalWidth > 0`:
      // if anything in the chain (saved HTML, the
      // /artifacts/html mount, the /artifacts/images mount, or
      // the path-traversal guard) breaks, the image stays 0×0 —
      // exactly the failure mode B-18 produced before #969 / #972.
      const message = [
        "以下の HTML を presentHtml ツールでそのまま表示してください。",
        "",
        "<h1>e2e-live L-01 test</h1>",
        '<img src="../../../images/e2e-live-l01.png" alt="sample" />',
      ].join("\n");
      await sendChatMessage(page, message);

      // Wait for the LLM to respond *and* presentHtml to render
      // the <img> inside the iframe. We wait on the inner <img>
      // rather than just the iframe element because the iframe
      // is appended to the DOM before its srcdoc finishes
      // rendering.
      await waitForImgInPresentHtml(page, 'img[alt="sample"]');

      const src = await readImgSrcInPresentHtml(page, 'img[alt="sample"]');
      // Use an explicit guard rather than non-null assertions so a
      // null surface produces a clear test failure and downstream
      // assertions can use `src` without `!`.
      if (src === null) {
        throw new Error("presentHtml iframe should contain <img alt='sample'>");
      }
      // Per PR #982 the LLM keeps the relative `../../../images/...`
      // path verbatim — the browser resolves it against the iframe's
      // src (the /artifacts/html/... mount). Asserting the unresolved
      // attribute keeps us decoupled from that resolution.
      expect(src).toContain("e2e-live-l01.png");
      expect(src, "the LLM must follow the relative-path convention from PR #982").not.toMatch(/^\/artifacts\//);

      // The URL must resolve to the actual fixture file. A broken
      // image leaves naturalWidth at 0, which is the failure mode
      // B-18 produced.
      const size = await readImgNaturalSize(page, 'img[alt="sample"]');
      if (size === null) {
        throw new Error("naturalSize should be readable");
      }
      expect(size.width, "image must actually decode (B-18 regression)").toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);

      // Let the assistant finish its full turn before ending the
      // test so the trace / video captures the final text reply
      // too. The iframe assertion above can pass before the LLM
      // finishes streaming the closing message; without this wait
      // the recording would cut off mid-response and hide any
      // regression that surfaces only at the end of the turn.
      await waitForAssistantResponseComplete(page);
    } finally {
      const sessionId = getCurrentSessionId(page);
      if (sessionId) await deleteSession(page, sessionId);
      await removeFromWorkspace(workspaceImageRel);
    }
  });

  test("L-02: 画像参照を含む Markdown 応答が PDF として DL できる", async ({ page }) => {
    test.setTimeout(L02_TIMEOUT_MS);

    await startNewSession(page);

    try {
      // Make Claude reply in plain Markdown (textResponse plugin)
      // with a workspace image reference. The reply itself drives
      // the textResponse view, which exposes the same /api/pdf
      // endpoint that B-19 / B-20 broke. Hitting that endpoint
      // via the real LLM-driven UI is the regression check.
      const message = [
        "次の Markdown を **そのまま** 1 ターンの返信本文として返してください。",
        "ツールは何も呼ばないでください。前置きや締めの一文も付けないでください。",
        "",
        "# L-02 PDF DL test",
        "",
        "![sample](/artifacts/images/sample.png)",
        "",
        "本文サンプル。",
      ].join("\n");
      await sendChatMessage(page, message);

      // The PDF button only renders once the assistant turn is
      // committed to the textResponse view, so wait for the full
      // response before reaching for it.
      await waitForAssistantResponseComplete(page);

      const pdfBtn = page.getByTestId("text-response-pdf-button").first();
      await expect(pdfBtn).toBeVisible({ timeout: ONE_MINUTE_MS });

      const downloadPromise = page.waitForEvent("download");
      await pdfBtn.click();
      const download = await downloadPromise;

      const pdf = await readPdfDownload(download);
      expect(pdf.length, "PDF should not be a near-empty stub").toBeGreaterThan(MIN_PDF_BYTES);
    } finally {
      const sessionId = getCurrentSessionId(page);
      if (sessionId) await deleteSession(page, sessionId);
    }
  });
});
