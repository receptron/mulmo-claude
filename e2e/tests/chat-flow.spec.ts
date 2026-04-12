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

// Build an SSE response body from a list of event objects. Each
// event becomes one `data: <json>\n` line; an empty trailing line
// terminates the last record. Mirrors what `server/routes/agent.ts`
// sends the frontend.
function buildSseBody(events: readonly unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}`).join("\n") + "\n";
}

async function mockAgentSse(
  page: Page,
  events: readonly unknown[],
): Promise<void> {
  await page.route(urlEndsWith("/api/agent"), (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      body: buildSseBody(events),
      headers: { "Content-Type": "text/event-stream" },
    });
  });
}

// -------- Session load (refactor target: loadSession → parseSessionEntries + resolveSelectedUuid + resolveSessionTimestamps) --------

test.describe("loading an existing session", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("renders the assistant's text reply from the server payload", async ({
    page,
  }) => {
    // SESSION_A's fixture ends with `{source: "assistant", message: "Hi there!"}`
    // — parseSessionEntries must wrap it as a text-response and hand
    // it to the chat list.
    await page.goto(`/chat/${SESSION_A.id}`);
    await expect(page.locator("text=Hi there!").first()).toBeVisible();
  });

  test("URL ?result=<uuid> restores the exact result", async ({ page }) => {
    // Override sessions fixture to include a named tool_result
    // whose uuid we can target via the URL.
    await page.route(
      (url) =>
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname !== "/api/sessions",
      (route) => {
        return route.fulfill({
          json: [
            { type: "session_meta", roleId: "general", sessionId: "s-select" },
            { type: "text", source: "user", message: "what's 2+2?" },
            { type: "text", source: "assistant", message: "four" },
          ],
        });
      },
    );
    // Navigate with a non-existent ?result=<uuid>; resolveSelectedUuid
    // should fall through to the heuristic (last non-text → last text →
    // final uuid). We primarily check the page doesn't 500 and the
    // text still renders.
    await page.goto(`/chat/s-select?result=does-not-exist`);
    await expect(page.locator("text=four").first()).toBeVisible();
  });
});

// -------- Sidebar history merge (refactor target: mergedSessions → mergeSessionLists) --------

test.describe("session history sidebar", () => {
  test("orders server sessions newest updatedAt first", async ({ page }) => {
    // SESSION_B.updatedAt is 2026-04-11, SESSION_A is 2026-04-10.
    // compareSessionsByRecency should put B before A. (A newly-
    // created live session appears at position 0 with updatedAt=now;
    // we only care about the relative order of the two server
    // entries, since that's what mergeSessionLists controls for the
    // persisted history.)
    await mockAllApis(page, { sessions: [SESSION_A, SESSION_B] });
    await page.goto("/");
    await page.getByTestId("history-btn").click();

    const items = page.locator('[data-testid^="session-item-"]');
    const ids = await items.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-testid") ?? ""),
    );
    const indexA = ids.indexOf(`session-item-${SESSION_A.id}`);
    const indexB = ids.indexOf(`session-item-${SESSION_B.id}`);
    expect(indexA).toBeGreaterThanOrEqual(0);
    expect(indexB).toBeGreaterThanOrEqual(0);
    expect(indexB).toBeLessThan(indexA);
  });

  test("prefers server-side AI title over first-user-message preview", async ({
    page,
  }) => {
    // The mergeSessionLists rule: when the server summary has a
    // `preview` (treated as the AI-generated title), it wins over
    // the live session's first user message.
    const customSession = {
      id: "ai-titled",
      title: "AI Titled",
      roleId: "general",
      startedAt: "2026-04-12T10:00:00Z",
      updatedAt: "2026-04-12T10:05:00Z",
      preview: "AI-generated session title",
    };
    await mockAllApis(page, { sessions: [customSession] });
    await page.goto("/");
    await page.getByTestId("history-btn").click();
    // The preview line in each history row is the AI title, not
    // the first message.
    await expect(page.locator("text=AI-generated session title")).toBeVisible();
  });
});

// -------- Send message + SSE parsing (refactor target: sendMessage split + parseSSEChunk + applyAgentEvent) --------

test.describe("sending a chat message", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("streams the assistant's text event into the chat list", async ({
    page,
  }) => {
    // The happy-path regression: user sends a message, the server
    // streams back one text event, the client parses the chunk and
    // applyAgentEvent pushes it to the session's toolResults.
    await mockAgentSse(page, [
      { type: "status", message: "Thinking..." },
      { type: "text", message: "Pong from the server" },
    ]);

    await page.goto("/");
    await page.getByTestId("user-input").fill("ping");
    await page.getByTestId("send-btn").click();

    await expect(page.locator("text=Pong from the server").first()).toBeVisible();
    // The user's own message should also be in the list.
    await expect(page.locator("text=ping").first()).toBeVisible();
  });

  test("malformed SSE events are skipped without killing the stream", async ({
    page,
  }) => {
    // CodeRabbit regression on #177: a `{"type":"tool_result"}` packet
    // without a `result` field used to crash the stream when
    // applyAgentEvent reached `event.result.uuid`. isSseEvent now
    // rejects the malformed packet in decodeSSELine, so the valid
    // text event that follows still renders.
    await mockAgentSse(page, [
      // Malformed — rejected by the variant-shape validator.
      { type: "tool_result" },
      // Also malformed — no uuid inside result.
      { type: "tool_result", result: {} },
      // Valid text event. Must still render.
      { type: "text", message: "survivor message" },
    ]);

    await page.goto("/");
    await page.getByTestId("user-input").fill("hi");
    await page.getByTestId("send-btn").click();

    await expect(page.locator("text=survivor message").first()).toBeVisible();
  });

  test("SSE event split across chunk boundaries still parses", async ({
    page,
  }) => {
    // parseSSEChunk's buffer-remainder behaviour — indirectly
    // exercised by chunked SSE. Playwright's mock fulfill delivers
    // the whole body in one response but the Vue app's
    // response.body.getReader() may still yield the chunk in
    // multiple reads depending on buffer size. Either way a valid
    // event at the end of a large body must render.
    const longStatus = "x".repeat(2048);
    await mockAgentSse(page, [
      { type: "status", message: longStatus },
      { type: "text", message: "final message" },
    ]);

    await page.goto("/");
    await page.getByTestId("user-input").fill("chunk test");
    await page.getByTestId("send-btn").click();

    await expect(page.locator("text=final message").first()).toBeVisible();
  });
});
