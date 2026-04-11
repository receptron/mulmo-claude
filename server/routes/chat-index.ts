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
import { backfillAllSessions } from "../chat-index/index.js";

interface RebuildResponse {
  total: number;
  indexed: number;
  skipped: number;
}

interface RebuildErrorResponse {
  error: string;
}

const router = Router();

router.post(
  "/chat-index/rebuild",
  async (
    _req: Request,
    res: Response<RebuildResponse | RebuildErrorResponse>,
  ) => {
    try {
      // eslint-disable-next-line no-console
      console.log("[chat-index] manual rebuild triggered");
      const result = await backfillAllSessions();
      // eslint-disable-next-line no-console
      console.log(
        `[chat-index] rebuild complete: ${result.indexed}/${result.total} indexed, ${result.skipped} skipped`,
      );
      res.json(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[chat-index] rebuild failed:", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  },
);

export default router;
