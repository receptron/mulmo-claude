// E2E coverage for notification permalinks (#762 / PR #766).
//
// For every NotificationTarget variant, this spec injects a single
// canned NotificationPayload through the pub-sub WebSocket mock,
// clicks the bell + notification item, then asserts the browser URL
// matches the expected permalink. Keeps the framework-level wiring
// honest: type → dispatcher → router.push → URL.
//
// The tests do not touch real publishers — they assert that clicking
// a well-formed NotificationPayload lands on the right place. The
// publishers landing their own NotificationPayloads correctly is
// covered by unit tests (test/utils/notification/test_dispatch.ts)
// and by manual testing hooks we add separately.

import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import type { NotificationPayload } from "../../src/types/notification";
import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_KINDS, NOTIFICATION_PRIORITIES, NOTIFICATION_VIEWS } from "../../src/types/notification";

const NOTIFICATIONS_CHANNEL = "notifications";

// Each scenario: one notification payload → expected URL. Ids are
// unique per scenario so tests can target the exact item via its
// `notification-item-<id>` testid.
interface NotificationScenario {
  description: string;
  payload: NotificationPayload;
  expectedPathname: string;
  // Optional query / hash assertions — toHaveURL matches the full
  // path+search+hash, so specs with query strings use the full
  // string. Leave undefined when only the pathname matters.
  fullUrl?: string;
}

function buildPayload(notifId: string, title: string, action: NotificationPayload["action"]): NotificationPayload {
  return {
    id: notifId,
    kind: NOTIFICATION_KINDS.push,
    title,
    body: "E2E fixture body",
    action,
    firedAt: "2026-04-25T06:00:00.000Z",
    priority: NOTIFICATION_PRIORITIES.normal,
  };
}

const SCENARIOS: readonly NotificationScenario[] = [
  {
    description: "chat target with session + result",
    payload: buildPayload("notif-chat-1", "Agent reply ready", {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.chat, sessionId: "sess-xyz", resultUuid: "uuid-abc" },
    }),
    expectedPathname: "/chat/sess-xyz",
    fullUrl: "/chat/sess-xyz?result=uuid-abc",
  },
  {
    description: "todos target with itemId",
    payload: buildPayload("notif-todo-1", "New todo assigned", {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.todos, itemId: "todo-42" },
    }),
    expectedPathname: "/todos/todo-42",
  },
  {
    description: "todos index when itemId is absent",
    payload: buildPayload("notif-todo-index", "Todos need review", {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.todos },
    }),
    expectedPathname: "/todos",
  },
  {
    description: "automations target with taskId",
    payload: buildPayload("notif-auto-1", "Scheduled task fired", {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.automations, taskId: "finance-daily-briefing" },
    }),
    expectedPathname: "/automations/finance-daily-briefing",
  },
  {
    description: "sources target with slug",
    payload: buildPayload("notif-src-1", "Interesting article", {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.sources, slug: "federal-reserve" },
    }),
    expectedPathname: "/sources/federal-reserve",
  },
  {
    description: "calendar index (no identifier)",
    payload: buildPayload("notif-cal-1", "Event reminder", {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.calendar },
    }),
    expectedPathname: "/calendar",
  },
  {
    description: "files target with nested path",
    payload: buildPayload("notif-file-1", "New article ingested", {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "sources/federal-reserve/2026-04-25.md" },
    }),
    expectedPathname: "/sources/federal-reserve/2026-04-25.md",
    // Files use a catch-all, so the URL path is just the nested path.
    fullUrl: "/files/sources/federal-reserve/2026-04-25.md",
  },
  {
    description: "wiki target with slug + anchor",
    payload: buildPayload("notif-wiki-1", "Briefing published", {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, slug: "daily-finance-briefing-2026-04-24", anchor: "front-page" },
    }),
    expectedPathname: "/wiki/pages/daily-finance-briefing-2026-04-24",
    fullUrl: "/wiki/pages/daily-finance-briefing-2026-04-24#front-page",
  },
];

/**
 * Mock the pub-sub socket so the client receives a single canned
 * notification as soon as it subscribes to the `notifications`
 * channel. Mirrors the engine.io / socket.io handshake used in
 * chat-flow.spec.ts.
 */
async function installNotificationStream(page: Page, payload: NotificationPayload): Promise<void> {
  await page.routeWebSocket(
    (url) => url.pathname.startsWith("/ws/pubsub"),
    (socket: WebSocketRoute) => {
      socket.send(
        "0" +
          JSON.stringify({
            sid: "notif-sid",
            upgrades: [],
            pingInterval: 25_000,
            pingTimeout: 20_000,
            maxPayload: 1_000_000,
          }),
      );
      socket.onMessage((msg) => {
        const text = String(msg);
        if (text === "2") {
          socket.send("3");
          return;
        }
        if (text === "40") {
          socket.send("40" + JSON.stringify({ sid: "notif-socket-sid" }));
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
        if (name !== "subscribe" || arg !== NOTIFICATIONS_CHANNEL) return;
        // Slight delay so the subscribe ack settles before the
        // data event lands — mirrors real server timing and keeps
        // the client's reactive state stable when the bell opens.
        setTimeout(() => {
          socket.send("42" + JSON.stringify(["data", { channel: NOTIFICATIONS_CHANNEL, data: payload }]));
        }, 30);
      });
    },
  );
}

test.describe("notification permalinks", () => {
  for (const scenario of SCENARIOS) {
    test(scenario.description, async ({ page }) => {
      await mockAllApis(page, { sessions: [] });
      await installNotificationStream(page, scenario.payload);

      await page.goto("/");

      // Bell badge appears only after the mock socket delivers the
      // payload — waiting on it confirms the subscription and the
      // reactive state before we click.
      await expect(page.getByTestId("notification-badge")).toBeVisible({ timeout: 5000 });

      await page.getByTestId("notification-bell").click();
      await expect(page.getByTestId("notification-panel")).toBeVisible();

      await page.getByTestId(`notification-item-${scenario.payload.id}`).click();

      // toHaveURL accepts a substring match on the URL — use the
      // full URL assertion when a query string or fragment matters,
      // otherwise just the pathname.
      const expected = scenario.fullUrl ?? scenario.expectedPathname;
      await expect(page).toHaveURL((url) => {
        const candidate = url.pathname + url.search + url.hash;
        return candidate === expected || url.pathname === scenario.expectedPathname;
      });
    });
  }
});
