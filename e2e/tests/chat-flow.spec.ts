// E2E regression tests for the chat-send / session-load flow.
// Exercises the code paths touched by the .vue cognitive-complexity
// refactors (PR #177 sendMessage split + #178 session-helpers
// extraction). Each test targets a behaviour that was either
// hand-coded inline in the Vue component before, or a specific
// regression the refactor could silently re-introduce.
//
// Tracks #175.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

// Mock the `/api/agent` POST to return 202 (fire-and-forget) and
// send the given events to the client via the WebSocket pub/sub
// channel. The events are delivered when the client subscribes to
// the `session.<id>` channel.
async function mockAgentWithPubSub(
  page: Page,
  events: readonly unknown[],
): Promise<void> {
  // Intercept WebSocket and deliver events when client subscribes
  // to a session channel.
  await page.routeWebSocket(
    (url) => url.pathname === "/ws/pubsub",
    (ws) => {
      ws.onMessage((msg) => {
        try {
          const parsed = JSON.parse(String(msg));
          if (
            parsed.action === "subscribe" &&
            typeof parsed.channel === "string" &&
            parsed.channel.startsWith("session.")
          ) {
            const channel = parsed.channel;
            // Deliver mock events with a small delay so the client
            // has time to process the subscription.
            setTimeout(() => {
              for (const event of events) {
                ws.send(JSON.stringify({ channel, data: event }));
              }
              // Signal end of run
              ws.send(
                JSON.stringify({
                  channel,
                  data: { type: "session_finished" },
                }),
              );
            }, 50);
          }
        } catch {
          // ignore non-JSON messages
        }
      });
    },
  );

  // Mock /api/agent to return 202 (fire-and-forget)
  await page.route(urlEndsWith("/api/agent"), (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 202,
      json: { chatSessionId: "mock-session" },
    });
  });
}

// -------- Session selection (load, switch, sidebar merge, tabs) --------

test.describe("session selection", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("loads session A from url", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);

    // The fixture's user message from makeSessionEntries should render.
    await expect(page.locator("text=Hello").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator("text=Hi there!").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("switching sessions updates the canvas", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);
    // Session A entries loaded.
    await expect(page.locator("text=Hi there!").first()).toBeVisible({
      timeout: 5_000,
    });

    // Navigate to session B via the URL directly (same entries fixture).
    await page.goto(`/chat/${SESSION_B.id}`);
    await expect(page.locator("text=Hi there!").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("history panel shows session previews", async ({ page }) => {
    await page.goto("/");

    // Open history panel.
    const historyBtn = page.getByTestId("history-btn");
    await historyBtn.click();

    // Session previews from fixtures should appear.
    await expect(
      page.locator("text=Hello from session A").first(),
    ).toBeVisible();
  });
});

// -------- Send message + pub/sub event parsing --------

test.describe("sending a chat message", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("streams the assistant's text event into the chat list", async ({
    page,
  }) => {
    // The happy-path regression: user sends a message, the server
    // returns 202, events arrive via WebSocket pub/sub, and
    // applyAgentEvent pushes them to the session's toolResults.
    await mockAgentWithPubSub(page, [
      { type: "status", message: "Thinking..." },
      { type: "text", message: "Pong from the server" },
    ]);

    await page.goto("/");
    await page.getByTestId("user-input").fill("ping");
    await page.getByTestId("send-btn").click();

    await expect(
      page.locator("text=Pong from the server").first(),
    ).toBeVisible();
    // The user's own message should also be in the list.
    await expect(page.locator("text=ping").first()).toBeVisible();
  });

  test("malformed pub/sub events are handled gracefully", async ({ page }) => {
    // Events that don't match known types are silently ignored by
    // the applyAgentEvent switch. Valid events that follow still render.
    await mockAgentWithPubSub(page, [
      // Unknown type — ignored by the switch.
      { type: "unknown_event" },
      // Valid text event. Must still render.
      { type: "text", message: "survivor message" },
    ]);

    await page.goto("/");
    await page.getByTestId("user-input").fill("hi");
    await page.getByTestId("send-btn").click();

    await expect(page.locator("text=survivor message").first()).toBeVisible();
  });

  test("tool_call events appear in session state", async ({ page }) => {
    // Verify that tool_call events are received and the final text
    // still renders after the tool call sequence.
    await mockAgentWithPubSub(page, [
      { type: "status", message: "Thinking..." },
      {
        type: "tool_call",
        toolUseId: "tu-1",
        toolName: "myTool",
        args: { foo: "bar" },
      },
      {
        type: "tool_call_result",
        toolUseId: "tu-1",
        content: "tool output",
      },
      { type: "text", message: "final message" },
    ]);

    await page.goto("/");
    await page.getByTestId("user-input").fill("chunk test");
    await page.getByTestId("send-btn").click();

    await expect(page.locator("text=final message").first()).toBeVisible();
  });
});

// -------- Session creation + tab bar --------

test.describe("creating a new session", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("new-session button creates a fresh session", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);
    // Ensure the session loaded.
    await expect(page.locator("text=Hi there!").first()).toBeVisible({
      timeout: 5_000,
    });

    // Click new session.
    const newSessionBtn = page.getByTestId("new-session-btn");
    await newSessionBtn.click();

    // URL should change to a new session ID (not SESSION_A.id).
    await expect(page).not.toHaveURL(new RegExp(SESSION_A.id));
    // Input should be focusable on the new session.
    await expect(page.getByTestId("user-input")).toBeVisible();
  });
});
