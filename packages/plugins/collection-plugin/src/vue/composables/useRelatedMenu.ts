// Related-collections pulldown: the standalone header control that hops to a
// collection this one links to (its refs) or that links back. Offered only when
// the host exposes `fetchOntology`; the neighbor list is derived lazily on the
// menu's first open (the ontology scan is expensive and most view opens never
// touch it) and cached per slug for the component's lifetime.
//
// The reactive shell for the pulldown, extracted from CollectionView so the
// component body stays an orchestrator. The pure neighbor derivation lives in
// `../relatedCollections`; the direction→glyph/key mapping in
// `../relatedMenuDisplay`.

import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { CollectionDetail } from "@mulmoclaude/core/collection";
import { useClickOutside } from "./useClickOutside";
import { relatedCollections, type RelatedCollection } from "../relatedCollections";
import { relatedDirectionIcon, relatedDirectionLabelKey } from "../relatedMenuDisplay";
import type { CollectionUi } from "../uiContext";
import type { useCollectionI18n } from "../lang";

type Translate = ReturnType<typeof useCollectionI18n>["t"];

interface UseRelatedMenuParams {
  collection: Ref<CollectionDetail | null>;
  embedded: Readonly<Ref<boolean>>;
  cui: CollectionUi;
  t: Translate;
}

export interface UseRelatedMenu {
  relatedMenuOpen: Ref<boolean>;
  relatedMenuRef: Ref<HTMLElement | null>;
  relatedLoading: Ref<boolean>;
  showRelatedMenu: ComputedRef<boolean>;
  relatedItems: ComputedRef<RelatedCollection[]>;
  toggleRelatedMenu: () => void;
  gotoRelated: (slug: string) => void;
  relatedDirectionIcon: (direction: RelatedCollection["direction"]) => string;
  relatedDirectionLabel: (direction: RelatedCollection["direction"]) => string;
  /** Drop the cached neighbors + close state when switching collections, so the
   *  next open re-derives for the new slug and a just-abandoned in-flight fetch
   *  can't strand the spinner. */
  resetForSlugChange: () => void;
}

export function useRelatedMenu({ collection, embedded, cui, t }: UseRelatedMenuParams): UseRelatedMenu {
  const { open: relatedMenuOpen, menuRef: relatedMenuRef } = useClickOutside();
  const relatedLoading = ref<boolean>(false);
  /** Derived neighbors for `relatedFetchedSlug` (null until first fetched). */
  const relatedList = ref<RelatedCollection[] | null>(null);
  /** Slug the cached `relatedList` was built for — a mismatch on open forces a
   *  re-fetch (e.g. after navigating to a different collection). */
  const relatedFetchedSlug = ref<string | null>(null);

  const showRelatedMenu = computed<boolean>(() => Boolean(collection.value) && !embedded.value && cui.fetchOntology !== undefined);
  const relatedItems = computed<RelatedCollection[]>(() => relatedList.value ?? []);

  const relatedDirectionLabel = (direction: RelatedCollection["direction"]): string => t(relatedDirectionLabelKey(direction));

  /** Fetch the ontology and derive this slug's neighbors. Fail-soft: a non-ok
   *  result (the `apiGet` wrapper already caught the network/HTTP error) leaves
   *  an empty list, which the panel shows as its empty row.
   *
   *  Sets `relatedFetchedSlug` synchronously (before the await) so a rapid
   *  re-open can't kick a duplicate fetch, and DROPS a stale response whose slug
   *  no longer matches the active collection — otherwise a slower fetch for a
   *  since-abandoned slug, resolving after a fast switch, would apply the wrong
   *  collection's neighbors (Codex / CodeRabbit on PR #2251). */
  async function loadRelated(slug: string): Promise<void> {
    relatedFetchedSlug.value = slug;
    relatedLoading.value = true;
    const result = await cui.fetchOntology?.();
    if (collection.value?.slug !== slug) return;
    relatedLoading.value = false;
    relatedList.value = result?.ok ? relatedCollections(result.data.entries, slug) : [];
  }

  function toggleRelatedMenu(): void {
    relatedMenuOpen.value = !relatedMenuOpen.value;
    const slug = collection.value?.slug;
    if (relatedMenuOpen.value && slug && relatedFetchedSlug.value !== slug) void loadRelated(slug);
  }

  /** Hop to a related collection's detail page (same nav as the index cards). */
  function gotoRelated(slug: string): void {
    relatedMenuOpen.value = false;
    cui.gotoDetail("collection", slug);
  }

  function resetForSlugChange(): void {
    relatedMenuOpen.value = false;
    relatedList.value = null;
    relatedFetchedSlug.value = null;
    relatedLoading.value = false;
  }

  return {
    relatedMenuOpen,
    relatedMenuRef,
    relatedLoading,
    showRelatedMenu,
    relatedItems,
    toggleRelatedMenu,
    gotoRelated,
    relatedDirectionIcon,
    relatedDirectionLabel,
    resetForSlugChange,
  };
}
