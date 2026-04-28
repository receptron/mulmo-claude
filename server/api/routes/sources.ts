// HTTP routes for the source registry.
//
//   GET    /api/sources              — list all registered sources
//   POST   /api/sources              — register a new source; auto-classify
//   DELETE /api/sources/:slug        — remove a source + its runtime state
//   POST   /api/sources/rebuild      — run the daily pipeline manually
//
// Follow-up commits will add per-source `fetch` and `recategorize`
// actions. Everything here goes through the same
// validation-at-boundary discipline as the other routes so a
// malformed body never reaches the registry files.

import { createHash } from "node:crypto";
import { Router, Request, Response } from "express";
import { workspacePath } from "../../workspace/workspace.js";
import { log } from "../../system/logger/index.js";
import { deleteSource, listSources, readSource, writeSource } from "../../workspace/sources/registry.js";
import { deleteSourceState } from "../../workspace/sources/sourceState.js";
import { classifySource } from "../../workspace/sources/classifier.js";
import { runSourcesPipeline } from "../../workspace/sources/pipeline/index.js";
import { defaultHttpFetcherDeps, type RobotsProvider } from "../../workspace/sources/httpFetcher.js";
import { isValidSlug, slugify } from "../../utils/slug.js";
import {
  FETCHER_KINDS,
  SOURCE_SCHEDULES,
  defaultSourceState,
  isFetcherKind,
  isSourceSchedule,
  type Source,
  type SourceSchedule,
  type FetcherKind,
  type FetcherParams,
} from "../../workspace/sources/types.js";
import { normalizeCategories, type CategorySlug } from "../../workspace/sources/taxonomy.js";
import { badRequest, conflict, sendError, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { isNonEmptyString, isRecord } from "../../utils/types.js";

const router = Router();

// Temporary no-op robots provider — the real implementation that
// reads `workspace/sources/_state/robots/<host>.txt` with 24h TTL
// lands in a follow-up PR. Phase-1 safe because the manageSource
// route only hits well-known public endpoints (GitHub / arXiv /
// RSS feeds the user explicitly registers).
const NO_ROBOTS: RobotsProvider = async () => null;

// --- GET /api/sources ---------------------------------------------------

interface ListSourcesResponse {
  sources: Source[];
}
interface ErrorResponse {
  error: string;
}

router.get(API_ROUTES.sources.list, async (_req: Request, res: Response<ListSourcesResponse | ErrorResponse>) => {
  try {
    const sources = await listSources(workspacePath);
    res.json({ sources });
  } catch (err) {
    log.warn("sources", "list failed", { error: String(err) });
    serverError(res, errorMessage(err, "unknown error"));
  }
});

// --- POST /api/sources --------------------------------------------------

interface RegisterSourceBody {
  title?: unknown;
  url?: unknown;
  fetcherKind?: unknown;
  fetcherParams?: unknown;
  schedule?: unknown;
  slug?: unknown;
  categories?: unknown;
  notes?: unknown;
  maxItemsPerFetch?: unknown;
  // Pass `true` to skip the auto-classifier call (useful when the
  // client already knows which categories they want, or for
  // testing without the `claude` CLI installed).
  skipClassify?: unknown;
}

interface RegisterSourceResponse {
  source: Source;
  classifyRationale?: string;
}

router.post(API_ROUTES.sources.create, async (req: Request<object, unknown, RegisterSourceBody>, res: Response<RegisterSourceResponse | ErrorResponse>) => {
  const parsed = parseRegisterBody(req.body ?? {});
  if ("error" in parsed) {
    sendError(res, parsed.status, parsed.error);
    return;
  }
  const existing = await readSource(workspacePath, parsed.slug);
  if (existing) {
    conflict(res, `source "${parsed.slug}" already exists`);
    return;
  }
  const { categories, rationale } = await resolveCategories(parsed);
  const source: Source = {
    slug: parsed.slug,
    title: parsed.title,
    url: parsed.url,
    fetcherKind: parsed.fetcherKind,
    fetcherParams: parsed.fetcherParams,
    schedule: parsed.schedule,
    categories,
    maxItemsPerFetch: parsed.maxItemsPerFetch,
    addedAt: new Date().toISOString(),
    notes: parsed.notes,
  };
  try {
    await writeSource(workspacePath, source);
  } catch (err) {
    serverError(res, errorMessage(err, "failed to write source"));
    return;
  }
  log.info("sources", "source registered", {
    slug: parsed.slug,
    fetcherKind: parsed.fetcherKind,
  });
  res.status(201).json({
    source,
    ...(rationale !== undefined && { classifyRationale: rationale }),
  });
});

// --- DELETE /api/sources/:slug ------------------------------------------

interface DeleteSourceParams {
  slug: string;
}

interface DeleteSourceResponse {
  removed: boolean;
  stateRemoved: boolean;
}

router.delete(API_ROUTES.sources.remove, async (req: Request<DeleteSourceParams>, res: Response<DeleteSourceResponse | ErrorResponse>) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    badRequest(res, "invalid slug");
    return;
  }
  const removed = await deleteSource(workspacePath, slug);
  const stateRemoved = await deleteSourceState(workspacePath, slug);
  if (removed) {
    log.info("sources", "source deleted", { slug });
  }
  res.json({ removed, stateRemoved });
});

