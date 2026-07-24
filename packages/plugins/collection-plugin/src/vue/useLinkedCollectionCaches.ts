// Linked-collection cache layer for collection surfaces: owns the three
// per-target caches (ref labels, full ref records, embed targets) and the
// fan-out fetch that hydrates them, split out of useCollectionRendering so the
// cache-ownership + best-effort/stale-write fetch concern is isolated and
// unit-testable, separate from the stateless render/format layer. Instantiate
// ONCE per collection surface; pass the caches down to the renderers.

import { ref, type Ref } from "vue";
import { collectionUi, type CollectionApiResult } from "./uiContext";
import { buildRefDisplayMap, buildRefRecordMap } from "./useCollectionRendering.helpers";
import { uniqueBacklinkSources, uniqueEmbedTargets, uniqueRefTargets } from "@mulmoclaude/core/collection";
import type { CollectionDetail, CollectionDetailResponse, CollectionSchema, EmbedCache, RefCache, RefRecordCache } from "@mulmoclaude/core/collection";

export interface LinkedCollectionCaches {
  refCache: Ref<RefCache>;
  refRecordCache: Ref<RefRecordCache>;
  embedCache: Ref<EmbedCache>;
  resetLinkedCaches: () => void;
  loadLinkedCollections: (schema: CollectionSchema, expectedSlug: string) => Promise<void>;
}

export interface LinkedTargets {
  refTargets: Set<string>;
  embedTargets: Set<string>;
  allTargets: string[];
}

export interface LinkedCachesSnapshot {
  refCache: RefCache;
  refRecordCache: RefRecordCache;
  embedCache: EmbedCache;
}

type FetchCollectionDetail = (slug: string) => Promise<CollectionApiResult<CollectionDetailResponse>>;

/** The de-duplicated ref + embed target slugs a schema links to. `allTargets`
 *  is the union (each target fetched once even when both ref'd and embedded).
 *  `backlinks` SOURCE collections ride in `embedTargets`: a backlink needs
 *  exactly what an embed target caches (the source's schema + items in
 *  `embedCache`), so reverse sources reuse that cache rather than adding a
 *  parallel one. */
export function linkedTargets(schema: CollectionSchema): LinkedTargets {
  const refTargets = new Set(uniqueRefTargets(schema));
  const embedTargets = new Set([...uniqueEmbedTargets(schema), ...uniqueBacklinkSources(schema)]);
  const allTargets = [...new Set([...refTargets, ...embedTargets])];
  return { refTargets, embedTargets, allTargets };
}

/** Fan-out fetch that hydrates the linked-collection caches. Best-effort: a
 *  target whose fetch *rejects* (vs. resolving `{ ok: false }`) is coerced to a
 *  skip and must not abort the others. Returns null when a quicker subsequent
 *  load has already moved on (stale-write guard) so the caller drops the write.
 *  Pure + injectable (`fetchDetail`, `currentSlug`) so both paths are testable. */
export async function fetchLinkedCaches(
  targets: LinkedTargets,
  fetchDetail: FetchCollectionDetail,
  currentSlug: () => string | undefined,
  expectedSlug: string,
): Promise<LinkedCachesSnapshot | null> {
  const { refTargets, embedTargets, allTargets } = targets;
  const results = await Promise.all(
    allTargets.map(async (target) => {
      try {
        return { target, result: await fetchDetail(target) };
      } catch {
        return { target, result: { ok: false as const } };
      }
    }),
  );
  // Stale-write guard: a quicker subsequent load may have replaced the open
  // collection; dropping the write avoids surfacing the previous collection's
  // linked data on the current one.
  if (currentSlug() !== expectedSlug) return null;
  const refCache: RefCache = {};
  const refRecordCache: RefRecordCache = {};
  const embedCache: EmbedCache = {};
  for (const { target, result } of results) {
    if (!result.ok) continue;
    if (refTargets.has(target)) {
      refCache[target] = buildRefDisplayMap(result.data);
      refRecordCache[target] = buildRefRecordMap(result.data);
    }
    if (embedTargets.has(target)) embedCache[target] = { schema: result.data.collection.schema, items: result.data.items };
  }
  return { refCache, refRecordCache, embedCache };
}

export function useLinkedCollectionCaches(collection: Ref<CollectionDetail | null>): LinkedCollectionCaches {
  const refCache = ref<RefCache>({});
  const refRecordCache = ref<RefRecordCache>({});
  const embedCache = ref<EmbedCache>({});

  function resetLinkedCaches(): void {
    refCache.value = {};
    refRecordCache.value = {};
    embedCache.value = {};
  }

  async function loadLinkedCollections(schema: CollectionSchema, expectedSlug: string): Promise<void> {
    const targets = linkedTargets(schema);
    if (targets.allTargets.length === 0) return;
    const binding = collectionUi();
    const snapshot = await fetchLinkedCaches(
      targets,
      (slug) => binding.fetchCollectionDetail(slug),
      () => collection.value?.slug,
      expectedSlug,
    );
    if (!snapshot) return;
    refCache.value = snapshot.refCache;
    refRecordCache.value = snapshot.refRecordCache;
    embedCache.value = snapshot.embedCache;
  }

  return { refCache, refRecordCache, embedCache, resetLinkedCaches, loadLinkedCollections };
}
