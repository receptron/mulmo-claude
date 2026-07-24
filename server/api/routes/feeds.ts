// Read-only HTTP route serving the /feeds UI: a list of registered feeds
// with their retrieval kind / schedule / last-fetch time.
//
// Feeds are CREATED and REMOVED by the agent writing / deleting
// `feeds/<slug>/schema.json` directly (see config/helps/feeds.md) — there
// is no manage tool. Retrieval runs on the hourly scheduler; per-feed
// manual refresh uses `POST /api/collections/:slug/refresh`.

import { Router, Request, Response } from "express";
import { workspacePath } from "../../workspace/workspace.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { listFeeds, readFeedState, removeFeed } from "@mulmoclaude/core/feeds/server";
import type { FeedsListResponse } from "@mulmoclaude/core/collection";
import { buildFeedSummaries } from "../../workspace/feeds/summaries.js";
import { errorMessage } from "../../utils/errors.js";
import { serverError } from "../../utils/httpError.js";
import { log } from "../../system/logger/index.js";

const router = Router();

router.get(API_ROUTES.feeds.list, async (_req: Request, res: Response<FeedsListResponse>) => {
  try {
    const feeds = await listFeeds(workspacePath);
    res.json({ feeds: await buildFeedSummaries(feeds, readFeedState, workspacePath) });
  } catch (err) {
    log.warn("feeds", "list failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

interface DeleteFeedResponse {
  removed: boolean;
}

// Remove a feed's registry entry (its records under dataPath are kept).
router.delete(API_ROUTES.feeds.detail, async (req: Request<{ slug: string }>, res: Response<DeleteFeedResponse>) => {
  try {
    const removed = await removeFeed(workspacePath, req.params.slug);
    if (removed) log.info("feeds", "feed deleted via UI", { slug: req.params.slug });
    res.json({ removed });
  } catch (err) {
    log.warn("feeds", "delete failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