// --- POST /api/sources/rebuild ------------------------------------------

interface RebuildBody {
  scheduleType?: unknown;
}

router.post(API_ROUTES.sources.rebuild, async (req: Request<object, unknown, RebuildBody>, res: Response<ErrorResponse | Record<string, unknown>>) => {
  const scheduleType = validateSchedule(req.body?.scheduleType, "daily");
  if (!scheduleType) {
    badRequest(res, `scheduleType must be one of: ${[...SOURCE_SCHEDULES].join(", ")}`);
    return;
  }
  try {
    log.info("sources", "manual rebuild triggered", { scheduleType });
    const result = await runSourcesPipeline({
      workspaceRoot: workspacePath,
      scheduleType,
      fetcherDeps: {
        http: defaultHttpFetcherDeps(NO_ROBOTS),
        now: () => Date.now(),
      },
      nowMs: () => Date.now(),
    });
    log.info("sources", "rebuild complete", {
      plannedCount: result.plannedCount,
      itemCount: result.items.length,
      duplicateCount: result.dedup.duplicateCount,
      archiveErrors: result.archiveErrors.length,
    });
    res.json({
      plannedCount: result.plannedCount,
      itemCount: result.items.length,
      duplicateCount: result.dedup.duplicateCount,
      dailyPath: result.dailyPath,
      archiveWrittenPaths: result.archiveWrittenPaths,
      archiveErrors: result.archiveErrors,
      isoDate: result.isoDate,
    });
  } catch (err) {
    log.warn("sources", "rebuild failed", { error: String(err) });
    serverError(res, errorMessage(err, "rebuild failed"));
  }
});

// --- POST /api/sources/manage -------------------------------------------
//
// MCP-friendly single-endpoint wrapper for the manageSource plugin.
// Every action returns { data: { sources, ... } } so the canvas
// View can re-render without a separate list call. Unlike the
// REST surface above, this endpoint never throws on validation —
// errors come back as 400/500 with { error } and the LLM gets a
// human-readable error to relay.

interface ManageSourceBody {
  action?: unknown;
  slug?: unknown;
  title?: unknown;
  url?: unknown;
  fetcherKind?: unknown;
  fetcherParams?: unknown;
  schedule?: unknown;
  categories?: unknown;
  notes?: unknown;
}

interface ManageSourceData {
  sources: Source[];
  highlightSlug?: string;
  classifyRationale?: string;
  lastRebuild?: {
    plannedCount: number;
    itemCount: number;
    duplicateCount: number;
    archiveErrors: string[];
    isoDate: string;
  };
}

interface ManageSourceSuccess {
  message: string;
  instructions: string;
  data: ManageSourceData;
}

const MANAGE_ACTIONS = new Set(["list", "register", "remove", "rebuild"]);

router.post(API_ROUTES.sources.manage, async (req: Request<object, unknown, ManageSourceBody>, res: Response<ManageSourceSuccess | ErrorResponse>) => {
  const action = req.body?.action;
  if (typeof action !== "string" || !MANAGE_ACTIONS.has(action)) {
    badRequest(res, `action must be one of: ${[...MANAGE_ACTIONS].join(", ")}`);
    return;
  }
  try {
    switch (action) {
      case "list":
        await respondWithList(res, "Loaded source registry.");
        return;
      case "register":
        await handleRegister(req.body, res);
        return;
      case "remove":
        await handleRemove(req.body, res);
        return;
      case "rebuild":
        await handleRebuild(res);
    }
  } catch (err) {
    log.warn("sources", "manage failed", { action, error: String(err) });
    serverError(res, errorMessage(err, "manage failed"));
  }
});

