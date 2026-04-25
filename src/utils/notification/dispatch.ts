// Pure mapping from NotificationAction → a router.push payload.
//
// The caller (App.vue#handleNotificationNavigate) performs the
// actual navigation; keeping this pure means it's directly
// unit-testable without mounting a Vue router.

import type { RouteLocationRaw } from "vue-router";
import { PAGE_ROUTES } from "../../router/pageRoutes";
import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_VIEWS, type NotificationAction, type NotificationTarget } from "../../types/notification";

export type NotificationRoute = RouteLocationRaw | null;

/** Determine what the user should see after clicking a notification.
 *  Returns a `router.push`-ready payload, or null when the action
 *  isn't a navigation (or when a `chat` action lacks the required
 *  sessionId — dropping those is safer than pushing a nameless
 *  route and bouncing off the catch-all redirect). */
export function resolveNotificationTarget(action: NotificationAction): NotificationRoute {
  if (action.type !== NOTIFICATION_ACTION_TYPES.navigate) return null;
  return routeForTarget(action.target);
}

function routeForTarget(target: NotificationTarget): NotificationRoute {
  switch (target.view) {
    case NOTIFICATION_VIEWS.chat:
      if (!target.sessionId) return null;
      return {
        name: PAGE_ROUTES.chat,
        params: { sessionId: target.sessionId },
        query: target.resultUuid ? { result: target.resultUuid } : undefined,
      };
    case NOTIFICATION_VIEWS.todos:
      return { name: PAGE_ROUTES.todos, params: target.itemId ? { itemId: target.itemId } : {} };
    case NOTIFICATION_VIEWS.calendar:
      return { name: PAGE_ROUTES.calendar };
    case NOTIFICATION_VIEWS.automations:
      return { name: PAGE_ROUTES.automations, params: target.taskId ? { taskId: target.taskId } : {} };
    case NOTIFICATION_VIEWS.sources:
      return { name: PAGE_ROUTES.sources, params: target.slug ? { slug: target.slug } : {} };
    case NOTIFICATION_VIEWS.files:
      // Files uses a catch-all (`/files/:pathMatch(.*)`) so the path
      // segments go in as an array — matches how App.vue pushes file
      // links elsewhere. An empty path lands on /files (no file
      // selected) rather than 404ing against a missing segment.
      return { name: PAGE_ROUTES.files, params: { pathMatch: target.path ? target.path.split("/") : [] } };
    case NOTIFICATION_VIEWS.wiki:
      return buildWikiRoute(target);
  }
}

function buildWikiRoute(target: { slug?: string; anchor?: string }): NotificationRoute {
  const params = target.slug ? { section: "pages" as const, slug: target.slug } : {};
  // Wiki headings route via the standard URL-fragment — vue-router
  // surfaces it on the location object as `hash` and the browser
  // handles the scroll natively. Keep the leading `#`.
  const hash = target.anchor ? `#${target.anchor}` : undefined;
  return { name: PAGE_ROUTES.wiki, params, hash };
}
