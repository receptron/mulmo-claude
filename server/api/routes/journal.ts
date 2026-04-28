// Journal HTTP routes — surfaces journal artefacts to the client.
//
// Currently exposes one endpoint:
//   GET /api/journal/latest-daily
//     → { path, isoDate } | null
//
// Backs the top-bar "today's journal" shortcut (#876). Returning
// `null` is the no-journal-yet signal — fresh installs, or workspaces
// where the daily pass hasn't found dirty sessions yet.

import { Router, type Request, type Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { workspacePath } from "../../workspace/paths.js";
import { findLatestDaily, type LatestDailyResult } from "../../workspace/journal/latestDaily.js";
import { log } from "../../system/logger/index.js";

export interface JournalRouteDeps {
  /** Override for tests — defaults to the live workspace root. */
  workspaceRoot?: string;
}

export function createJournalRouter(deps: JournalRouteDeps = {}): Router {
  const router = Router();
  const root = deps.workspaceRoot ?? workspacePath;
  router.get(API_ROUTES.journal.latestDaily, async (_req: Request, res: Response<LatestDailyResult | null>) => {
    try {
      const result = await findLatestDaily(root);
      res.json(result);
    } catch (err) {
      log.error("journal-route", "findLatestDaily failed", { error: String(err) });
      res.status(500).json(null);
    }
  });
  return router;
}