async function respondWithList(res: Response<ManageSourceSuccess | ErrorResponse>, message: string, extra: Partial<ManageSourceData> = {}): Promise<void> {
  const sources = await listSources(workspacePath);
  res.json({
    message,
    instructions: "The current information-source registry is now displayed in the canvas.",
    data: { sources, ...extra },
  });
}

async function handleRegister(body: ManageSourceBody, res: Response<ManageSourceSuccess | ErrorResponse>): Promise<void> {
  const parsed = parseRegisterBody(body as RegisterSourceBody);
  if ("error" in parsed) {
    sendError(res, parsed.status, parsed.error);
    return;
  }
  const existing = await readSource(workspacePath, parsed.slug);
  if (existing) {
    conflict(res, `source "${parsed.slug}" already exists`);
    return;
  }
  const { categories, rationale } = await resolveCategories(parsed);
  const source: Source = {
    slug: parsed.slug,
    title: parsed.title,
    url: parsed.url,
    fetcherKind: parsed.fetcherKind,
    fetcherParams: parsed.fetcherParams,
    schedule: parsed.schedule,
    categories,
    maxItemsPerFetch: parsed.maxItemsPerFetch,
    addedAt: new Date().toISOString(),
    notes: parsed.notes,
  };
  await writeSource(workspacePath, source);
  log.info("sources", "source registered (manage)", {
    slug: parsed.slug,
    fetcherKind: parsed.fetcherKind,
  });
  await respondWithList(res, `Registered source "${parsed.slug}".`, {
    highlightSlug: parsed.slug,
    ...(rationale !== undefined && { classifyRationale: rationale }),
  });
}

async function handleRemove(body: ManageSourceBody, res: Response<ManageSourceSuccess | ErrorResponse>): Promise<void> {
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!isValidSlug(slug)) {
    badRequest(res, "slug is required and must be a valid slug");
    return;
  }
  const removed = await deleteSource(workspacePath, slug);
  await deleteSourceState(workspacePath, slug);
  if (removed) {
    log.info("sources", "source deleted (manage)", { slug });
  }
  await respondWithList(res, removed ? `Removed source "${slug}".` : `No source "${slug}" was registered (nothing to remove).`);
}

async function handleRebuild(res: Response<ManageSourceSuccess | ErrorResponse>): Promise<void> {
  log.info("sources", "manual rebuild triggered (manage)");
  const result = await runSourcesPipeline({
    workspaceRoot: workspacePath,
    scheduleType: "daily",
    fetcherDeps: {
      http: defaultHttpFetcherDeps(NO_ROBOTS),
      now: () => Date.now(),
    },
    nowMs: () => Date.now(),
  });
  log.info("sources", "rebuild complete (manage)", {
    plannedCount: result.plannedCount,
    itemCount: result.items.length,
    duplicateCount: result.dedup.duplicateCount,
    archiveErrors: result.archiveErrors.length,
  });
  await respondWithList(res, `Rebuild complete: ${result.items.length} items from ${result.plannedCount} sources.`, {
    lastRebuild: {
      plannedCount: result.plannedCount,
      itemCount: result.items.length,
      duplicateCount: result.dedup.duplicateCount,
      archiveErrors: result.archiveErrors,
      isoDate: result.isoDate,
    },
  });
}

// --- helpers ------------------------------------------------------------

// Parse + validate a fetcherKind body field. Returns null when
// invalid; defaults when absent. Exported for tests so a future
// stricter validator lands under this name.
export function validateFetcherKind(raw: unknown, defaultKind: FetcherKind): FetcherKind | null {
  if (raw === undefined) return defaultKind;
  if (isFetcherKind(raw)) return raw;
  return null;
}

export function validateSchedule(raw: unknown, defaultSchedule: SourceSchedule): SourceSchedule | null {
  if (raw === undefined) return defaultSchedule;
  if (isSourceSchedule(raw)) return raw;
  return null;
}

// Validate `fetcherParams` body. Expects a flat object of
// string values. Returns null when the shape is wrong (caller
// surfaces as 400). Returns empty object when the field is
// missing entirely.
export function validateFetcherParams(raw: unknown): FetcherParams | null {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    return null;
  }
  const out: FetcherParams = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") return null;
    out[key] = value;
  }
  return out;
}

