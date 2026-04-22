// Top-page UI regression tests — based on PR #529 comment listing
// 16 user-flow categories for the main App.vue refactor.
//
// These tests exercise the full top-page lifecycle: session CRUD,
// URL routing, view-mode switching, streaming, error handling,
// notifications, keyboard navigation, and more.
//
// Ref: https://github.com/receptron/mulmoclaude/pull/529#issuecomment-4287919433

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";
import { sendChatMessage, chatInput, selectSessionTab, openSessionHistory, switchRole } from "../fixtures/chat";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

/** Mock the socket.io pub/sub + POST /api/agent to stream SSE events. */
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
      webSocket.onMessage((msg) => {
        const text = String(msg);
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
        const channel = arg;
        setTimeout(() => {
          for (const event of events) {
            webSocket.send("42" + JSON.stringify(["data", { channel, data: event }]));
          }
          webSocket.send("42" + JSON.stringify(["data", { channel, data: { type: "session_finished" } }]));
        }, 50);
      });
    },
  );

  await page.route(urlEndsWith("/api/agent"), (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
  });
}

/** Mock pub/sub that sends notification events to the notifications channel. */
async function mockPubSubWithNotifications(page: Page, notifications: readonly unknown[]): Promise<void> {
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
      webSocket.onMessage((msg) => {
        const text = String(msg);
        if (text === "2") return webSocket.send("3");
        if (text === "40") {
          webSocket.send("40" + JSON.stringify({ sid: "mock-socket-sid" }));
          // Send notifications after connect
          setTimeout(() => {
            for (const notif of notifications) {
              webSocket.send("42" + JSON.stringify(["data", { channel: "notifications", data: notif }]));
            }
          }, 100);
          return;
        }
        if (!text.startsWith("42")) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text.slice(2));
        } catch {
          return;
        }
        if (!Array.isArray(parsed)) return;
        const [name, arg] = parsed as [string, unknown];
        // Handle session subscriptions (return empty finished)
        if (name === "subscribe" && typeof arg === "string" && arg.startsWith("session.")) {
          return;
        }
      });
    },
  );
}

/** Read scroll metrics from a scroll container identified by data-testid. */
async function scrollMetrics(page: Page, testId: string): Promise<{ scrollTop: number; scrollHeight: number; clientHeight: number }> {
  return page.getByTestId(testId).evaluate((elem) => ({
    scrollTop: elem.scrollTop,
    scrollHeight: elem.scrollHeight,
    clientHeight: elem.clientHeight,
  }));
}

const BOTTOM_TOLERANCE_PX = 50;

