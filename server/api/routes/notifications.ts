// PoC push endpoint — proves the server can fire a delayed message
// simultaneously to every open Web tab (pub-sub) and every bridge
// (chat-service `pushToBridge`). Stepping stone for the in-app
// notification center (#144) and external-channel notifications
// (#142); see plans/feat-notification-push-scaffold.md for the
// motivation and the production plan.
//
// Usage:
//   curl -X POST http://localhost:3001/api/notifications/test \
//     -H "Authorization: Bearer $(cat ~/mulmoclaude/.session-token)" \
//     -H "Content-Type: application/json" \
//     -d '{"message":"hello","delaySeconds":5}'
//
// The route is exported as a factory so the host wiring can inject
// the pub-sub publisher and the chat-service push handle without
// this file pulling in either module directly.

import { Router, type Request, type Response } from "express";
import {
  scheduleTestNotification,
  type NotificationDeps,
  type ScheduleNotificationOptions,
} from "../../events/notifications.js";
import { log } from "../../system/logger/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

interface TestRequestBody {
  message?: unknown;
  delaySeconds?: unknown;
  transportId?: unknown;
  chatId?: unknown;
}

interface TestResponse {
  firesAt: string;
  delaySeconds: number;
}

function parseBody(body: TestRequestBody): ScheduleNotificationOptions {
  const opts: ScheduleNotificationOptions = {};
  if (typeof body.message === "string" && body.message.length > 0) {
    opts.message = body.message;
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
  return opts;
}

export function createNotificationsRouter(deps: NotificationDeps): Router {
  const router = Router();
  router.post(
    API_ROUTES.notifications.test,
    (
      req: Request<object, unknown, TestRequestBody>,
      res: Response<TestResponse>,
    ) => {
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
    },
  );
  return router;
}
