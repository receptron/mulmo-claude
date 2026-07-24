// Server-side client for the curated collection registries' published index.json
// files. The official registry (receptron/mulmoclaude-collections via GitHub Pages)
// is always loaded; users can append more via `config/collections-registries.json`.
// Each index is fetched over HTTPS with a timeout, validated against the index
// contract, and memo-cached per-registry so the Discover tab doesn't hammer the
// upstreams. On a transient upstream failure we serve that registry's last good
// index rather than failing the whole Discover view.

import { fetchWithTimeout } from "../../../utils/fetch.js";
import { errorMessage, ONE_SECOND_MS } from "../../server/util.js";
import { log } from "../../server/host.js";
import { parseRegistryIndex, type RegistryEntry, type RegistryIndex } from "../registryIndex.js";
import { loadRegistriesConfig, OFFICIAL_REGISTRY_NAME, type RegistryConfigEntry } from "./registriesConfig.js";

const DEFAULT_OFFICIAL_INDEX_URL = "https://receptron.github.io/mulmoclaude-collections/index.json";
const DEFAULT_OFFICIAL_RAW_BASE = "https://raw.githubusercontent.com/receptron/mulmoclaude-collections/main";
export const CACHE_TTL_MS = 5 * 60 * ONE_SECOND_MS;
// During an outage (cache past TTL + failing upstream) don't re-hit the network
// more than once per this window — serve stale immediately in between, so a down
// upstream can't add its full timeout to every request.
export const STALE_RETRY_BACKOFF_MS = 60 * ONE_SECOND_MS;
const FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;
const STATUS_BAD_GATEWAY = 502;
const STATUS_UNAVAILABLE = 503;

/** Per-registry fetch outcome. `ok: false` is reported per-registry — the
 *  merged Discover response still succeeds when at least one registry is
 *  reachable; failed registries just contribute zero entries. */
export type FetchIndexResult = { ok: true; index: RegistryIndex; stale: boolean } | { ok: false; status: number; error: string };

interface CacheEntry {
  index: RegistryIndex;
  atMs: number;
}

const cache = new Map<string, CacheEntry>();
const lastFailureMs = new Map<string, number>();

/** Resolved descriptor for one registry the host should fetch — name + URLs.
 *  `official` is always synthesized; further entries come from
 *  `config/collections-registries.json`. Currently structurally identical to
 *  `RegistryConfigEntry`; aliased so we can add server-only fields (e.g.
 *  auth headers) without touching the on-disk config schema. */
export type RegistryDescriptor = RegistryConfigEntry;

function officialDescriptor(): RegistryDescriptor {
  return {
    name: OFFICIAL_REGISTRY_NAME,
    indexUrl: process.env.COLLECTIONS_REGISTRY_URL ?? DEFAULT_OFFICIAL_INDEX_URL,
    rawBaseUrl: process.env.COLLECTIONS_REGISTRY_RAW_BASE ?? DEFAULT_OFFICIAL_RAW_BASE,
  };
}

/** The full ordered registry list: official first, then user-configured ones.
 *  Re-reads the config file on every call so a Discover refresh picks up edits
 *  without a server restart (the config is small + read-rarely). */
export function listRegistries(): RegistryDescriptor[] {
  return [officialDescriptor(), ...loadRegistriesConfig()];
}

/** Look up one registry descriptor by name. Used by the preview / import path,
 *  which has the registry label from the entry and needs the rawBase. */
export function findRegistry(name: string): RegistryDescriptor | null {
  return listRegistries().find((reg) => reg.name === name) ?? null;
}

async function loadFromNetwork(descriptor: RegistryDescriptor): Promise<FetchIndexResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(descriptor.indexUrl, { timeoutMs: FETCH_TIMEOUT_MS, headers: { accept: "application/json" } });
  } catch (err) {
    log.warn("collections-registry", "index fetch failed", { registry: descriptor.name, url: descriptor.indexUrl, error: errorMessage(err) });
    return { ok: false, status: STATUS_UNAVAILABLE, error: "registry unreachable" };
  }
  if (!res.ok) return { ok: false, status: STATUS_BAD_GATEWAY, error: `registry responded ${res.status}` };
  const json: unknown = await res.json().catch(() => null);
  const parsed = parseRegistryIndex(json, descriptor.name);
  if (!parsed.ok) {
    log.warn("collections-registry", "index invalid", { registry: descriptor.name, url: descriptor.indexUrl, error: parsed.error });
    return { ok: false, status: STATUS_BAD_GATEWAY, error: `registry index invalid: ${parsed.error}` };
  }
  return { ok: true, index: parsed.index, stale: false };
}

