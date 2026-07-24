// External-repo cluster for the /skills catalog (#1383 PR-C2). Owns the
// installed-repo list, the per-repo collapse state, the add-repo modal,
// and the install / uninstall / update mutations. Lifted out of View.vue
// (#2301) as a leaf composable: it only calls OUTWARD (reload the catalog,
// refresh the active list, clear a catalog selection whose repo was
// removed) — nothing in the parent's selection core calls back in.
//
// The factory stays thin: it wires the refs and delegates every action to
// a small module-level function that receives the state bundle.

import { computed, ref, shallowRef, type ComputedRef, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPost, apiDelete } from "../../utils/api";
import { pluginEndpoints } from "../api";
import { buildRouteUrl } from "../meta-types";
import type { SkillsEndpoints } from "./definition";
import { loadRepoCollapsed, persistRepoCollapsed, groupEntriesByRepo, toggleInSet, buildRepoInstallBody } from "./categories";
import type { CatalogEntry } from "./useSkillCatalog";

type TranslateFn = ReturnType<typeof useI18n>["t"];

export interface ExternalRepo {
  repoId: string;
  url: string;
  subpath?: string;
  sha: string;
  installedAt: string;
}

export interface ExternalSuggestion {
  url: string;
  subpath?: string;
  displayName: string;
  description: string;
  license?: string;
}

export interface ExternalReposDeps {
  /** External catalog entries (owned by useSkillCatalog) — read for the
   *  per-repo grouping. */
  catalogExternal: Ref<CatalogEntry[]>;
  /** Shared catalog error surface (owned by useSkillCatalog) — written on
   *  uninstall / update failure so the error shows in the same place. */
  catalogError: Ref<string | null>;
  reloadCatalog: () => Promise<void>;
  refreshActiveList: () => Promise<void>;
  /** Drop the right-pane catalog selection when its source repo is
   *  uninstalled. */
  clearCatalogSelectionForRepo: (repoId: string) => void;
}

export interface ExternalReposGroup {
  repo: ExternalRepo;
  entries: CatalogEntry[];
}

// Single source of truth for the reactive fields: the private state bundle
// and the public surface both extend it, so a new Ref is declared once
// (#2481) instead of being mirrored into two lists that can drift apart.
interface ReposRefs {
  catalogRepos: Ref<ExternalRepo[]>;
  /** Per-repo collapse set (repoId ∈ set ⇒ collapsed). */
  repoCollapsed: Ref<Set<string>>;
  addRepoOpen: Ref<boolean>;
  addRepoUrl: Ref<string>;
  addRepoSubpath: Ref<string>;
  addRepoError: Ref<string | null>;
  addRepoBusy: Ref<boolean>;
  suggestions: Ref<ExternalSuggestion[]>;
  /** Which suggestion the user picked: drives the form prefill + the
   *  highlight. Selecting never installs — install stays explicit. */
  selectedSuggestionUrl: Ref<string | null>;
  uninstallingRepoId: Ref<string | null>;
  updatingRepoId: Ref<string | null>;
}

interface ReposState extends ReposRefs {
  t: TranslateFn;
  endpoints: SkillsEndpoints;
  deps: ExternalReposDeps;
}

export interface ExternalRepos extends ReposRefs {
  externalGroups: ComputedRef<ExternalReposGroup[]>;
  isRepoOpen: (repoId: string) => boolean;
  toggleRepo: (repoId: string) => void;
  loadExternalRepos: () => Promise<void>;
  openAddRepo: () => void;
  selectSuggestion: (suggestion: ExternalSuggestion) => void;
  installRepo: (url: string, subpath?: string) => Promise<void>;
  uninstallRepo: (repoId: string) => Promise<void>;
  updateRepo: (repo: ExternalRepo) => Promise<void>;
  resetModalState: () => void;
}

function isRepoOpen(state: ReposState, repoId: string): boolean {
  return !state.repoCollapsed.value.has(repoId);
}

function toggleRepo(state: ReposState, repoId: string): void {
  const next = toggleInSet(state.repoCollapsed.value, repoId);
  state.repoCollapsed.value = next;
  persistRepoCollapsed(next);
}

async function loadExternalRepos(state: ReposState): Promise<void> {
  const response = await apiGet<{ repos: ExternalRepo[] }>(state.endpoints.externalReposList.url);
  if (!response.ok) {
    state.deps.catalogError.value = state.t("pluginManageSkills.errCatalogRepoListFailed", { error: response.error });
    return;
  }
  if (Array.isArray(response.data.repos)) state.catalogRepos.value = response.data.repos;
}

async function loadSuggestions(state: ReposState): Promise<void> {
  const response = await apiGet<{ suggestions: ExternalSuggestion[] }>(state.endpoints.externalSuggestions.url);
  if (response.ok && Array.isArray(response.data.suggestions)) state.suggestions.value = response.data.suggestions;
}

function openAddRepo(state: ReposState): void {
  state.addRepoUrl.value = "";
  state.addRepoSubpath.value = "";
  state.addRepoError.value = null;
  state.selectedSuggestionUrl.value = null;
  state.addRepoOpen.value = true;
  if (state.suggestions.value.length === 0) void loadSuggestions(state);
}

// Prefill the form so the user can review then press Install. Deliberately
// does NOT install (avoids the one-click install footgun).
function selectSuggestion(state: ReposState, suggestion: ExternalSuggestion): void {
  state.addRepoUrl.value = suggestion.url;
  state.addRepoSubpath.value = suggestion.subpath ?? "";
  state.addRepoError.value = null;
  state.selectedSuggestionUrl.value = suggestion.url;
}