// ---------------------------------------------------------------------------
// 1. New session → send → response
// ---------------------------------------------------------------------------
test.describe("1. new session → send → response", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("role selection, send, assistant response, and input re-focus", async ({ page }) => {
    await mockAgentWithPubSub(page, [
      { type: "status", message: "Thinking..." },
      { type: "tool_call", toolUseId: "tu-1", toolName: "myTool", args: { query: "test" } },
      { type: "tool_call_result", toolUseId: "tu-1", content: "tool output" },
      { type: "text", message: "Here is the answer" },
    ]);

    await page.goto("/");
    await sendChatMessage(page, "Hello world");

    // assistant text appears
    await expect(page.locator("text=Here is the answer").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });
    // user message appears
    await expect(page.locator("text=Hello world").first()).toBeVisible();
    // input should be visible and enabled after session finishes
    await expect(chatInput(page)).toBeVisible();
    await expect(chatInput(page)).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// 2. Session switching
// ---------------------------------------------------------------------------
test.describe("2. session switching", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("sidebar session tab switches and URL syncs", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);
    await expect(page.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Click session B tab
    await selectSessionTab(page, SESSION_B.id);
    await expect(page).toHaveURL(new RegExp(SESSION_B.id), { timeout: 5 * ONE_SECOND_MS });
  });

  test("history panel session selection restores session", async ({ page }) => {
    await page.goto("/");
    await openSessionHistory(page);

    const sessionItem = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(sessionItem).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await sessionItem.click();

    await expect(page).toHaveURL(new RegExp(SESSION_A.id), { timeout: 5 * ONE_SECOND_MS });
    await expect(page.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  });

  test("switching to a session with hasUnread clears the unread state", async ({ page }) => {
    // SESSION_B has unread
    await page.route(urlEndsWith("/api/sessions"), (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({
        json: {
          sessions: [SESSION_A, { ...SESSION_B, hasUnread: true }],
          cursor: "v1:0",
          deletedIds: [],
        },
      });
    });

    await page.goto(`/chat/${SESSION_A.id}`);
    await expect(page.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Unread badge should show
    await expect(page.getByTestId("unread-session-badge")).toBeVisible({ timeout: 3 * ONE_SECOND_MS });

    // Set up response waiter BEFORE the click that triggers it
    const markReadPromise = page.waitForResponse((resp) => resp.url().includes(`/api/sessions/${SESSION_B.id}`) && resp.request().method() === "POST", {
      timeout: 5 * ONE_SECOND_MS,
    });

    // Switch to session B (unread)
    await selectSessionTab(page, SESSION_B.id);
    await expect(page).toHaveURL(new RegExp(SESSION_B.id), { timeout: 5 * ONE_SECOND_MS });

    // Verify mark-read POST was sent
    const markReadSent = await markReadPromise;
    expect(markReadSent.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 3. URL direct / reload
// ---------------------------------------------------------------------------
test.describe("3. URL direct access / reload", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("reload preserves session", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);
    await expect(page.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    await page.reload();
    await expect(page).toHaveURL(new RegExp(SESSION_A.id));
    await expect(page.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  });

  test("?role= in URL selects the role", async ({ page }) => {
    // Provide roles so ?role= has something to match
    await page.route(urlEndsWith("/api/roles"), (route) =>
      route.fulfill({
        json: [
          { id: "general", name: "General", icon: "star", prompt: "You are helpful.", availablePlugins: [] },
          { id: "coder", name: "Coder", icon: "code", prompt: "You write code.", availablePlugins: [] },
        ],
      }),
    );

    await page.goto(`/chat/${SESSION_A.id}?role=coder`);
    await expect(page.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // The role selector should reflect the coder role
    const roleBtn = page.getByTestId("role-selector-btn");
    await expect(roleBtn).toBeVisible();
  });

  test("clicking a result sets ?result= and shows ring selection", async ({ page }) => {
    // Provide a session with multiple results
    await page.route(
      (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
      (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({
          json: [
            { type: "session_meta", roleId: "general", sessionId: SESSION_A.id },
            { type: "text", source: "user", message: "Hello" },
            { type: "text", source: "assistant", message: "Hi there!" },
            { type: "text", source: "user", message: "Another question" },
            { type: "text", source: "assistant", message: "Another answer" },
          ],
        });
      },
    );

    await page.goto(`/chat/${SESSION_A.id}`);
    await expect(page.locator("text=Another answer").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    const resultCards = page.locator("[data-testid^='tool-result-']");
    const count = await resultCards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Click the first result card
    await resultCards.nth(0).click();

    // ?result= param should appear in URL
    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("result")).toBeTruthy();
    }).toPass({ timeout: 3 * ONE_SECOND_MS });

    const firstResultUuid = new URL(page.url()).searchParams.get("result")!;

    // The clicked card should have the selection ring
    const firstCard = page.getByTestId(`tool-result-${firstResultUuid}`);
    await expect(firstCard).toHaveClass(/ring-2/);

    // Click a different result card
    await resultCards.nth(1).click();
    await expect(async () => {
      const url = new URL(page.url());
      const newResult = url.searchParams.get("result");
      expect(newResult).toBeTruthy();
      expect(newResult).not.toBe(firstResultUuid);
    }).toPass({ timeout: 3 * ONE_SECOND_MS });

    // First card should lose ring, second card should have it
    await expect(firstCard).not.toHaveClass(/ring-2/);
    const secondUuid = new URL(page.url()).searchParams.get("result")!;
    await expect(page.getByTestId(`tool-result-${secondUuid}`)).toHaveClass(/ring-2/);
  });
});

// ---------------------------------------------------------------------------
// 4. Back/Forward buttons
// ---------------------------------------------------------------------------
test.describe("4. back/forward browser buttons", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("back and forward navigate between sessions", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);
    await expect(page.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Navigate to session B
    await selectSessionTab(page, SESSION_B.id);
    await expect(page).toHaveURL(new RegExp(SESSION_B.id), { timeout: 5 * ONE_SECOND_MS });

    // Go back → session A
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(SESSION_A.id), { timeout: 5 * ONE_SECOND_MS });

    // Go forward → session B
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(SESSION_B.id), { timeout: 5 * ONE_SECOND_MS });
  });
});

// ---------------------------------------------------------------------------
// 5. Canvas View mode switching
// ---------------------------------------------------------------------------
test.describe("5. canvas view mode switching", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("Cmd+1–8 keyboard shortcuts cycle view modes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-title")).toBeVisible();

    const shortcutMap: [string, string | null][] = [
      ["2", "stack"],
      ["3", "files"],
      ["4", "todos"],
      ["5", "scheduler"],
      ["6", "wiki"],
      ["7", "skills"],
      ["8", "roles"],
      ["1", null], // back to single (no ?view=)
    ];

    for (const [key, expectedView] of shortcutMap) {
      await page.keyboard.press(`Meta+${key}`);
      if (expectedView) {
        await expect(page).toHaveURL(new RegExp(`[?&]view=${expectedView}`), { timeout: 3 * ONE_SECOND_MS });
      } else {
        await expect(page).not.toHaveURL(/[?&]view=/, { timeout: 3 * ONE_SECOND_MS });
      }
    }
  });

  test("plugin launcher buttons navigate to views", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("plugin-launcher")).toBeVisible();

    await page.getByTestId("plugin-launcher-todos").click();
    await expect(page).toHaveURL(/[?&]view=todos/, { timeout: 3 * ONE_SECOND_MS });

    await page.getByTestId("plugin-launcher-wiki").click();
    await expect(page).toHaveURL(/[?&]view=wiki/, { timeout: 3 * ONE_SECOND_MS });
  });

  test("?view=files with ?path= clears path on mode switch", async ({ page }) => {
    // Mock file tree for the files view
    await page.route(urlEndsWith("/api/files/dir"), (route) =>
      route.fulfill({
        json: { name: "", path: "", type: "dir", children: [{ name: "test.md", path: "test.md", type: "file", size: 10 }] },
      }),
    );

    await page.goto("/chat?view=files&path=test.md");
    await expect(page).toHaveURL(/[?&]view=files/);

    // Switch to todos view
    await page.keyboard.press("Meta+4");
    await expect(page).toHaveURL(/[?&]view=todos/, { timeout: 3 * ONE_SECOND_MS });

    // path param should be gone
    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("path")).toBeNull();
    }).toPass({ timeout: 3 * ONE_SECOND_MS });
  });

  test("clicking session tab from non-chat view restores chat view", async ({ page }) => {
    // Start in todos view
    await page.goto(`/chat/${SESSION_A.id}?view=todos`);
    await expect(page).toHaveURL(/[?&]view=todos/);

    // Click session B tab — should revert to a chat view (single/stack)
    await selectSessionTab(page, SESSION_B.id);
    await expect(page).toHaveURL(new RegExp(SESSION_B.id), { timeout: 5 * ONE_SECOND_MS });

    // Should NOT be in todos view anymore
    await expect(page).not.toHaveURL(/[?&]view=todos/, { timeout: 3 * ONE_SECOND_MS });
  });
});

