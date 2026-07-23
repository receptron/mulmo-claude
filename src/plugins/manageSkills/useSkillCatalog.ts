// Preset-catalog cluster for the /skills page (#1335 PR-B). Owns the
// browsable catalog entries, the right-pane catalog selection + detail,
// and the ★ Star action. Lifted out of View.vue (#2301) so the stateful
// catalog logic lives in one cohesive unit; the parent orchestrates the
// active-skill list and hands this composable two outward callbacks.
//
// The factory stays thin: it wires the refs and delegates every action to
// a small module-level function that receives the state bundle. That keeps
// each action independently small (and testable with a fake state).

import { computed, ref, type ComputedRef, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPost } from "../../utils/api";
import { pluginEndpoints } from "../api";
import type { SkillsEndpoints } from "./definition";
import { entryKey, catalogActionParams, type CatalogSource } from "./categories";
import { acquireActionKey, releaseActionKey } from "./actionLock";

type TranslateFn = ReturnType<typeof useI18n>["t"];

export interface CatalogEntry {
  slug: string;
  name: string;
  description: string;
  source: CatalogSource;
  alreadyActive: boolean;
  // External entries only — identify the source repo + skill folder so
  // star / preview / run-once can address them (slug alone is the derived
  // activeId, not enough to locate the catalog copy).
  repoId?: string;
  skillFolder?: string;
  repoUrl?: string;
}

export interface CatalogDetail {
  slug: string;
  source: CatalogSource;
  description: string;
  body: string;
}

export interface SkillCatalogDeps {
  /** Re-pull the active skill list after a star so the new entry shows. */
  refreshActiveList: () => Promise<void>;
  /** Clear the active-skill selection (mutually exclusive with catalog). */
  clearActiveSelection: () => void;
}

interface CatalogState {
  t: TranslateFn;
  endpoints: SkillsEndpoints;
  deps: SkillCatalogDeps;
  catalogPresets: Ref<CatalogEntry[]>;
  catalogExternal: Ref<CatalogEntry[]>;
  catalogError: Ref<string | null>;
  selectedCatalog: Ref<CatalogEntry | null>;
  catalogDetail: Ref<CatalogDetail | null>;
  catalogDetailLoading: Ref<boolean>;
  catalogActioningKey: Ref<string | null>;
}

export interface SkillCatalog {
  catalogPresets: Ref<CatalogEntry[]>;
  catalogExternal: Ref<CatalogEntry[]>;
  catalogError: Ref<string | null>;
  selectedCatalog: Ref<CatalogEntry | null>;
  catalogDetail: Ref<CatalogDetail | null>;
  catalogDetailLoading: Ref<boolean>;
  catalogActioningKey: Ref<string | null>;
  selectedCatalogKey: ComputedRef<string | null>;
  loadCatalog: () => Promise<void>;
  selectCatalogEntry: (entry: CatalogEntry) => Promise<void>;
  starCatalogEntry: (entry: CatalogEntry) => Promise<void>;
  clearSelection: () => void;
  clearSelectionIfRepo: (repoId: string) => void;
  reconcileAfterDelete: (name: string) => void;
  reset: () => void;
}

async function loadCatalog(state: CatalogState): Promise<void> {
  const response = await apiGet<{ entries: CatalogEntry[] }>(state.endpoints.catalogList.url);
  if (!response.ok) {
    state.catalogError.value = state.t("pluginManageSkills.errCatalogListFailed", { error: response.error });
    return;
  }
  state.catalogError.value = null;
  if (Array.isArray(response.data.entries)) {
    state.catalogPresets.value = response.data.entries.filter((entry) => entry.source === "preset");
    state.catalogExternal.value = response.data.entries.filter((entry) => entry.source === "external");
  }
}

async function fetchCatalogDetail(state: CatalogState, entry: CatalogEntry): Promise<CatalogDetail | null> {
  const response = await apiGet<{ detail: CatalogDetail }>(state.endpoints.catalogPreview.url, catalogActionParams(entry));
  if (!response.ok) {
    state.catalogError.value = state.t("pluginManageSkills.errCatalogPreviewFailed", { error: response.error });
    return null;
  }
  state.catalogError.value = null;
  return response.data.detail;
}

// After a star both lists reload; reconcile the right-pane selection with
// the refreshed pool so its `alreadyActive` flag reflects reality without
// forcing the user to re-click.
function reconcileSelectionAfterStar(state: CatalogState, entry: CatalogEntry): void {
  const { selectedCatalog } = state;
  if (!selectedCatalog.value || entryKey(selectedCatalog.value) !== entryKey(entry)) return;
  const pool = entry.source === "external" ? state.catalogExternal.value : state.catalogPresets.value;
  const updated = pool.find((candidate) => entryKey(candidate) === entryKey(entry));
  if (updated) selectedCatalog.value = updated;
}

