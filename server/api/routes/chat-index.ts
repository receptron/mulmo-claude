// Debug trigger endpoint for the chat indexer. The normal path is
// the agent `finally` hook in server/routes/agent.ts — one session
// at a time, with a 15-minute freshness throttle. This endpoint
// exists so the user can force-rebuild every session's summary on
// demand without restarting the server, which is useful for
// testing the feature against an existing workspace full of
// never-indexed sessions.
//
// Usage:
//   curl -X POST http://localhost:3000/api/chat-index/rebuild

import { Router, Request, Response } from "express";
import { backfillAllSessions } from "../../workspace/chat-index/index.js";
import { log } from "../../system/logger/index.js";
import { serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

interface RebuildResponse {
  total: number;
  indexed: number;
  skipped: number;
}

interface RebuildErrorResponse {
  error: string;
}

const router = Router();

router.post(API_ROUTES.chatIndex.rebuild, async (_req: Request, res: Response<RebuildResponse | RebuildErrorResponse>) => {
  try {
    log.info("chat-index", "manual rebuild triggered");
    const result = await backfillAllSessions();
    log.info("chat-index", "rebuild complete", {
      indexed: result.indexed,
      total: result.total,
      skipped: result.skipped,
    });
    res.json(result);
  } catch (err) {
    log.warn("chat-index", "rebuild failed", { error: String(err) });
    serverError(res, errorMessage(err, "unknown error"));
  }
});

export default router;