async function installRepo(state: ReposState, url: string, subpath?: string): Promise<void> {
  if (state.addRepoBusy.value) return;
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    state.addRepoError.value = state.t("pluginManageSkills.errCatalogRepoInvalidUrl");
    return;
  }
  state.addRepoBusy.value = true;
  state.addRepoError.value = null;
  try {
    const response = await apiPost<{ installed: true; repoId: string }>(state.endpoints.externalReposInstall.url, buildRepoInstallBody(trimmedUrl, subpath));
    if (!response.ok) {
      state.addRepoError.value = state.t("pluginManageSkills.errCatalogRepoInstallFailed", { error: response.error });
      return;
    }
    state.addRepoOpen.value = false;
    await Promise.all([loadExternalRepos(state), state.deps.reloadCatalog()]);
  } finally {
    state.addRepoBusy.value = false;
  }
}

async function uninstallRepo(state: ReposState, repoId: string): Promise<void> {
  // Bail if this repo is mid-update: uninstall + re-install interleave with
  // no server-side lock, so a delete during a slow update can be undone by
  // the update's re-copy (repo reappears), or leave a half-copied dir.
  if (state.uninstallingRepoId.value !== null || state.updatingRepoId.value === repoId) return;
  if (typeof window !== "undefined" && !window.confirm(state.t("pluginManageSkills.catalogUninstallConfirm"))) return;
  state.uninstallingRepoId.value = repoId;
  try {
    const response = await apiDelete<{ uninstalled: true }>(buildRouteUrl(state.endpoints.externalReposRemove, { repoId }));
    if (!response.ok) {
      state.deps.catalogError.value = state.t("pluginManageSkills.errCatalogRepoUninstallFailed", { error: response.error });
      return;
    }
    state.deps.catalogError.value = null;
    state.deps.clearCatalogSelectionForRepo(repoId);
    // Starred copies survive uninstall (backend-guaranteed, C1) — pull the
    // active list so any starred-from-this-repo rows stay visible.
    await Promise.all([loadExternalRepos(state), state.deps.reloadCatalog(), state.deps.refreshActiveList()]);
  } finally {
    state.uninstallingRepoId.value = null;
  }
}

// "Update" == re-install with the repo's recorded url/subpath. The install
// path re-fetches upstream HEAD, wipes + re-copies the catalog dir, and
// rewrites `.source.json`. Starred copies under `.claude/skills/` are
// untouched (catalog-layer only). try/finally so the in-flight gate always
// clears even if the request throws.
async function updateRepo(state: ReposState, repo: ExternalRepo): Promise<void> {
  // Bail if this repo is mid-uninstall (see uninstallRepo — same interleave).
  if (state.updatingRepoId.value !== null || state.uninstallingRepoId.value === repo.repoId) return;
  state.updatingRepoId.value = repo.repoId;
  try {
    const response = await apiPost<{ installed: true; repoId: string }>(state.endpoints.externalReposInstall.url, buildRepoInstallBody(repo.url, repo.subpath));
    if (!response.ok) {
      state.deps.catalogError.value = state.t("pluginManageSkills.errCatalogRepoInstallFailed", { error: response.error });
      return;
    }
    state.deps.catalogError.value = null;
    await Promise.all([loadExternalRepos(state), state.deps.reloadCatalog()]);
  } finally {
    state.updatingRepoId.value = null;
  }
}

function resetModalState(state: ReposState): void {
  state.addRepoOpen.value = false;
  state.addRepoError.value = null;
  state.selectedSuggestionUrl.value = null;
  state.uninstallingRepoId.value = null;
  state.updatingRepoId.value = null;
}

function createReposRefs(): ReposRefs {
  return {
    catalogRepos: ref<ExternalRepo[]>([]),
    // shallowRef: the Set is replaced wholesale on toggle, so the deep
    // proxy ref() would build is wasted.
    repoCollapsed: shallowRef<Set<string>>(loadRepoCollapsed()),
    addRepoOpen: ref(false),
    addRepoUrl: ref(""),
    addRepoSubpath: ref(""),
    addRepoError: ref<string | null>(null),
    addRepoBusy: ref(false),
    suggestions: ref<ExternalSuggestion[]>([]),
    selectedSuggestionUrl: ref<string | null>(null),
    uninstallingRepoId: ref<string | null>(null),
    updatingRepoId: ref<string | null>(null),
  };
}

export function useExternalRepos(deps: ExternalReposDeps): ExternalRepos {
  const { t } = useI18n();
  const endpoints = pluginEndpoints<SkillsEndpoints>("skills");
  // The same Ref instances back both the private state bundle and the
  // returned surface — spreading copies the Ref objects, not their values.
  const refs = createReposRefs();
  const state: ReposState = { t, endpoints, deps, ...refs };
  // External catalog entries grouped under their repo, in the repo order
  // returned by `/external/repos`. Repos with zero discoverable entries
  // still render so an install that found nothing is visible.
  const externalGroups = computed(() => groupEntriesByRepo(deps.catalogExternal.value, refs.catalogRepos.value));
  return {
    ...refs,
    externalGroups,
    isRepoOpen: (repoId) => isRepoOpen(state, repoId),
    toggleRepo: (repoId) => toggleRepo(state, repoId),
    loadExternalRepos: () => loadExternalRepos(state),
    openAddRepo: () => openAddRepo(state),
    selectSuggestion: (suggestion) => selectSuggestion(state, suggestion),
    installRepo: (url, subpath) => installRepo(state, url, subpath),
    uninstallRepo: (repoId) => uninstallRepo(state, repoId),
    updateRepo: (repo) => updateRepo(state, repo),
    resetModalState: () => resetModalState(state),
  };
}
