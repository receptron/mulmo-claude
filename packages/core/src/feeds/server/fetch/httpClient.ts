// Minimal HTTP client for feed retrievers. Feed URLs are model-authored /
// user-supplied, so beyond a User-Agent + timeout this guards against SSRF:
// every URL (and every redirect hop) is DNS-resolved and rejected if it
// points at a loopback / private / link-local / cloud-metadata address.
// The deny-list itself is the repo-wide one in `@mulmoclaude/common/ssrf`
// (#2459); this wrapper adds the DNS resolution and manual redirect loop.
// Redirects are followed MANUALLY so a public URL can't 302 to an internal
// one and bypass the guard. It does NOT do robots.txt / rate limiting (the
// engine fetches feeds sequentially to stay gentle).
//
// Residual risk (same as the mastodon urlGuard): the DNS answer we validate is
// not necessarily the one the subsequent fetch() uses — it re-resolves — so a
// rebinding attacker with a very short TTL can still slip through. Pinning the
// resolved address into the connection would need a custom agent.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedIpv4, isBlockedIpv6, parseSafeUrlShape, stripIpv6Brackets } from "@mulmoclaude/common/ssrf";

// Inlined — the client needs only this one time constant and must stay free of
// host-side time-constant modules.
const ONE_SECOND_MS = 1_000;

/** Identifies the bot to site operators. */
export const FEED_USER_AGENT = "MulmoClaude-FeedBot/1.0 (+https://github.com/receptron/mulmoclaude)";

/** Per-request wall-clock cap so a hung server can't wedge a refresh. */
export const DEFAULT_FEED_TIMEOUT_MS = 30 * ONE_SECOND_MS;

/** Cap on redirect hops followed (each re-checked for SSRF). */
const MAX_REDIRECTS = 5;

/** DNS answers should be IP literals; anything else is blocked outright. */
function isBlockedResolvedIp(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isBlockedIpv4(address);
  if (kind === 6) return isBlockedIpv6(address);
  return true;
}

async function resolveAddresses(host: string): Promise<{ address: string }[]> {
  try {
    return await lookup(host, { all: true });
  } catch (err) {
    throw new Error(`could not resolve host '${host}': ${String(err)}`);
  }
}

/** Reject non-http(s) URLs, internal-by-convention hostnames, and URLs whose
 *  host is / resolves to a private/loopback address (SSRF guard). Throws with
 *  a clear reason; returns void on pass. */
async function assertFetchableUrl(rawUrl: string): Promise<void> {
  if (!/^https?:\/\//i.test(rawUrl)) throw new Error(`refusing non-http(s) URL: ${rawUrl}`);
  const url = parseSafeUrlShape(rawUrl);
  if (url === null) throw new Error(`refusing to fetch a private/loopback/internal address: ${rawUrl}`);
  const host = stripIpv6Brackets(url.hostname);
  // A literal address was already vetted by the shape check above.
  if (isIP(host)) return;
  const blocked = (await resolveAddresses(host)).find((entry) => isBlockedResolvedIp(entry.address));
  if (blocked) throw new Error(`refusing to fetch '${host}' — resolves to a private/loopback address (${blocked.address})`);
}

async function fetchOnce(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`feed fetch timed out after ${timeoutMs}ms`, "TimeoutError")), timeoutMs);
  try {
    return await fetch(url, { headers: { "User-Agent": FEED_USER_AGENT }, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

// Follow redirects manually, re-running the SSRF guard on every hop so a
// public URL cannot bounce to an internal target.
async function fetchGuarded(rawUrl: string, timeoutMs: number): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertFetchableUrl(current);
    const response = await fetchOnce(current, timeoutMs);
    const redirect = response.status >= 300 && response.status < 400 && response.status !== 304 ? response.headers.get("location") : null;
    if (!redirect) return response;
    current = new URL(redirect, current).toString();
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS}) starting from ${rawUrl}`);
}

/** Fetch a URL as text, throwing on guard rejection, network error, or non-2xx. */
export async function fetchText(url: string, timeoutMs: number = DEFAULT_FEED_TIMEOUT_MS): Promise<string> {
  const response = await fetchGuarded(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
  return response.text();
}

/** Fetch a URL as parsed JSON, throwing on guard rejection, network error, or non-2xx. */
export async function fetchJson(url: string, timeoutMs: number = DEFAULT_FEED_TIMEOUT_MS): Promise<unknown> {
  const response = await fetchGuarded(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
  return response.json();
}