export type IndexLoader = (descriptor: RegistryDescriptor) => Promise<FetchIndexResult>;

/** Cache key incorporates BOTH URLs so editing `indexUrl` or `rawBaseUrl` for
 *  an existing registry name invalidates the cached index automatically — same
 *  refresh cycle as if the user had renamed it (CodeRabbit review on #1837).
 *  Without this, the Discover catalog could keep serving the old upstream's
 *  entries while preview / import resolved the new rawBase, drifting until TTL
 *  expiry. Tab + key-content guarantees no collision between e.g. swapped
 *  name/url pairs. */
function descriptorCacheKey(descriptor: RegistryDescriptor): string {
  return `${descriptor.name}\t${descriptor.indexUrl}\t${descriptor.rawBaseUrl}`;
}

/** Fetch one registry's index. Same cache + stale-on-failure semantics as the
 *  original single-registry implementation — just keyed by descriptor identity
 *  (name + both URLs) so multiple registries don't fight over one slot AND a
 *  reconfigured registry doesn't serve a stale index from the prior URL. */
export async function fetchRegistryIndex(
  descriptor: RegistryDescriptor,
  opts: { force?: boolean; nowMs?: number; loader?: IndexLoader } = {},
): Promise<FetchIndexResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const loader = opts.loader ?? loadFromNetwork;
  const key = descriptorCacheKey(descriptor);
  const cached = cache.get(key);
  if (!opts.force && cached && nowMs - cached.atMs < CACHE_TTL_MS) {
    return { ok: true, index: cached.index, stale: false };
  }
  const failedAt = lastFailureMs.get(key);
  if (!opts.force && cached && failedAt !== undefined && nowMs - failedAt < STALE_RETRY_BACKOFF_MS) {
    return { ok: true, index: cached.index, stale: true };
  }
  const fresh = await loader(descriptor);
  if (fresh.ok) {
    cache.set(key, { index: fresh.index, atMs: nowMs });
    lastFailureMs.delete(key);
    return { ok: true, index: fresh.index, stale: false };
  }
  lastFailureMs.set(key, nowMs);
  if (cached) return { ok: true, index: cached.index, stale: true };
  return fresh;
}

/** One registry's contribution to the merged Discover view. `failed` registries
 *  surface in the response so the UI can show a per-registry error badge while
 *  still rendering the entries from the registries that did work. */
export interface MergedRegistryResult {
  name: string;
  status: "ok" | "stale" | "failed";
  generatedAt: string | null;
  error: string | null;
  entries: RegistryEntry[];
}

/** Fetch every configured registry in parallel and return per-registry
 *  outcomes. Callers (the Discover route) concatenate `entries` from each.
 *  Failure of any single registry doesn't abort the others — that's the point
 *  of supporting multiple registries. */
export async function fetchAllRegistries(opts: { force?: boolean; nowMs?: number; loader?: IndexLoader } = {}): Promise<MergedRegistryResult[]> {
  const descriptors = listRegistries();
  return await Promise.all(
    descriptors.map(async (descriptor): Promise<MergedRegistryResult> => {
      const result = await fetchRegistryIndex(descriptor, opts);
      if (!result.ok) {
        return { name: descriptor.name, status: "failed", generatedAt: null, error: result.error, entries: [] };
      }
      return {
        name: descriptor.name,
        status: result.stale ? "stale" : "ok",
        generatedAt: result.index.generatedAt,
        error: null,
        entries: result.index.collections,
      };
    }),
  );
}

/** Test seam: reset the module cache + failure backoff state (all registries). */
export function resetRegistryCache(): void {
  cache.clear();
  lastFailureMs.clear();
}
