// Fetch individual files of a registry collection (schema.json, meta.json, …)
// from the registry repo's raw content. The collection's repo-relative dir comes
// from a trusted index entry (never raw user input), so the host can only fetch
// files of collections that actually appear in the published index.
//
// The index itself is served from GitHub Pages (see client.ts); per-collection
// files are served from raw.githubusercontent. With multi-registry support the
// rawBase is no longer a single module-level value — it comes from the entry's
// source registry descriptor, so user-added registries can live anywhere.

import { fetchWithTimeout } from "../../../utils/fetch.js";
import { errorMessage, ONE_SECOND_MS } from "../../server/util.js";
import { isRecord } from "../guards.js";
import { fetchAllRegistries, findRegistry } from "./client.js";
import type { RegistryEntry } from "../registryIndex.js";

const FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;
const STATUS_BAD_GATEWAY = 502;
const STATUS_UNAVAILABLE = 503;
const STATUS_NOT_FOUND = 404;

/** Compose the raw URL for `<dirPath>/<relFile>` under a given registry's
 *  rawBase. Empty and traversal (`.`/`..`) segments are dropped so the URL can
 *  never escape the base, even if an upstream check is bypassed (the index
 *  parser already rejects such identifiers — this is defense-in-depth). The
 *  rawBase is trailing-slash-normalized: `parseRegistriesConfig` already trims
 *  user-config trailing slashes, but the official descriptor and any test
 *  bypass parse — repeating the trim here keeps the join `${base}/${path}`
 *  from producing `//` even when the caller bypassed config validation
 *  (CodeRabbit review on #1837). */
export function collectionFileUrl(rawBase: string, dirPath: string, relFile: string): string {
  let base = rawBase;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const segments = dirPath.split("/").filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  return `${base}/${segments.join("/")}/${relFile}`;
}

export type FileResult = { ok: true; text: string } | { ok: false; status: number; error: string };

/** Fetch one file out of a registry collection. `rawBase` comes from the
 *  entry's source registry (`findRegistry(entry.registryName).rawBaseUrl`),
 *  not a module-level setting — that's what makes additional user-configured
 *  registries reachable. */
export async function fetchCollectionFile(rawBase: string, dirPath: string, relFile: string): Promise<FileResult> {
  const url = collectionFileUrl(rawBase, dirPath, relFile);
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS });
  } catch (err) {
    return { ok: false, status: STATUS_UNAVAILABLE, error: `fetch failed: ${errorMessage(err)}` };
  }
  if (!res.ok) return { ok: false, status: STATUS_BAD_GATEWAY, error: `${relFile} responded ${res.status}` };
  return { ok: true, text: await res.text() };
}

export type JsonObjectResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

export function parseJsonObject(text: string, label: string): JsonObjectResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `${label} is not valid JSON` };
  }
  if (!isRecord(parsed)) return { ok: false, error: `${label} is not an object` };
  return { ok: true, value: parsed };
}

async function fetchJsonObject(
  rawBase: string,
  dirPath: string,
  relFile: string,
  label: string,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const file = await fetchCollectionFile(rawBase, dirPath, relFile);
  if (!file.ok) return { ok: false, status: file.status, error: `${label}: ${file.error}` };
  const parsed = parseJsonObject(file.text, label);
  if (!parsed.ok) return { ok: false, status: STATUS_BAD_GATEWAY, error: parsed.error };
  return { ok: true, value: parsed.value };
}

/** Resolve an entry's rawBase from its `registryName`. A missing match (the
 *  user removed the registry from config while a cached index still references
 *  it) returns null — the caller surfaces it as a 404 rather than crashing. */
export function rawBaseForEntry(entry: Pick<RegistryEntry, "registryName">): string | null {
  const registry = findRegistry(entry.registryName);
  return registry?.rawBaseUrl ?? null;
}

export type PreviewResult =
  { ok: true; entry: RegistryEntry; schema: Record<string, unknown>; meta: Record<string, unknown> } | { ok: false; status: number; error: string };

/** Resolve an entry by author+slug across every cached registry's entries.
 *  When `registry` is passed we constrain to that registry — needed because
 *  multiple registries can publish the same author/slug, and the UI should
 *  follow the card it just clicked. */
function findEntryInMergedView(
  merged: { name: string; entries: RegistryEntry[] }[],
  author: string,
  slug: string,
  registry: string | null,
): RegistryEntry | null {
  for (const reg of merged) {
    if (registry !== null && reg.name !== registry) continue;
    const match = reg.entries.find((candidate) => candidate.author === author && candidate.slug === slug);
    if (match) return match;
  }
  return null;
}

/** Preview a registry collection: confirm it's in some registry's published
 *  index, then fetch + parse its schema.json + meta.json so the Discover tab
 *  can show fields/views before import. With multi-registry support the
 *  `registry` arg disambiguates same-name collections from different sources. */
export async function previewCollection(author: string, slug: string, registry: string | null = null): Promise<PreviewResult> {
  const merged = await fetchAllRegistries();
  const entry = findEntryInMergedView(merged, author, slug, registry);
  if (!entry) return { ok: false, status: STATUS_NOT_FOUND, error: `unknown collection: ${author}/${slug}` };
  const rawBase = rawBaseForEntry(entry);
  if (!rawBase) return { ok: false, status: STATUS_NOT_FOUND, error: `registry "${entry.registryName}" is no longer configured` };
  const schema = await fetchJsonObject(rawBase, entry.path, "schema.json", "schema.json");
  if (!schema.ok) return schema;
  const meta = await fetchJsonObject(rawBase, entry.path, "meta.json", "meta.json");
  if (!meta.ok) return meta;
  return { ok: true, entry, schema: schema.value, meta: meta.value };
}