async function starCatalogEntry(state: CatalogState, entry: CatalogEntry): Promise<void> {
  if (entry.alreadyActive) return;
  const key = entryKey(entry);
  // Acquire only when idle: selecting another entry mid-flight and clicking
  // its Star would otherwise fire a second request whose completion clears
  // the lock while the first is still running.
  const { acquired, key: heldKey } = acquireActionKey(state.catalogActioningKey.value, key);
  if (!acquired) return;
  state.catalogActioningKey.value = heldKey;
  try {
    const response = await apiPost<{ starred: true; slug: string }>(state.endpoints.catalogStar.url, catalogActionParams(entry));
    if (!response.ok) {
      state.catalogError.value = state.t("pluginManageSkills.errCatalogStarFailed", { error: response.error });
      return;
    }
    state.catalogError.value = null;
    // Hold the lock through the refresh so the button can't be re-clicked
    // before `alreadyActive` flips.
    await Promise.all([loadCatalog(state), state.deps.refreshActiveList()]);
    reconcileSelectionAfterStar(state, entry);
  } finally {
    // Release only if we still own it (defensive; the idle-guard already
    // prevents a takeover).
    state.catalogActioningKey.value = releaseActionKey(state.catalogActioningKey.value, key);
  }
}

async function selectCatalogEntry(state: CatalogState, entry: CatalogEntry): Promise<void> {
  state.deps.clearActiveSelection();
  state.selectedCatalog.value = entry;
  state.catalogDetail.value = null;
  state.catalogDetailLoading.value = true;
  const keyAtRequest = entryKey(entry);
  const fetched = await fetchCatalogDetail(state, entry);
  // Selection may have changed while the request was in flight — drop the
  // response if so. Identity is the (repoId, skillFolder) composite for
  // external entries, not the lossy slug.
  if (!state.selectedCatalog.value || entryKey(state.selectedCatalog.value) !== keyAtRequest) return;
  state.catalogDetailLoading.value = false;
  if (fetched !== null) state.catalogDetail.value = fetched;
}

function clearCatalogSelection(state: CatalogState): void {
  state.selectedCatalog.value = null;
  state.catalogDetail.value = null;
}

function clearSelectionIfRepo(state: CatalogState, repoId: string): void {
  if (state.selectedCatalog.value?.repoId === repoId) clearCatalogSelection(state);
}

// A deleted (un-starred) preset reverts to ☆ Star: re-point the right pane
// at the refreshed catalog copy so its state stops lagging.
function reconcileAfterDelete(state: CatalogState, name: string): void {
  if (state.selectedCatalog.value?.slug !== name) return;
  const refreshed = state.catalogPresets.value.find((candidate) => candidate.slug === name);
  if (refreshed) state.selectedCatalog.value = refreshed;
}

function resetCatalog(state: CatalogState): void {
  clearCatalogSelection(state);
  state.catalogDetailLoading.value = false;
  state.catalogActioningKey.value = null;
  state.catalogError.value = null;
}

export function useSkillCatalog(deps: SkillCatalogDeps): SkillCatalog {
  const { t } = useI18n();
  const endpoints = pluginEndpoints<SkillsEndpoints>("skills");
  const catalogPresets = ref<CatalogEntry[]>([]);
  const catalogExternal = ref<CatalogEntry[]>([]);
  const catalogError = ref<string | null>(null);
  const selectedCatalog = ref<CatalogEntry | null>(null);
  const catalogDetail = ref<CatalogDetail | null>(null);
  const catalogDetailLoading = ref(false);
  // Single in-flight gate covers Star on the selected entry so a slow
  // request doesn't let the user fire a second action mid-flight.
  const catalogActioningKey = ref<string | null>(null);
  const selectedCatalogKey = computed(() => (selectedCatalog.value ? entryKey(selectedCatalog.value) : null));
  const state: CatalogState = {
    t,
    endpoints,
    deps,
    catalogPresets,
    catalogExternal,
    catalogError,
    selectedCatalog,
    catalogDetail,
    catalogDetailLoading,
    catalogActioningKey,
  };
  return {
    catalogPresets,
    catalogExternal,
    catalogError,
    selectedCatalog,
    catalogDetail,
    catalogDetailLoading,
    catalogActioningKey,
    selectedCatalogKey,
    loadCatalog: () => loadCatalog(state),
    selectCatalogEntry: (entry) => selectCatalogEntry(state, entry),
    starCatalogEntry: (entry) => starCatalogEntry(state, entry),
    clearSelection: () => clearCatalogSelection(state),
    clearSelectionIfRepo: (repoId) => clearSelectionIfRepo(state, repoId),
    reconcileAfterDelete: (name) => reconcileAfterDelete(state, name),
    reset: () => resetCatalog(state),
  };
}
