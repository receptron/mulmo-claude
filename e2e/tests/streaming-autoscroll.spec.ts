// E2E regression for the streaming auto-scroll bug (PR #529).
//
// Background: the sidebar's useChatScroll composable and StackView's
// own scroll watcher BOTH keyed only on `toolResults.length`. During
// assistant text streaming, `appendToLastAssistantText` appends to
// the last card in place — length does not change — so auto-scroll
// silently stopped after the first chunk, leaving the newest text
// below the fold.
//
// The fix watches a key that includes the last result's message
// length so every streaming chunk triggers a scroll. This test
// guards both scroll paths (sidebar in Single mode, StackView in
// Stack mode) because a future refactor that introduces a new view
// mode with its own scroll container must extend the same pattern.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";
function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

// Build a streaming transcript: the first text event creates the
// assistant card (length 0 → 1), every subsequent event appends to
// the same card via appendToLastAssistantText (length stays at 1).
// Generates enough total bytes to overflow the visible viewport so
// the scroll container actually has room to scroll.
function buildStreamingEvents(chunkCount: number, chunkBody: string) {
  return Array.from({ length: chunkCount }, () => ({
    type: "text",
    source: "assistant",
    message: chunkBody,
  }));
}

// Relay a sequence of pub/sub events to the mocked WebSocket with a
// small gap between each send so Vue re-renders between chunks.
async function streamEventsToSocket(webSocket: { send: (data: string) => void }, channel: string, events: readonly unknown[]): Promise<void> {
  for (const event of events) {
    webSocket.send("42" + JSON.stringify(["data", { channel, data: event }]));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  webSocket.send("42" + JSON.stringify(["data", { channel, data: { type: "session_finished" } }]));
}

function handleSocketFrame(text: string, webSocket: { send: (data: string) => void }, events: readonly unknown[]): void {
  if (text === "2") return webSocket.send("3");
  if (text === "40") return webSocket.send("40" + JSON.stringify({ sid: "mock-socket-sid" }));
  if (!text.startsWith("42")) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(2));
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  const [name, arg] = parsed as [string, unknown];
  if (name !== "subscribe" || typeof arg !== "string" || !arg.startsWith("session.")) return;
  void streamEventsToSocket(webSocket, arg, events);
}

async function mockAgentWithPubSub(page: Page, events: readonly unknown[]): Promise<void> {
  await page.routeWebSocket(
    (url) => url.pathname.startsWith("/ws/pubsub"),
    (webSocket) => {
      webSocket.send(
        "0" +
          JSON.stringify({
            sid: "mock-sid",
            upgrades: [],
            pingInterval: 25000,
            pingTimeout: 20000,
            maxPayload: 1_000_000,
          }),
      );
      webSocket.onMessage((msg) => handleSocketFrame(String(msg), webSocket, events));
    },
  );

  await page.route(urlEndsWith("/api/agent"), (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 202,
      json: { chatSessionId: "mock-session" },
    });
  });
}

/** Wait until scrollHeight stops growing for two consecutive samples,
 *  meaning the streaming has finished and the DOM has settled. */
async function waitForScrollHeightStable(page: Page, testId: string, opts: { sampleGapMs?: number; maxWaitMs?: number } = {}): Promise<void> {
  const gap = opts.sampleGapMs ?? 300;
  const maxWait = opts.maxWaitMs ?? 10_000;
  const deadline = Date.now() + maxWait;
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const current = await page.getByTestId(testId).evaluate((elem) => elem.scrollHeight);
    if (current === last && current > 0) {
      stable++;
      if (stable >= 2) return;
    } else {
      stable = 0;
      last = current;
    }
    await page.waitForTimeout(gap);
  }
}

/** Read scrollTop + scrollHeight + clientHeight from a scroll container. */
async function scrollMetrics(page: Page, testId: string): Promise<{ scrollTop: number; scrollHeight: number; clientHeight: number }> {
  return page.getByTestId(testId).evaluate((elem) => ({
    scrollTop: elem.scrollTop,
    scrollHeight: elem.scrollHeight,
    clientHeight: elem.clientHeight,
  }));
}

// We accept "near-bottom" rather than exact equality — browser
// rounding and late iframe sizing can leave a handful of pixels.
const BOTTOM_TOLERANCE_PX = 50;

// The sidebar SessionSidebar only renders preview titles for each
// result, so long streamed text never makes it overflow — the
// streaming bug wasn't observable there in practice. StackView on
// the other hand renders the full message body, where the stalled
// scroll was visible to users. That's the case this test guards.
test.describe("assistant text streaming — auto-scroll follows the stream", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("StackView (Stack mode) stays pinned to the bottom during streaming", async ({ page }) => {
    const chunk = "Streaming chunk with enough text to matter. ".repeat(5);
    await mockAgentWithPubSub(page, buildStreamingEvents(40, chunk));

    // Stack layout is a localStorage preference on /chat. Set it
    // before navigating so the first render is already in stack mode.
    await page.addInitScript(() => localStorage.setItem("canvas_layout_mode", "stack"));
    await page.goto("/chat");
    await page.getByTestId("user-input").fill("stream me in stack");
    await page.getByTestId("send-btn").click();

    await expect(page.locator("text=Streaming chunk").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await waitForScrollHeightStable(page, "stack-scroll");

    const { scrollTop, scrollHeight, clientHeight } = await scrollMetrics(page, "stack-scroll");
    expect(scrollHeight).toBeGreaterThan(clientHeight);
    expect(scrollHeight - scrollTop - clientHeight).toBeLessThan(BOTTOM_TOLERANCE_PX);
  });
});