// ---------------------------------------------------------------------------
// 6. Tool Result display / update
// ---------------------------------------------------------------------------
test.describe("6. tool result display", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("tool_result events render in sidebar", async ({ page }) => {
    await mockAgentWithPubSub(page, [
      { type: "status", message: "Thinking..." },
      {
        type: "tool_result",
        result: { uuid: "result-001", toolName: "text-response", title: "Assistant", message: "Hello there", data: {} },
      },
    ]);

    await page.goto("/");
    await sendChatMessage(page, "test");

    await expect(page.getByTestId("tool-result-result-001")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  });
});

// ---------------------------------------------------------------------------
// 7. Todo / Scheduler / Wiki views
// ---------------------------------------------------------------------------
test.describe("7. todo / scheduler / wiki views", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("todo view renders", async ({ page }) => {
    await page.goto("/chat?view=todos");
    // Todo explorer should show add button
    await expect(page.getByTestId("todo-add-btn")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  });

  test("scheduler view renders", async ({ page }) => {
    await page.goto("/chat?view=scheduler");
    await expect(page.getByTestId("scheduler-tab-calendar")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await expect(page.getByTestId("scheduler-tab-tasks")).toBeVisible();
  });

  test("wiki view renders", async ({ page }) => {
    await page.goto("/chat?view=wiki");
    // Wiki view should be visible (even with empty content)
    await expect(page).toHaveURL(/[?&]view=wiki/);
  });
});

// ---------------------------------------------------------------------------
// 8. Notification click navigation
// ---------------------------------------------------------------------------
test.describe("8. notification click navigation", () => {
  test("todo notification navigates to todos view", async ({ page }) => {
    await mockAllApis(page);
    await mockPubSubWithNotifications(page, [
      {
        id: "notif-1",
        kind: "todo",
        title: "Task reminder",
        body: "Don't forget!",
        firedAt: new Date().toISOString(),
        priority: "normal",
        action: { type: "navigate", view: "todos" },
      },
    ]);

    await page.goto("/");
    // Wait for notification badge to appear
    await expect(page.getByTestId("notification-badge")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Click bell, then notification item
    await page.getByTestId("notification-bell").click();
    await expect(page.getByTestId("notification-panel")).toBeVisible();
    await page.getByTestId("notification-item-notif-1").click();

    // Should navigate to todos view
    await expect(page).toHaveURL(/[?&]view=todos/, { timeout: 5 * ONE_SECOND_MS });
  });

  test("session notification navigates to that session", async ({ page }) => {
    await mockAllApis(page);
    await mockPubSubWithNotifications(page, [
      {
        id: "notif-2",
        kind: "agent",
        title: "Agent finished",
        firedAt: new Date().toISOString(),
        priority: "normal",
        action: { type: "navigate", view: "chat", sessionId: SESSION_A.id },
      },
    ]);

    await page.goto("/");
    await expect(page.getByTestId("notification-badge")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    await page.getByTestId("notification-bell").click();
    await page.getByTestId("notification-item-notif-2").click();

    await expect(page).toHaveURL(new RegExp(SESSION_A.id), { timeout: 5 * ONE_SECOND_MS });
  });
});

// ---------------------------------------------------------------------------
// 9. Streaming auto-scroll (long text)
// ---------------------------------------------------------------------------
test.describe("9. streaming auto-scroll", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("stack view stays pinned to bottom throughout streaming, not just at the end", async ({ page }) => {
    const chunk = "Streaming chunk with enough text to fill the viewport. ".repeat(5);
    const totalChunks = 40;
    const events = Array.from({ length: totalChunks }, () => ({
      type: "text",
      source: "assistant",
      message: chunk,
    }));

    // Track bottom-distance samples taken during streaming
    const bottomDistanceSamples: number[] = [];

    // Use streaming mock with delays between chunks
    await page.routeWebSocket(
      (url) => url.pathname.startsWith("/ws/pubsub"),
      (webSocket) => {
        webSocket.send("0" + JSON.stringify({ sid: "mock-sid", upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1_000_000 }));
        webSocket.onMessage((msg) => {
          const text = String(msg);
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
          const channel = arg;
          // Stream with delays between chunks
          void (async () => {
            for (const event of events) {
              webSocket.send("42" + JSON.stringify(["data", { channel, data: event }]));
              await new Promise((resolve) => setTimeout(resolve, 30));
            }
            webSocket.send("42" + JSON.stringify(["data", { channel, data: { type: "session_finished" } }]));
          })();
        });
      },
    );

    await page.route(urlEndsWith("/api/agent"), (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
    });

    await page.goto("/?view=stack");
    await sendChatMessage(page, "write a long essay");

    await expect(page.locator("text=Streaming chunk").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Sample scroll position multiple times DURING streaming
    for (let sample = 0; sample < 5; sample++) {
      await page.waitForTimeout(200);
      const metrics = await scrollMetrics(page, "stack-scroll");
      if (metrics.scrollHeight > metrics.clientHeight) {
        bottomDistanceSamples.push(metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
      }
    }

    // Wait for streaming to finish
    await page.waitForTimeout(ONE_SECOND_MS);

    // Final check
    const finalMetrics = await scrollMetrics(page, "stack-scroll");
    if (finalMetrics.scrollHeight > finalMetrics.clientHeight) {
      bottomDistanceSamples.push(finalMetrics.scrollHeight - finalMetrics.scrollTop - finalMetrics.clientHeight);
    }

    // ALL mid-stream samples should be near-bottom, not just the final one.
    // This catches the bug where scroll stops mid-stream but catches up at
    // the end (e.g. only on session_finished refetch).
    expect(bottomDistanceSamples.length).toBeGreaterThanOrEqual(3);
    for (const distance of bottomDistanceSamples) {
      expect(distance).toBeLessThan(BOTTOM_TOLERANCE_PX);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Multi-tab sync
// ---------------------------------------------------------------------------
test.describe("10. multi-tab sync", () => {
  test("tab B receives events in real time while tab A is streaming", async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    for (const page of [page1, page2]) {
      await mockAllApis(page);
    }

    // Shared event bus: when tab A's agent publishes to a session
    // channel, tab B's WebSocket also receives the same events.
    const crossTabSenders: Array<(channel: string, data: unknown) => void> = [];

    async function setupCrossTabPubSub(page: Page): Promise<void> {
      await page.routeWebSocket(
        (url) => url.pathname.startsWith("/ws/pubsub"),
        (webSocket) => {
          webSocket.send("0" + JSON.stringify({ sid: "mock-sid", upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1_000_000 }));
          // Register this socket as a cross-tab receiver
          const sender = (channel: string, data: unknown) => {
            webSocket.send("42" + JSON.stringify(["data", { channel, data }]));
          };
          crossTabSenders.push(sender);

          webSocket.onMessage((msg) => {
            const text = String(msg);
            if (text === "2") return webSocket.send("3");
            if (text === "40") return webSocket.send("40" + JSON.stringify({ sid: "mock-socket-sid" }));
            // No need to handle subscribe here — events are pushed
            // from the agent mock via crossTabSenders
          });
        },
      );
    }

    await setupCrossTabPubSub(page1);
    await setupCrossTabPubSub(page2);

    // Tab 1's agent mock: on POST, stream events to ALL connected tabs
    await page1.route(urlEndsWith("/api/agent"), (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = JSON.parse(route.request().postData() ?? "{}");
      const sessionId = body.chatSessionId as string;
      const channel = `session.${sessionId}`;

      // Stream events to all tabs with delays.
      // Include the user text event so tab B also sees the user message
      // (the server echoes it back via pub/sub in the real app).
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        for (const sender of crossTabSenders) {
          sender(channel, { type: "text", source: "user", message: "Hello from tab 1" });
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        for (const sender of crossTabSenders) {
          sender(channel, { type: "status", message: "Thinking..." });
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        for (const sender of crossTabSenders) {
          sender(channel, { type: "text", message: "Live from tab A" });
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        for (const sender of crossTabSenders) {
          sender(channel, { type: "session_finished" });
        }
      })();

      return route.fulfill({ status: 202, json: { chatSessionId: sessionId } });
    });

    // Both tabs navigate to the same KNOWN session (mock API
    // returns entries for SESSION_A). Tab 2 must load the session
    // content before tab 1 sends, so the pub/sub subscription is active.
    const sessionId = SESSION_A.id;
    await page1.goto(`/chat/${sessionId}`);
    await expect(page1.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    await page2.goto(`/chat/${sessionId}`);
    await expect(page2.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Tab 1 sends a message — events stream to BOTH tabs
    await sendChatMessage(page1, "Hello from tab 1");

    // Tab 1 should see the response
    await expect(page1.locator("text=Live from tab A").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Tab 2 should ALSO see the response (real-time sync via shared pub/sub)
    await expect(page2.locator("text=Live from tab A").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    // Tab 2 should also see the user message from tab 1
    await expect(page2.locator("text=Hello from tab 1").first()).toBeVisible();

    await context.close();
  });
});

// ---------------------------------------------------------------------------
// 11. Gemini warning banner
// ---------------------------------------------------------------------------
test.describe("11. gemini warning banner", () => {
  test("shows warning in single mode when role needs gemini", async ({ page }) => {
    await mockAllApis(page);

    // Override roles to include one with generateImage
    await page.route(urlEndsWith("/api/roles"), (route) =>
      route.fulfill({
        json: [
          { id: "general", name: "General", icon: "star", prompt: "Help.", availablePlugins: [] },
          { id: "artist", name: "Artist", icon: "palette", prompt: "Create images.", availablePlugins: ["generateImage"] },
        ],
      }),
    );
    // Health: geminiAvailable = false
    await page.route(urlEndsWith("/api/health"), (route) => route.fulfill({ json: { status: "OK", geminiAvailable: false, sandboxEnabled: false } }));

    await page.goto("/");
    await expect(page.getByTestId("app-title")).toBeVisible();

    // Switch to artist role
    await switchRole(page, "artist");

    // Gemini warning should appear (single mode = sidebar warning)
    await expect(page.getByTestId("gemini-warning")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  });

  test("shows warning in stack mode when role needs gemini", async ({ page }) => {
    await mockAllApis(page);

    await page.route(urlEndsWith("/api/roles"), (route) =>
      route.fulfill({
        json: [
          { id: "general", name: "General", icon: "star", prompt: "Help.", availablePlugins: [] },
          { id: "artist", name: "Artist", icon: "palette", prompt: "Create.", availablePlugins: ["generateImage"] },
        ],
      }),
    );
    await page.route(urlEndsWith("/api/health"), (route) => route.fulfill({ json: { status: "OK", geminiAvailable: false, sandboxEnabled: false } }));

    await page.goto("/?view=stack");
    await switchRole(page, "artist");

    await expect(page.getByTestId("gemini-warning-stack")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  });
});

// ---------------------------------------------------------------------------
// 12. Background generation (pendingGenerations)
// ---------------------------------------------------------------------------
test.describe("12. background generation indicators", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("status message and pending tool call appear during agent run", async ({ page }) => {
    // Stream events with delays so the thinking indicator is visible
    // between the status event and session_finished.
    await page.routeWebSocket(
      (url) => url.pathname.startsWith("/ws/pubsub"),
      (webSocket) => {
        webSocket.send("0" + JSON.stringify({ sid: "mock-sid", upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1_000_000 }));
        webSocket.onMessage((msg) => {
          const text = String(msg);
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
          const channel = arg;
          const send = (data: unknown) => webSocket.send("42" + JSON.stringify(["data", { channel, data }]));
          // Stagger events so the UI has time to render intermediate state.
          // generation_started makes pendingGenerations non-empty which
          // sets the computed isRunning to true.
          void (async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            send({ type: "generation_started", kind: "image", filePath: "sunset.png", key: "gen-1" });
            await new Promise((resolve) => setTimeout(resolve, 50));
            send({ type: "status", message: "Generating image..." });
            await new Promise((resolve) => setTimeout(resolve, 100));
            send({ type: "tool_call", toolUseId: "tc-gen", toolName: "generateImage", args: { prompt: "sunset" } });
            // Hold the running state for 4 seconds before finishing
            await new Promise((resolve) => setTimeout(resolve, 4000));
            send({ type: "generation_finished", kind: "image", filePath: "sunset.png", key: "gen-1" });
            send({ type: "text", message: "Done generating" });
            send({ type: "session_finished" });
          })();
        });
      },
    );
    await page.route(urlEndsWith("/api/agent"), (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
    });

    await page.goto("/");
    await sendChatMessage(page, "generate an image");

    // Thinking indicator should appear while agent is running
    await expect(page.getByTestId("thinking-indicator")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    // Status message should show the generation status
    await expect(page.getByTestId("status-message")).toContainText("Generating image", { timeout: 5 * ONE_SECOND_MS });
    // Pending call should show the tool being run
    await expect(page.getByTestId("pending-call-tc-gen")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  });
});

// ---------------------------------------------------------------------------
// 13. API error handling
// ---------------------------------------------------------------------------
test.describe("13. API error handling", () => {
  test("network error shows Connection error card and unsubscribes", async ({ page }) => {
    await mockAllApis(page);

    // Override /api/agent to abort the request (simulate network failure)
    await page.route(urlEndsWith("/api/agent"), (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.abort("connectionrefused");
    });

    await page.goto("/");
    await sendChatMessage(page, "this should fail");

    // route.abort produces TypeError("Failed to fetch") which renders
    // as "[Error] Failed to fetch" via pushErrorMessage
    await expect(page.locator("text=[Error] Failed to fetch").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Input should be re-enabled (subscription unsubscribed, not stuck)
    await expect(chatInput(page)).toBeEnabled({ timeout: 3 * ONE_SECOND_MS });

    // Should be able to type again (session not stuck in running state)
    await chatInput(page).fill("can I type again?");
    await expect(chatInput(page)).toHaveValue("can I type again?");
  });

  test("HTTP 500 shows server error card", async ({ page }) => {
    await mockAllApis(page);

    await page.route(urlEndsWith("/api/agent"), (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "Internal Server Error",
      });
    });

    await page.goto("/");
    await sendChatMessage(page, "this should fail");

    // Should show "Server error 500" (the exact format from postAgentRun)
    await expect(page.locator("text=Server error 500").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Input should be re-enabled (not stuck)
    await expect(chatInput(page)).toBeEnabled({ timeout: 3 * ONE_SECOND_MS });
  });
});

// ---------------------------------------------------------------------------
// 14. Session not found
// ---------------------------------------------------------------------------
test.describe("14. session not found", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("non-existent session falls back to new session", async ({ page }) => {
    await page.goto("/chat/nonexistent-session-xyz");

    // Should redirect away from the non-existent session
    await expect(async () => {
      expect(page.url()).not.toContain("nonexistent-session-xyz");
    }).toPass({ timeout: 10 * ONE_SECOND_MS });

    // App title should still be visible (not crashed)
    await expect(page.getByTestId("app-title")).toBeVisible();
    // Input should be available for new session
    await expect(chatInput(page)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 15. Arrow key navigation
// ---------------------------------------------------------------------------
test.describe("15. arrow key navigation", () => {
  test("sidebar ArrowDown/ArrowUp changes selectedResultUuid and updates ?result= param", async ({ page }) => {
    await mockAllApis(page);

    // Provide a session with multiple results
    await page.route(
      (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
      (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({
          json: [
            { type: "session_meta", roleId: "general", sessionId: SESSION_A.id },
            { type: "text", source: "user", message: "First question" },
            { type: "text", source: "assistant", message: "First answer" },
            { type: "text", source: "user", message: "Second question" },
            { type: "text", source: "assistant", message: "Second answer" },
          ],
        });
      },
    );

    await page.goto(`/chat/${SESSION_A.id}`);
    await expect(page.locator("text=First question").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Click the FIRST result card to select it (the app auto-selects
    // the last result, so we need to start from the first to test ArrowDown)
    const resultCards = page.locator("[data-testid^='tool-result-']");
    await resultCards.nth(0).click();

    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("result")).toBeTruthy();
    }).toPass({ timeout: 3 * ONE_SECOND_MS });

    const firstResult = new URL(page.url()).searchParams.get("result")!;

    // Focus the sidebar results panel (sets activePane to "sidebar")
    const sidebar = page.getByTestId("tool-results-scroll");
    await sidebar.click();

    // Press ArrowDown — should move to the next result
    await page.keyboard.press("ArrowDown");
    await expect(async () => {
      const url = new URL(page.url());
      const newResult = url.searchParams.get("result");
      expect(newResult).toBeTruthy();
      expect(newResult).not.toBe(firstResult);
    }).toPass({ timeout: 3 * ONE_SECOND_MS });

    const secondResult = new URL(page.url()).searchParams.get("result")!;

    // Press ArrowUp — should go back to the first result
    await page.keyboard.press("ArrowUp");
    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("result")).toBe(firstResult);
    }).toPass({ timeout: 3 * ONE_SECOND_MS });

    // Verify the selected card has the visual ring
    const selectedCard = page.getByTestId(`tool-result-${firstResult}`);
    await expect(selectedCard).toHaveClass(/ring-2/);

    // The second card should NOT have the ring
    const otherCard = page.getByTestId(`tool-result-${secondResult}`);
    await expect(otherCard).not.toHaveClass(/ring-2/);
  });
});

// ---------------------------------------------------------------------------
// 16. History drawer
// ---------------------------------------------------------------------------
test.describe("16. history drawer", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("opens on button click, top aligns with top bar, and closes on click-outside", async ({ page }) => {
    await page.goto("/");

    // Open history
    await page.getByTestId("history-btn").click();
    const sessionItem = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(sessionItem).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // The drawer's `top` style should match the top bar's offsetHeight.
    // App.vue sets historyTopOffset = topBarRef.offsetHeight, and
    // SessionHistoryPanel applies it as inline style `top: Npx`.
    const historyPanel = sessionItem.locator("../..");
    const topBarHeight = await page
      .locator(".shrink-0.bg-white.text-gray-900")
      .first()
      .evaluate((element) => (element as HTMLElement).offsetHeight);
    const panelTop = await historyPanel.evaluate((element) => parseFloat(getComputedStyle(element).top));

    // Allow 1px rounding tolerance
    expect(Math.abs(panelTop - topBarHeight)).toBeLessThanOrEqual(1);

    // Close by clicking outside (app title)
    await page.getByTestId("app-title").click();
    await expect(sessionItem).toBeHidden({ timeout: 3 * ONE_SECOND_MS });
  });

  test("clicking session in history navigates and closes drawer", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("history-btn").click();
    const sessionItem = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(sessionItem).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    await sessionItem.click();

    // URL should update
    await expect(page).toHaveURL(new RegExp(SESSION_A.id), { timeout: 5 * ONE_SECOND_MS });
    // Drawer should close
    await expect(sessionItem).toBeHidden({ timeout: 3 * ONE_SECOND_MS });
  });

  test("session filter buttons filter the list", async ({ page }) => {
    // Override sessions with different origins
    await page.route(urlEndsWith("/api/sessions"), (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({
        json: {
          sessions: [
            { ...SESSION_A, origin: "bridge" },
            { ...SESSION_B }, // no origin = human
          ],
          cursor: "v1:0",
          deletedIds: [],
        },
      });
    });

    await page.goto("/");
    await page.getByTestId("history-btn").click();

    // Both should be visible initially
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();

    // Filter to bridge only
    await page.getByTestId("session-filter-bridge").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeHidden();

    // Filter to human only
    await page.getByTestId("session-filter-human").click();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeHidden();

    // Back to all
    await page.getByTestId("session-filter-all").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();
  });
});
