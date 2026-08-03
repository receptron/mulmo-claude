// StackView auto-follow gate (#2179).
//
// Streaming fires `latestResultScrollKey` on every chunk, and the watcher
// used to slam the canvas to the bottom (or to the newest card) each time —
// dragging the view out from under anyone who had scrolled up to read.
// Following is now gated on `stickToBottom`, which only a genuine user
// scroll moves.
//
// Two things must hold, and they pull in opposite directions:
//   * scrolled away  → a streamed result must NOT move the viewport
//   * back at bottom → following must resume
//
// The gate deliberately ignores programmatic scrolls (they run inside the
// scroll-sync suppression window). Otherwise the newest-card jump would
// land away from the bottom, read as "the user scrolled up", and cancel
// its own follow — see stack-map-grouping-scroll.spec.ts, which covers
// that card-jump path.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockAgentWithPubSub, releaseStream, waitForScrollHeightStable, scrollMetrics } from "../fixtures/pubsub";
import { SESSION_A } from "../fixtures/sessions";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

const LOAD_MARKER = "loaded turn marker";
const STREAM_MARKER = "streamed follow-up marker";
// Wide enough that neither "unchanged" nor "pinned" is a coin flip.
const BOTTOM_TOLERANCE_PX = 50;

function textEntry(source: "user" | "assistant", message: string) {
  return { type: "text", source, message };
}

const META_ENTRY = { type: "session_meta", roleId: "general", sessionId: SESSION_A.id };

// Several viewports of content so "scrolled up" is unambiguous.
const tallTranscript = () => [
  META_ENTRY,
  textEntry("user", "Explain something at length"),
  textEntry("assistant", `${LOAD_MARKER}. `.repeat(150)),
  textEntry("assistant", `More loaded prose to make the canvas overflow. `.repeat(150)),
];

const streamedEntry = textEntry("assistant", `${STREAM_MARKER}. `.repeat(40));

async function serveTranscript(page: Page, entries: readonly unknown[]): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/sessions/${SESSION_A.id}`,
    (route) => (route.request().method() === "GET" ? route.fulfill({ json: entries }) : route.fallback()),
  );
}

async function openStackSession(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("canvas_layout_mode", "stack"));
  await page.goto(`/chat/${SESSION_A.id}`);
  await expect(page.getByTestId("stack-scroll")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  await expect(page.getByText(LOAD_MARKER).first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  await waitForScrollHeightStable(page, "stack-scroll");
}

async function scrollCanvas(page: Page, deltaY: number): Promise<void> {
  await page.getByTestId("stack-scroll").hover();
  await page.mouse.wheel(0, deltaY);
}

// The streamed card lands in the DOM whether or not it is in view, so this
// is a real delivery signal rather than a timing guess.
async function awaitStreamedResult(page: Page): Promise<void> {
  await expect(page.getByText(STREAM_MARKER).first()).toBeVisible({ timeout: 10 * ONE_SECOND_MS });
  await waitForScrollHeightStable(page, "stack-scroll");
}

test.describe("StackView — sticky-bottom auto-follow (#2179)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("a streamed result does not move the viewport while the reader is scrolled up", async ({ page }) => {
    // Held until this test releases it, so the scroll provably happens first;
    // the assertions below are about what the arriving result does to an
    // ALREADY-scrolled canvas. A fixed delay used to order these, and it was a
    // race against this test's own setup — under load the setup lost, the
    // result landed before `before` was recorded, and the growth asserted at
    // the end had already been counted (#2766).
    await serveTranscript(page, tallTranscript());
    await mockAgentWithPubSub(page, [streamedEntry], { startOnRelease: true });
    await openStackSession(page);

    // Let the load's own auto-scroll and its suppression window clear, so
    // the wheel below registers as a genuine user scroll.
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- waits out the load auto-scroll's timed suppression window, which has no observable DOM signal.
    await page.waitForTimeout(500);
    await scrollCanvas(page, -5000); // reader scrolls up to re-read
    await waitForScrollHeightStable(page, "stack-scroll");

    const before = await scrollMetrics(page, "stack-scroll");
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight); // canvas really overflows
    expect(before.scrollHeight - before.scrollTop - before.clientHeight).toBeGreaterThan(BOTTOM_TOLERANCE_PX);

    await releaseStream(page);
    await awaitStreamedResult(page);

    const after = await scrollMetrics(page, "stack-scroll");
    // The result landed (content grew) but the viewport stayed put.
    expect(after.scrollHeight).toBeGreaterThan(before.scrollHeight);
    expect(after.scrollTop).toBe(before.scrollTop);
  });

  // Guards the gate the test above depends on. Without this, `startOnRelease`
  // could stop holding anything — the flag left set by a previous release, a
  // polling bug — and that test would go back to racing its own setup while
  // still passing, which is exactly how it broke the first time (#2766).
  test("startOnRelease holds the stream until releaseStream is called", async ({ page }) => {
    await serveTranscript(page, tallTranscript());
    await mockAgentWithPubSub(page, [streamedEntry], { startOnRelease: true });
    await openStackSession(page);

    const marker = page.getByText(STREAM_MARKER).first();
    // Long enough that a gate which is not holding would have delivered: the
    // events send `RENDER_GAP_MS` (20ms) apart once released.
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- proving an ABSENCE over a window; there is no DOM signal for "still not sent".
    await page.waitForTimeout(2000);
    await expect(marker).toHaveCount(0);

    await releaseStream(page);
    await expect(marker).toBeVisible({ timeout: 10 * ONE_SECOND_MS });
  });

  test("following resumes once the reader scrolls back to the bottom", async ({ page }) => {
    await serveTranscript(page, tallTranscript());
    await mockAgentWithPubSub(page, [streamedEntry], { startDelayMs: 2500 });
    await openStackSession(page);

    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- same load-suppression window as above.
    await page.waitForTimeout(500);
    await scrollCanvas(page, -5000); // scroll away → following disarms
    await waitForScrollHeightStable(page, "stack-scroll");
    await scrollCanvas(page, 10000); // …and back to the bottom → re-arms
    await waitForScrollHeightStable(page, "stack-scroll");

    await awaitStreamedResult(page);

    const after = await scrollMetrics(page, "stack-scroll");
    expect(after.scrollHeight - after.scrollTop - after.clientHeight).toBeLessThanOrEqual(BOTTOM_TOLERANCE_PX);
  });
});
