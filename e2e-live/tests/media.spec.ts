import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
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
const MIN_PDF_BYTES = 1_000;

// Each scenario opens its own chat session, so they do not share
// state. Run them in parallel to cut wall time — the server happily
// services multiple chat sessions concurrently (verified by hand
// before turning this on).
test.describe.configure({ mode: "parallel" });

test.describe("media (real LLM)", () => {
  test("L-01: presentHtml の <img src='/artifacts/...'> がリライトされ、画像も実際に描画される", async ({ page }) => {
    test.setTimeout(L01_TIMEOUT_MS);

    // Spec-unique workspace path so concurrent runs do not stomp
    // each other and we never delete a real user image by accident.
    const workspaceImageRel = "artifacts/images/e2e-live-l01.png";
    await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);

    try {
      await startNewSession(page);

      // Ask the LLM to call presentHtml with an <img> whose src
      // points at the workspace path we just populated. Verifies
      // both the path-traversal rewrite (B-18 regression check)
      // and the end-to-end serve-from-workspace path (B-18/B-19
      // root-cause check) — if the rewritten URL doesn't resolve
      // to a real file, naturalWidth stays 0.
      const message = [
        "以下の HTML を presentHtml ツールでそのまま表示してください。",
        "",
        "<h1>e2e-live L-01 test</h1>",
        '<img src="/artifacts/images/e2e-live-l01.png" alt="sample" />',
      ].join("\n");
      await sendChatMessage(page, message);

      // Wait for the LLM to respond *and* presentHtml to render
      // the <img> inside the iframe. We wait on the inner <img>
      // rather than just the iframe element because the iframe
      // is appended to the DOM before its srcdoc finishes
      // rendering.
      await waitForImgInPresentHtml(page, 'img[alt="sample"]');

      const src = await readImgSrcInPresentHtml(page, 'img[alt="sample"]');
      expect(src, "presentHtml iframe should contain <img alt='sample'>").not.toBeNull();
      expect(src!).toContain("/api/files/raw");
      expect(src!).toContain("e2e-live-l01.png");
      expect(src!, "raw /artifacts path must not survive the rewrite").not.toMatch(/^\/artifacts\//);

      // The rewritten URL must resolve to the actual fixture file —
      // a broken image leaves naturalWidth at 0, which is exactly
      // the failure mode B-18 produced.
      const size = await readImgNaturalSize(page, 'img[alt="sample"]');
      expect(size, "naturalSize should be readable").not.toBeNull();
      expect(size!.width, "image must actually decode (B-18 regression)").toBeGreaterThan(0);
      expect(size!.height).toBeGreaterThan(0);

      // Let the assistant finish its full turn before ending the
      // test so the trace / video captures the final text reply
      // too. The iframe assertion above can pass before the LLM
      // finishes streaming the closing message; without this wait
      // the recording would cut off mid-response and hide any
      // regression that surfaces only at the end of the turn.
      await waitForAssistantResponseComplete(page);
    } finally {
      await removeFromWorkspace(workspaceImageRel);
    }
  });

  test("L-02: 画像参照を含む Markdown 応答が PDF として DL できる", async ({ page }) => {
    test.setTimeout(L02_TIMEOUT_MS);

    await startNewSession(page);

    // Make Claude reply in plain Markdown (textResponse plugin)
    // with a workspace image reference. The reply itself drives
    // the textResponse view, which exposes the same /api/pdf
    // endpoint that B-19 / B-20 broke. Hitting that endpoint via
    // the real LLM-driven UI is the regression check.
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
  });
});