// Resolve the slug for a new source. Prefers a caller-supplied
// slug when valid; otherwise derives from the title. Deterministic
// for the same title so re-registering without an explicit slug
// produces a predictable filename.
//
// If the title contains no ASCII letters / digits at all (e.g.
// pure CJK), fall back to a hash-based fallback — keeps non-
// English sources registrable even when they can't produce an
// ASCII-meaningful slug.
export function resolveSlug(rawSlug: unknown, title: string): string | null {
  if (isNonEmptyString(rawSlug)) {
    const candidate = rawSlug.trim();
    return isValidSlug(candidate) ? candidate : null;
  }
  return deriveSourceSlug(title);
}

export function deriveSourceSlug(title: string): string {
  const ascii = slugify(title, "", 60);
  if (ascii.length > 0 && isValidSlug(ascii)) return ascii;
  // Fallback: sha256 prefix. Base-16 so we only emit [0-9a-f]
  // — matches the isValidSlug charset without needing base64url
  // lowercase+underscore munging.
  const hash = createHash("sha256")
    .update(title.trim() || "untitled", "utf-8")
    .digest("hex")
    .slice(0, 10);
  return `source-${hash}`;
}

// Parse + validate the POST /api/sources body into a fully-
// typed shape, or return an error envelope the caller can
// respond with directly. Extracted from the route handler so
// the validation logic fits under the cognitive-complexity cap.
interface ParsedRegisterBody {
  title: string;
  url: string;
  fetcherKind: FetcherKind;
  fetcherParams: FetcherParams;
  schedule: SourceSchedule;
  slug: string;
  notes: string;
  maxItemsPerFetch: number;
  categoryOverride: CategorySlug[];
  skipClassify: boolean;
}

interface ParseError {
  status: number;
  error: string;
}

function parseRegisterBody(body: RegisterSourceBody): ParsedRegisterBody | ParseError {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!title) return { status: 400, error: "title is required" };
  if (!url) return { status: 400, error: "url is required" };
  if (!isHttpUrl(url)) {
    return {
      status: 400,
      error: "url must be an http:// or https:// URL",
    };
  }
  const fetcherKind = validateFetcherKind(body.fetcherKind, "rss");
  if (!fetcherKind) {
    return {
      status: 400,
      error: `fetcherKind must be one of: ${[...FETCHER_KINDS].join(", ")}`,
    };
  }
  const schedule = validateSchedule(body.schedule, "daily");
  if (!schedule) {
    return {
      status: 400,
      error: `schedule must be one of: ${[...SOURCE_SCHEDULES].join(", ")}`,
    };
  }
  const fetcherParams = validateFetcherParams(body.fetcherParams);
  if (fetcherParams === null) {
    return {
      status: 400,
      error: "fetcherParams must be a flat object of string values",
    };
  }
  const slug = resolveSlug(body.slug, title);
  if (!slug) {
    return {
      status: 400,
      error: "slug must match [a-z0-9](-[a-z0-9])* (or omit to auto-derive from title)",
    };
  }
  return {
    title,
    url,
    fetcherKind,
    fetcherParams,
    schedule,
    slug,
    notes: typeof body.notes === "string" ? body.notes : "",
    maxItemsPerFetch: resolveMaxItemsPerFetch(body.maxItemsPerFetch),
    categoryOverride: normalizeCategories(body.categories),
    skipClassify: body.skipClassify === true,
  };
}

function resolveMaxItemsPerFetch(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return 30;
}

// Decide the new source's categories: caller-provided override
// wins; otherwise run the classifier (unless explicitly skipped).
// Classifier failures are non-fatal — register the source with no
// categories and log the error so the user can `recategorize`
// later.
async function resolveCategories(parsed: ParsedRegisterBody): Promise<{ categories: CategorySlug[]; rationale?: string }> {
  if (parsed.categoryOverride.length > 0) {
    return { categories: parsed.categoryOverride };
  }
  if (parsed.skipClassify) return { categories: [] };
  try {
    const classifyResult = await classifySource({
      title: parsed.title,
      url: parsed.url,
      notes: parsed.notes || undefined,
    });
    return {
      categories: classifyResult.categories,
      rationale: classifyResult.rationale,
    };
  } catch (err) {
    log.warn("sources", "classify failed, saving with no categories", {
      slug: parsed.slug,
      error: String(err),
    });
    return { categories: [] };
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Defensive unused-export to keep the route cohesive: the
// pipeline doesn't use this but a future per-source "fetch now"
// handler will.
export { defaultSourceState };

export default router;
