import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveNotificationTarget } from "../../../src/utils/notification/dispatch.js";
import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_VIEWS, type NotificationAction } from "../../../src/types/notification.js";
import { PAGE_ROUTES } from "../../../src/router/pageRoutes.js";

function navigate(target: NotificationAction): NotificationAction {
  return target;
}

describe("resolveNotificationTarget — non-navigate actions", () => {
  it("returns null for 'none' action", () => {
    assert.equal(resolveNotificationTarget({ type: NOTIFICATION_ACTION_TYPES.none }), null);
  });
});

describe("resolveNotificationTarget — chat target", () => {
  it("routes to /chat/:sessionId with sessionId only", () => {
    const result = resolveNotificationTarget(
      navigate({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.chat, sessionId: "abc" },
      }),
    );
    assert.deepEqual(result, {
      name: PAGE_ROUTES.chat,
      params: { sessionId: "abc" },
      query: undefined,
    });
  });

  it("attaches ?result= query when resultUuid is set", () => {
    const result = resolveNotificationTarget(
      navigate({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.chat, sessionId: "abc", resultUuid: "uuid-xyz" },
      }),
    );
    assert.deepEqual(result, {
      name: PAGE_ROUTES.chat,
      params: { sessionId: "abc" },
      query: { result: "uuid-xyz" },
    });
  });

  it("returns null when sessionId is missing", () => {
    // Type surface forbids omitting sessionId, but runtime payloads
    // from the server might still arrive malformed — guard anyway.
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.chat, sessionId: "" },
    });
    assert.equal(result, null);
  });
});

describe("resolveNotificationTarget — identifier-carrying views", () => {
  it("todos without itemId lands on the board index", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.todos },
    });
    assert.deepEqual(result, { name: PAGE_ROUTES.todos, params: {} });
  });

  it("todos with itemId deep-links to the card", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.todos, itemId: "todo-42" },
    });
    assert.deepEqual(result, { name: PAGE_ROUTES.todos, params: { itemId: "todo-42" } });
  });

  it("automations with taskId deep-links to the task", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.automations, taskId: "daily-briefing" },
    });
    assert.deepEqual(result, { name: PAGE_ROUTES.automations, params: { taskId: "daily-briefing" } });
  });

  it("sources with slug deep-links to the feed", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.sources, slug: "federal-reserve" },
    });
    assert.deepEqual(result, { name: PAGE_ROUTES.sources, params: { slug: "federal-reserve" } });
  });

  it("calendar has no identifier surface", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.calendar },
    });
    assert.deepEqual(result, { name: PAGE_ROUTES.calendar });
  });
});

describe("resolveNotificationTarget — files catch-all", () => {
  it("splits path into pathMatch segments", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "sources/federal-reserve/2026-04-24.md" },
    });
    assert.deepEqual(result, {
      name: PAGE_ROUTES.files,
      params: { pathMatch: ["sources", "federal-reserve", "2026-04-24.md"] },
    });
  });

  it("missing path yields an empty pathMatch so /files is the target", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files },
    });
    assert.deepEqual(result, { name: PAGE_ROUTES.files, params: { pathMatch: [] } });
  });
});

describe("resolveNotificationTarget — wiki", () => {
  it("slug-only target routes to /wiki/pages/:slug", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, slug: "daily-finance-briefing-2026-04-24" },
    });
    assert.deepEqual(result, {
      name: PAGE_ROUTES.wiki,
      params: { section: "pages", slug: "daily-finance-briefing-2026-04-24" },
      hash: undefined,
    });
  });

  it("appends URL fragment when anchor is set", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: {
        view: NOTIFICATION_VIEWS.wiki,
        slug: "daily-finance-briefing-2026-04-24",
        anchor: "front-page",
      },
    });
    assert.deepEqual(result, {
      name: PAGE_ROUTES.wiki,
      params: { section: "pages", slug: "daily-finance-briefing-2026-04-24" },
      hash: "#front-page",
    });
  });

  it("no slug or anchor lands on /wiki index", () => {
    const result = resolveNotificationTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki },
    });
    assert.deepEqual(result, { name: PAGE_ROUTES.wiki, params: {}, hash: undefined });
  });
});
