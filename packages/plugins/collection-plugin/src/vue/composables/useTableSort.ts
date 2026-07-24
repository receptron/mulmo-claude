// List-table column sort: a single active column, toggled from its header
// (none → asc → desc → none). Calendar / kanban keep their own ordering; only
// the table consumes `sortedItems`. The active sort is a single SHARED
// per-collection preference in localStorage — both the standalone page and
// embedded chat cards read AND write it (the parent's persist watch owns the
// write), so a sort set anywhere is consistent the next time the collection is
// viewed. Resets only when a DIFFERENT collection loads (`resetForSlug`).
//
// The reactive shell, extracted from CollectionView; the value-comparison logic
// lives in core (`sortItems` / `sortValueOf`) and the header display mapping in
// `../tableSortDisplay`.

import { computed, ref, type ComputedRef, type Ref } from "vue";
import {
  nextSortDirection,
  sortItems,
  sortValueOf,
  type CollectionDetail,
  type CollectionItem,
  type SortState,
  type SortValueDeps,
} from "@mulmoclaude/core/collection";
import { readCollectionSort } from "../collectionViewMode";
import { previewSortDir, sortAriaTokenForDir, sortButtonClassForDir, sortIconNameForDir } from "../tableSortDisplay";

interface UseTableSortParams {
  collection: Ref<CollectionDetail | null>;
  /** The already text/flag-filtered rows the table renders (sort is the last
   *  transform in the chain). */
  tableFilteredItems: Readonly<Ref<CollectionItem[]>>;
  activeSlug: Readonly<Ref<string | undefined>>;
  /** Row readers the pure `sortValueOf` can't get from the raw cell (toggle /
   *  flag projections, derived-formula eval, ref display). Built by the parent
   *  where those helpers are in scope. */
  sortValueDeps: SortValueDeps;
}

export interface UseTableSort {
  sortState: Ref<SortState | null>;
  hoveredSortKey: Ref<string | null>;
  sortedItems: ComputedRef<CollectionItem[]>;
  cycleSort: (key: string) => void;
  sortIconName: (key: string) => string;
  sortButtonClass: (key: string) => string;
  sortAriaValue: (key: string) => "ascending" | "descending" | "none";
  /** Restore the given collection's stored (shared) sort — the switch-collection
   *  reset; a sort belongs to a schema, so it's never carried across. */
  resetForSlug: (slug: string | undefined) => void;
}

function storedSortFor(slug: string | undefined): SortState | null {
  return (slug && readCollectionSort(slug)) || null;
}

export function useTableSort({ collection, tableFilteredItems, activeSlug, sortValueDeps }: UseTableSortParams): UseTableSort {
  const sortState = ref<SortState | null>(storedSortFor(activeSlug.value));
  // The column whose sort button is currently hovered (at most one). Hover
  // previews the NEXT click's state, so descending visibly fades back to the
  // light-grey "off" look — signalling the next click clears the sort.
  const hoveredSortKey = ref<string | null>(null);

  function sortDirectionFor(key: string): "asc" | "desc" | null {
    return sortState.value?.field === key ? sortState.value.direction : null;
  }

  function effectiveSortDir(key: string): "asc" | "desc" | null {
    return previewSortDir(sortDirectionFor(key), hoveredSortKey.value === key);
  }

  /** Cycle a column none → asc → desc → none; activating one clears the rest. */
  function cycleSort(key: string): void {
    const next = nextSortDirection(sortDirectionFor(key));
    sortState.value = next ? { field: key, direction: next } : null;
  }

  const sortIconName = (key: string): string => sortIconNameForDir(effectiveSortDir(key));
  const sortButtonClass = (key: string): string => sortButtonClassForDir(effectiveSortDir(key));
  const sortAriaValue = (key: string): "ascending" | "descending" | "none" => sortAriaTokenForDir(sortDirectionFor(key));

  const sortedItems = computed<CollectionItem[]>(() => {
    const state = sortState.value;
    const field = state ? collection.value?.schema.fields[state.field] : undefined;
    if (!state || !field) return tableFilteredItems.value;
    return sortItems(tableFilteredItems.value, state.direction, (item) => sortValueOf(field, state.field, item, sortValueDeps));
  });

  function resetForSlug(slug: string | undefined): void {
    sortState.value = storedSortFor(slug);
  }

  return { sortState, hoveredSortKey, sortedItems, cycleSort, sortIconName, sortButtonClass, sortAriaValue, resetForSlug };
}
