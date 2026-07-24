import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type { WikiPageEntry } from "../index";
import { computeTagChips, computeTagCounts } from "../helpers";

// One view-level knob for the adaptive cutoff; the counting + cutoff rules
// themselves live in `computeTagCounts` / `computeTagChips` (helpers.ts, tested).
const TARGET_FILTER_CHIPS = 20;

export interface TagFilter {
  selectedTag: Ref<string | null>;
  tagCounts: ComputedRef<Map<string, number>>;
  allTags: ComputedRef<[string, number][]>;
  visibleEntries: ComputedRef<WikiPageEntry[]>;
  toggleTagFilter: (tag: string) => void;
  setTagFilter: (tag: string) => void;
}

export function useTagFilter(pageEntries: Ref<WikiPageEntry[]>, action: Ref<string>): TagFilter {
  // View-local, not persisted to URL — kept ephemeral so it doesn't leak into
  // bookmarks or the per-session stack history.
  const selectedTag = ref<string | null>(null);

  // Kept a separate computed from `allTags` so the fallback chip (an active
  // filter the adaptive cutoff hides) can read a real count instead of
  // understating a dropped non-singleton tag as 1.
  const tagCounts = computed<Map<string, number>>(() => computeTagCounts(pageEntries.value));
  const allTags = computed<[string, number][]>(() => computeTagChips(pageEntries.value, TARGET_FILTER_CHIPS));

  const visibleEntries = computed(() => {
    const tag = selectedTag.value;
    if (tag === null) return pageEntries.value;
    return pageEntries.value.filter((entry) => (entry.tags ?? []).includes(tag));
  });

  function toggleTagFilter(tag: string): void {
    selectedTag.value = selectedTag.value === tag ? null : tag;
  }

  // Per-entry / metadata chips set the filter unconditionally — clicking a
  // `#tag` chip should always filter to that tag, even when it's already the
  // active filter (toggling here surprised users by clearing it instead).
  function setTagFilter(tag: string): void {
    selectedTag.value = tag;
  }

  // Clear the filter whenever we leave the index view — otherwise switching to
  // Log / Lint and back leaves a stale filter active, which feels like a bug.
  watch(action, (next) => {
    if (next !== "index") selectedTag.value = null;
  });

  return { selectedTag, tagCounts, allTags, visibleEntries, toggleTagFilter, setTagFilter };
}
