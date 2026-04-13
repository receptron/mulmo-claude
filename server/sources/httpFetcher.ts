// Etiquette-respecting HTTP fetcher for server-side source
// fetchers (RSS, GitHub API, arXiv, etc.).
//
// Wraps `fetch` with four things phase-1 fetchers would otherwise
// all have to reimplement:
//
//   1. User-Agent: `MulmoClaude-SourceBot/1.0 (+<repo url>)` on every
//      request, so site operators can identify and contact.
//   2. robots.txt check: before fetching `<scheme>://<host>/<path>`,
//      read the cached robots.txt for `<host>` and consult
//      `isAllowedByRobots`. Disallowed paths 400-reject at the
//      library boundary — fetcher sees `RobotsDisallowedError` and
//      can log / skip.
//   3. Per-host rate limit: HostRateLimiter serializes same-host
//      requests with a `Crawl-delay`-aware minimum gap.
//   4. Timeout: each request gets a finite AbortController so a
//      hung server can't wedge the daily pipeline.
//
// The robots.txt cache itself is NOT owned by this module — it's
// a pluggable `RobotsProvider` so tests can stub it and the real
// cache (filesystem-backed, 24h TTL) lives elsewhere.
//
// Every moving part has an injectable dep so tests can drive the
// whole flow without network or disk.

import {
  DEFAULT_MIN_DELAY_MS,
  HostRateLimiter,
  defaultRateLimiterDeps,
  type RateLimiterDeps,
} from "./rateLimiter.js";
import { isAllowedByRobots, parseRobots } from "./robots.js";

// The User-Agent value sent on every fetch. Identifies us clearly
// enough for a site operator to find the project and contact us.
// Update the URL if the repo ever moves.
export const USER_AGENT =
  "MulmoClaude-SourceBot/1.0 (+https://github.com/receptron/mulmoclaude)";

// Per-request wall-clock cap. Fetchers can still cancel earlier
// via a passed-in AbortSignal; this is the outer safety net so a
// hung server never holds a rate-limit slot forever.
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

// Thrown when a URL would violate the target host's robots.txt
// policy for our User-Agent. Caught by fetchers so a single
// disallowed source doesn't look like a generic HTTP error.
export class RobotsDisallowedError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`[sources] robots.txt disallows ${url} for our User-Agent`);
    this.name = "RobotsDisallowedError";
    this.url = url;
  }
}

// How the fetcher gets robots.txt for a given host. The real
// implementation (phase-2-ish) will read from
// `workspace/sources/_state/robots/<host>.txt` with a 24h TTL,
// falling back to an HTTP GET. Tests inject an in-memory map.
//
// Returns null to signal "no robots.txt found" (or "404-equivalent")
// which the evaluator treats as permissive — the usual convention.
export type RobotsProvider = (host: string) => Promise<string | null>;

export interface HttpFetcherDeps {
  // HTTP client. Defaults to global `fetch`; tests inject a
  // response-map function.
  fetchImpl: typeof fetch;
  // robots.txt source. See RobotsProvider.
  robots: RobotsProvider;
  // Shared rate limiter so fetchers going through the same
  // HttpFetcher instance all serialize per-host together.
  rateLimiter: HostRateLimiter;
  // Rate-limiter clock / sleep — usually pass through from
  // `rateLimiter`'s deps when constructing both.
  rateLimiterDeps: RateLimiterDeps;
  // Per-host crawl-delay override, looked up per request. Returns
  // null when the fetcher should fall back to its
  // `DEFAULT_MIN_DELAY_MS`. Normally implemented by caching the
  // robots.txt `Crawl-delay` value per host.
  crawlDelayMs: (host: string) => number | null;
  // Extra abort signal the caller can provide to cancel a fetch
  // early (e.g. pipeline shutdown). Combined with the internal
  // timeout via any-of.
  externalSignal?: AbortSignal;
  // Request timeout. DEFAULT_FETCH_TIMEOUT_MS unless overridden.
  timeoutMs: number;
  // For tests: called exactly once with every resolved URL right
  // before `fetchImpl` runs. Production passes a no-op.
  onWillFetch: (url: string) => void;
}

export function defaultHttpFetcherDeps(
  robots: RobotsProvider,
  rateLimiter?: HostRateLimiter,
  rateLimiterDeps: RateLimiterDeps = defaultRateLimiterDeps(),
): HttpFetcherDeps {
  return {
    fetchImpl: globalThis.fetch.bind(globalThis),
    robots,
    rateLimiter: rateLimiter ?? new HostRateLimiter(rateLimiterDeps),
    rateLimiterDeps,
    crawlDelayMs: () => null,
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    onWillFetch: () => {},
  };
}

// Fetch a URL politely. Resolves with the Response object (caller
// decides whether to `.text()` / `.json()`); rejects with
// `RobotsDisallowedError` when robots says no, `DOMException`
// (AbortError) when the external signal or the internal timeout
// fires, or whatever `fetchImpl` throws otherwise.
export async function fetchPolite(
  rawUrl: string,
  deps: HttpFetcherDeps,
): Promise<Response> {
  const url = new URL(rawUrl);
  // Only http(s) reach the fetch — file://, data:, mailto: would
  // never be legitimate source URLs and robots.txt doesn't cover
  // them. Reject at the boundary.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[sources] fetchPolite: refusing non-http(s) URL ${rawUrl}`,
    );
  }
  const host = url.host.toLowerCase();

  // 1. robots.txt check.
  const robotsText = await deps.robots(host);
  if (robotsText !== null) {
    const parsed = parseRobots(robotsText);
    const pathAndQuery = url.pathname + url.search;
    if (!isAllowedByRobots(parsed, USER_AGENT, pathAndQuery)) {
      throw new RobotsDisallowedError(rawUrl);
    }
  }

  // 2. Per-host rate-limited HTTP call. The task body builds and
  // executes the fetch; the limiter owns ordering + minimum gap.
  const minDelay = deps.crawlDelayMs(host) ?? DEFAULT_MIN_DELAY_MS;
  return deps.rateLimiter.run(
    host,
    () => fetchWithTimeout(rawUrl, deps),
    minDelay,
  );
}

async function fetchWithTimeout(
  rawUrl: string,
  deps: HttpFetcherDeps,
): Promise<Response> {
  // Combine the caller's signal with an internal timeout. Each
  // fetch gets its own AbortController so a slow request doesn't
  // affect the next caller.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort(
      new DOMException(
        `[sources] fetch timed out after ${deps.timeoutMs}ms`,
        "TimeoutError",
      ),
    );
  }, deps.timeoutMs);

  const external = deps.externalSignal;
  let externalUnsub: (() => void) | null = null;
  if (external) {
    if (external.aborted) {
      clearTimeout(timeoutHandle);
      throw (
        (external as AbortSignal & { reason?: unknown }).reason ??
        new DOMException("Aborted", "AbortError")
      );
    }
    const onAbort = () => {
      controller.abort((external as AbortSignal & { reason?: unknown }).reason);
    };
    external.addEventListener("abort", onAbort, { once: true });
    externalUnsub = () => external.removeEventListener("abort", onAbort);
  }

  deps.onWillFetch(rawUrl);
  try {
    return await deps.fetchImpl(rawUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeoutHandle);
    externalUnsub?.();
  }
}
