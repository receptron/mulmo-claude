// HTTP routes for the news viewer (#761).
//
//   GET /api/news/items?days=N        — recent items, sorted desc
//   GET /api/news/items/:id/body      — body markdown from per-source archive
//   GET /api/news/read-state          — { readIds: string[] }
//   PUT /api/news/read-state          — { readIds: string[] }
//
// The reader walks daily JSON indexes on demand (see
// `server/workspace/news/reader.ts`); no separate index is
// maintained — see issue #761 for the design rationale (covers ~30
// days, follow-up ticket for full history).

import path from "node:path";
import { Router, type Request, type Response } from "express";
import { workspacePath } from "../../workspace/workspace.js";
import { aggregateRecentItems, loadItemBody, type NewsItem } from "../../workspace/news/reader.js";
import { loadJsonFile, writeJsonAtomic } from "../../utils/files/json.js";
import { WORKSPACE_FILES } from "../../../src/config/workspacePaths.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { isRecord } from "../../utils/types.js";
import { log } from "../../system/logger/index.js";

// Window upper bound — keeps memory bounded if a caller passes
// a comically large `days`. Daily JSON aggregation is O(days * items)
// in the worst case.
const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;

// Cap the read-state list size. UUID-shaped ids are ~16 bytes each;
// 10k of them is < 200 KB, fine. Beyond that we evict from the front
// (oldest mark-as-read first) so the working set stays small.
const MAX_READ_IDS = 10_000;

interface ReadState {
  readIds: string[];
}

const router = Router();

// ── /api/news/items ─────────────────────────────────────────────

router.get(API_ROUTES.news.items, async (req: Request, res: Response<{ items: NewsItem[] } | { error: string }>) => {
  const days = parseDays(req.query.days);
  if (days === null) {
    badRequest(res, "invalid `days` query parameter");
    return;
  }
  try {
    const items = await aggregateRecentItems(workspacePath, days);
    res.json({ items });
  } catch (err) {
    log.error("news", "aggregate failed", { error: errorMessage(err) });
    serverError(res, "failed to load news items");
  }
});

function parseDays(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_DAYS;
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return Math.min(value, MAX_DAYS);
}

// ── /api/news/items/:id/body ─────────────────────────────────────
//
// Body lookup needs the item's `sourceSlug` + `publishedAt` to
// pick the right archive file. We re-aggregate on demand (cheap;
// could be cached later if it shows up in a hot path). The
// frontend has the metadata already, but routing it through query
// params would let an attacker fabricate paths — so we resolve from
// the trusted in-memory aggregate keyed by `id` here.

router.get(API_ROUTES.news.itemBody, async (req: Request<{ id: string }>, res: Response<{ body: string | null } | { error: string }>) => {
  const { id } = req.params;
  if (!id) {
    badRequest(res, "missing item id");
    return;
  }
  try {
    const items = await aggregateRecentItems(workspacePath, MAX_DAYS);
    const match = items.find((entry) => entry.id === id);
    if (!match) {
      res.json({ body: null });
      return;
    }
    const body = await loadItemBody(workspacePath, match.sourceSlug, match.url, match.publishedAt);
    res.json({ body });
  } catch (err) {
    log.error("news", "body lookup failed", { error: errorMessage(err) });
    serverError(res, "failed to load item body");
  }
});

// ── /api/news/read-state ─────────────────────────────────────────

const readStateAbsPath = (): string => path.join(workspacePath, WORKSPACE_FILES.newsReadState);

router.get(API_ROUTES.news.readState, (_req: Request, res: Response<ReadState | { error: string }>) => {
  try {
    const data = loadJsonFile<ReadState>(readStateAbsPath(), { readIds: [] });
    const sanitized = sanitizeReadState(data);
    res.json(sanitized);
  } catch (err) {
    log.error("news", "read-state load failed", {
      error: errorMessage(err),
    });
    serverError(res, "failed to load news read-state");
  }
});

router.put(API_ROUTES.news.readState, async (req: Request, res: Response<ReadState | { error: string }>) => {
  const body = req.body;
  if (!isRecord(body) || !Array.isArray(body.readIds)) {
    badRequest(res, "expected { readIds: string[] }");
    return;
  }
  const sanitized = sanitizeReadState({ readIds: body.readIds });
  try {
    await writeJsonAtomic(readStateAbsPath(), sanitized);
    res.json(sanitized);
  } catch (err) {
    log.error("news", "read-state save failed", {
      error: errorMessage(err),
    });
    serverError(res, "failed to save news read-state");
  }
});

// Drop non-string entries, dedupe, cap at MAX_READ_IDS (keeping the
// most recent — i.e. tail end — of the list). Pure for testability.
export function sanitizeReadState(input: { readIds: unknown[] }): ReadState {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of input.readIds) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  if (ordered.length <= MAX_READ_IDS) return { readIds: ordered };
  return { readIds: ordered.slice(ordered.length - MAX_READ_IDS) };
}

export default router;
