import { Router, Request, Response } from "express";
import { readManifest } from "../chat-index/indexer.js";
import {
  scoreEntries,
  type ChatHistorySearchResult,
} from "../chat-index/search.js";

const router = Router();

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

interface SearchBody {
  query?: string;
  limit?: number;
}

interface SearchResponse {
  query: string;
  results: ChatHistorySearchResult[];
  message: string;
  instructions: string;
}

interface ErrorResponse {
  error: string;
}

router.post(
  "/chat-history/search",
  async (
    req: Request<object, unknown, SearchBody>,
    res: Response<SearchResponse | ErrorResponse>,
  ) => {
    const query = typeof req.body.query === "string" ? req.body.query : "";
    if (!query.trim()) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    const requested =
      typeof req.body.limit === "number" ? req.body.limit : DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(requested, MAX_LIMIT));

    const manifest = await readManifest();
    const allResults = scoreEntries(manifest.entries, query);
    const results = allResults.slice(0, limit);

    res.json({
      query,
      results,
      message:
        results.length === 0
          ? `No past sessions matched "${query}".`
          : `Found ${results.length} session(s) matching "${query}".`,
      instructions:
        "Show the matching sessions to the user. The user can click any result to open it. Do not browse the chat/ directory directly.",
    });
  },
);

export default router;
