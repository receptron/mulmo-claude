// PoC push endpoint — proves the server can fire a delayed message
// simultaneously to every open Web tab (pub-sub) and every bridge
// (chat-service `pushToBridge`). Stepping stone for the in-app
// notification center (#144) and external-channel notifications
// (#142); see plans/done/feat-notification-push-scaffold.md for the
// motivation and the production plan.
//
// Usage (basic):
//   curl -X POST http://localhost:3001/api/notifications/test \
//     -H "Authorization: Bearer $(cat ~/mulmoclaude/.session-token)" \
//     -H "Content-Type: application/json" \
//     -d '{"message":"hello","delaySeconds":5}'
//
// Usage (with permalink action — #762):
//   curl -X POST http://localhost:3001/api/notifications/test \
//     -H "Authorization: Bearer $TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"message":"Scheduled task fired","kind":"scheduler",
//          "action":{"type":"navigate",
//                    "target":{"view":"automations",
//                              "taskId":"finance-daily-briefing"}}}'
//
// For a one-shot "fire one of every target kind" run,
// scripts/dev/fire-sample-notifications.sh drives this endpoint.
//
// The route is exported as a factory so the host wiring can inject
// the pub-sub publisher and the chat-service push handle without
// this file pulling in either module directly.

import { Router, type Request, type Response } from "express";
import { scheduleTestNotification, type NotificationDeps, type ScheduleNotificationOptions } from "../../events/notifications.js";
import { log } from "../../system/logger/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import {
  NOTIFICATION_ACTION_TYPES,
  NOTIFICATION_KINDS,
  NOTIFICATION_VIEWS,
  type NotificationAction,
  type NotificationKind,
} from "../../../src/types/notification.js";
import { isRecord } from "../../utils/types.js";

interface TestRequestBody {
  message?: unknown;
  body?: unknown;
  delaySeconds?: unknown;
  transportId?: unknown;
  chatId?: unknown;
  kind?: unknown;
  action?: unknown;
}

interface TestResponse {
  firesAt: string;
  delaySeconds: number;
}

const KIND_SET = new Set<string>(Object.values(NOTIFICATION_KINDS));
const VIEW_SET = new Set<string>(Object.values(NOTIFICATION_VIEWS));

function parseKind(value: unknown): NotificationKind | undefined {
  if (typeof value !== "string") return undefined;
  return KIND_SET.has(value) ? (value as NotificationKind) : undefined;
}

// Loose validator — dev-facing so we prefer "pass through what looks
// right" over strict type guards. Only checks that `type` is one of
// the two known literals and, for navigates, that `target.view` is a
// known view. The target's other fields are forwarded verbatim so
// adding new optional fields doesn't require editing this file.
function parseAction(value: unknown): NotificationAction | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === NOTIFICATION_ACTION_TYPES.none) {
    return { type: NOTIFICATION_ACTION_TYPES.none };
  }
  if (value.type !== NOTIFICATION_ACTION_TYPES.navigate) return undefined;
  const target = value.target;
  if (!isRecord(target) || typeof target.view !== "string" || !VIEW_SET.has(target.view)) {
    return undefined;
  }
  return { type: NOTIFICATION_ACTION_TYPES.navigate, target: target as NotificationAction extends { target: infer T } ? T : never };
}

function parseBody(body: TestRequestBody): ScheduleNotificationOptions {
  const opts: ScheduleNotificationOptions = {};
  if (typeof body.message === "string" && body.message.length > 0) {
    opts.message = body.message;
  }
  if (typeof body.body === "string" && body.body.length > 0) {
    opts.body = body.body;
  }
  if (typeof body.delaySeconds === "number") {
    opts.delaySeconds = body.delaySeconds;
  }
  if (typeof body.transportId === "string" && body.transportId.length > 0) {
    opts.transportId = body.transportId;
  }
  if (typeof body.chatId === "string" && body.chatId.length > 0) {
    opts.chatId = body.chatId;
  }
  const kind = parseKind(body.kind);
  if (kind) opts.kind = kind;
  const action = parseAction(body.action);
  if (action) opts.action = action;
  return opts;
}

export function createNotificationsRouter(deps: NotificationDeps): Router {
  const router = Router();
  router.post(API_ROUTES.notifications.test, (req: Request<object, unknown, TestRequestBody>, res: Response<TestResponse>) => {
    const opts = parseBody(req.body ?? {});
    const scheduled = scheduleTestNotification(opts, deps);
    log.info("notifications", "scheduled test push", {
      delaySeconds: scheduled.delaySeconds,
      firesAt: scheduled.firesAt,
      transportId: opts.transportId,
      chatId: opts.chatId,
    });
    res.status(202).json({
      firesAt: scheduled.firesAt,
      delaySeconds: scheduled.delaySeconds,
    });
  });
  return router;
}
