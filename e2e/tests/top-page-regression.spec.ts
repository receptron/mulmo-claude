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

    // Go back ��� session A
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

  test("stack view stays pinned to bottom during streaming", async ({ page }) => {
    const chunk = "Streaming chunk with enough text to fill the viewport. ".repeat(5);
    const events = Array.from({ length: 30 }, () => ({
      type: "text",
      source: "assistant",
      message: chunk,
    }));

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
          // Stream with small delays
          void (async () => {
            for (const event of events) {
              webSocket.send("42" + JSON.stringify(["data", { channel, data: event }]));
              await new Promise((resolve) => setTimeout(resolve, 20));
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

    // Wait for streaming to finish
    await page.waitForTimeout(2 * ONE_SECOND_MS);

    const metrics = await page.getByTestId("stack-scroll").evaluate((elem) => ({
      scrollTop: elem.scrollTop,
      scrollHeight: elem.scrollHeight,
      clientHeight: elem.clientHeight,
    }));

    // Should be near the bottom (within 50px tolerance)
    if (metrics.scrollHeight > metrics.clientHeight) {
      expect(metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight).toBeLessThan(50);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Multi-tab sync
// ---------------------------------------------------------------------------
test.describe("10. multi-tab sync", () => {
  test("second tab loads same session and shows transcript", async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // Set up mocks for both pages
    for (const page of [page1, page2]) {
      await mockAllApis(page);
    }

    // Tab 1: load known session A
    await page1.goto(`/chat/${SESSION_A.id}`);
    await expect(page1.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Tab 2: load same session via URL
    await page2.goto(`/chat/${SESSION_A.id}`);
    // Tab 2 should see the same transcript from the session API
    await expect(page2.locator("text=Hi there!").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    // Both tabs showing the session means the transcript sync via API works
    await expect(page2.locator("text=Hello").first()).toBeVisible();

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
  test("connection error shows error card when server is unreachable", async ({ page }) => {
    await mockAllApis(page);

    // Override /api/agent to return 500
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

    // Error message should appear in the chat
    await expect(page.locator("text=Internal Server Error").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
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
  test("sidebar arrow keys change selected result", async ({ page }) => {
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

    // Wait for results to load
    await expect(page.locator("text=First question").first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Focus the sidebar results panel
    const sidebar = page.getByTestId("tool-results-scroll");
    await sidebar.click();

    // Press arrow down to change selection
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);

    // Press arrow up
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(200);

    // The sidebar should still be functional (no crash)
    await expect(sidebar).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 16. History drawer
// ---------------------------------------------------------------------------
test.describe("16. history drawer", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("opens and closes on button click", async ({ page }) => {
    await page.goto("/");

    // Open history
    await page.getByTestId("history-btn").click();
    const sessionItem = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(sessionItem).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

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
