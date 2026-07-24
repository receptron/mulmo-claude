// Client store for the dashboard layout (tile order + per-tile view mode,
// and per-row view-area heights for the favorites grid). Singleton module
// state shared across consumers, mirroring `useShortcuts`: persistence is
// server-side (`config/dashboard.json` via PUT /api/dashboard); the client
// owns the full layout and replaces it wholesale. Mutations are optimistic
// with rollback on failure and serialised so overlapping replace-all PUTs
// never land out of order.
//
// Membership (which collections appear) is NOT owned here — it derives
// from the user's pinned collection shortcuts (favorites). `reconcile`
// folds a fresh favorite-slug list into the stored layout: it appends
// newly-favorited collections and prunes ones that were unpinned, while
// preserving the user's dashboard order and per-tile view modes.
//
// Row heights are POSITIONAL: indexed by grid row (2 tiles/row), they stay
// with the slot when tiles are reordered, never with a specific tile.

import { computed, ref, type ComputedRef } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPut } from "../utils/api";
import { createMutationQueue } from "../utils/mutationQueue";
import type { DashboardTile } from "../types/dashboard";

const tiles = ref<DashboardTile[]>([]);
const rowHeights = ref<Record<string, number[]>>({});
const loadError = ref<string | null>(null);
/** True only after a GET has authoritatively populated the layout. Until
 *  then, mutations refuse to persist — a replace-all PUT built on the
 *  empty default would clobber an existing `dashboard.json`. */
const loaded = ref(false);
let loadPromise: Promise<void> | null = null;

interface DashboardResponse {
  tiles: DashboardTile[];
  rowHeights?: Record<string, number[]>;
}

/** Snapshot of the mutable layout, for optimistic rollback. */
interface LayoutSnapshot {
  tiles: DashboardTile[];
  rowHeights: Record<string, number[]>;
}

function snapshot(): LayoutSnapshot {
  return { tiles: tiles.value, rowHeights: rowHeights.value };
}

function apply(layout: LayoutSnapshot): void {
  tiles.value = layout.tiles;
  rowHeights.value = layout.rowHeights;
}

/** Load once per session (deduped). A FAILED load is not cached so the
 *  next call retries rather than permanently serving the failure. */
async function load(force = false): Promise<void> {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    const result = await apiGet<DashboardResponse>(API_ROUTES.dashboard);
    if (!result.ok) {
      loadError.value = result.error;
      loadPromise = null; // allow retry on the next call
      return;
    }
    loadError.value = null;
    apply({ tiles: result.data.tiles, rowHeights: result.data.rowHeights ?? {} });
    loaded.value = true;
  })();
  return loadPromise;
}

// `PUT /api/dashboard` rewrites the whole layout, so every mutation runs
// through this queue and the replace-all PUTs never overlap. See
// `createMutationQueue` for the races that prevents.
const { enqueue } = createMutationQueue();

/** Persist the given layout, rolling back to `previous` on failure.
 *  Returns true on success. Call only from inside `enqueue`. */
async function persist(next: LayoutSnapshot, previous: LayoutSnapshot): Promise<boolean> {
  apply(next);
  const result = await apiPut<DashboardResponse>(API_ROUTES.dashboard, { tiles: next.tiles, rowHeights: next.rowHeights });
  if (!result.ok) {
    apply(previous);
    loadError.value = result.error;
    console.error("[useDashboard] persist failed", result.error);
    return false;
  }
  // Adopt the server's canonical layout. If the response omits rowHeights
  // (e.g. a version-skewed server), keep the heights we just sent rather
  // than clearing them — otherwise a resize would visibly snap back.
  apply({ tiles: result.data.tiles, rowHeights: result.data.rowHeights ?? next.rowHeights });
  loadError.value = null;
  return true;
}

/** Replace the full ordered tile list (used by drag-to-reorder). Row
 *  heights are positional, so they stay put. */
function setTiles(next: DashboardTile[]): Promise<boolean> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return false; // never overwrite an unread layout
    return persist({ tiles: next, rowHeights: rowHeights.value }, snapshot());
  });
}

/** Set (or, when null, clear) one tile's view mode. No-op if the slug
 *  isn't a tile. */
function setViewMode(slug: string, viewMode: string | null): Promise<boolean> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return false;
    if (!tiles.value.some((tile) => tile.slug === slug)) return true;
    const previous = snapshot();
    const next = previous.tiles.map((tile) => {
      if (tile.slug !== slug) return tile;
      if (viewMode === null) {
        const { viewMode: __drop, ...rest } = tile;
        return rest;
      }
      return { ...tile, viewMode };
    });
    return persist({ tiles: next, rowHeights: previous.rowHeights }, previous);
  });
}

/** Set one grid row's view-area height (px) for the given column-count
 *  layout. Heights are kept per column count so the 1- and 2-column
 *  layouts stay independent. Pads with `0` (default) for earlier
 *  untouched rows. */
function setRowHeight(columns: number, row: number, height: number): Promise<boolean> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return false;
    if (columns < 1 || row < 0) return true;
    const previous = snapshot();
    const key = String(columns);
    const heights = [...(previous.rowHeights[key] ?? [])];
    while (heights.length <= row) heights.push(0);
    heights[row] = height;
    const next = { ...previous.rowHeights, [key]: heights };
    return persist({ tiles: previous.tiles, rowHeights: next }, previous);
  });
}

/** Fold a fresh favorite-slug list into the stored layout: keep stored
 *  tiles whose slug is still a favorite (preserving order + view mode),
 *  then append any favorites not yet present (in the favorites' order).
 *  Persists only when something drifted, so the file self-heals after a
 *  pin / unpin without a redundant PUT on every visit. */
function reconcile(favoriteSlugs: string[]): Promise<void> {
  return enqueue(async () => {
    await load();
    if (!loaded.value) return; // never overwrite an unread layout
    const favoriteSet = new Set(favoriteSlugs);
    const kept = tiles.value.filter((tile) => favoriteSet.has(tile.slug));
    const keptSlugs = new Set(kept.map((tile) => tile.slug));
    const appended = favoriteSlugs.filter((slug) => !keptSlugs.has(slug)).map((slug) => ({ slug }) as DashboardTile);
    const next = [...kept, ...appended];
    const drifted = next.length !== tiles.value.length || next.some((tile, i) => tile.slug !== tiles.value[i]?.slug);
    if (drifted) await persist({ tiles: next, rowHeights: rowHeights.value }, snapshot());
  });
}

export function useDashboard(): {
  tiles: ComputedRef<DashboardTile[]>;
  rowHeights: ComputedRef<Record<string, number[]>>;
  loadError: ComputedRef<string | null>;
  load: (force?: boolean) => Promise<void>;
  setTiles: (next: DashboardTile[]) => Promise<boolean>;
  setViewMode: (slug: string, viewMode: string | null) => Promise<boolean>;
  setRowHeight: (columns: number, row: number, height: number) => Promise<boolean>;
  reconcile: (favoriteSlugs: string[]) => Promise<void>;
} {
  void load();
  return {
    tiles: computed(() => tiles.value),
    rowHeights: computed(() => rowHeights.value),
    loadError: computed(() => loadError.value),
    load,
    setTiles,
    setViewMode,
    setRowHeight,
    reconcile,
  };
}
