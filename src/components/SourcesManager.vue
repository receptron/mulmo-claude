<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="px-3 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between gap-2">
      <span class="text-sm font-medium text-gray-700 truncate"> {{ t("pluginManageSource.heading") }} </span>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs text-gray-500"> {{ t("pluginManageSource.sourceCount", sources.length, { named: { count: sources.length } }) }} </span>
        <button
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          :disabled="initialLoading || initialLoadError !== null || adding || busy === 'rebuild'"
          data-testid="sources-add-btn"
          @click="startAdd"
        >
          <span class="material-icons text-sm">add</span>
          {{ t("pluginManageSource.addButton") }}
        </button>
        <button
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          :disabled="initialLoading || initialLoadError !== null || busy === 'rebuild'"
          data-testid="sources-rebuild-btn"
          @click="rebuild"
        >
          <span class="material-icons text-sm">refresh</span>
          {{ busy === "rebuild" ? t("pluginManageSource.rebuilding") : t("pluginManageSource.rebuildNow") }}
        </button>
      </div>
    </div>

    <div v-if="adding" class="px-4 py-3 border-b border-blue-200 bg-blue-50/50 shrink-0 space-y-2" data-testid="sources-add-form">
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs text-gray-700">
          {{ t("pluginManageSource.typeField") }}
          <select v-model="draft.kind" class="ml-1 text-xs border border-gray-300 rounded px-1 py-0.5" data-testid="sources-draft-kind" @change="onKindChange">
            <option value="rss">{{ t("pluginManageSource.kindRss") }}</option>
            <option value="github-releases">{{ t("pluginManageSource.kindGithubReleases") }}</option>
            <option value="github-issues">{{ t("pluginManageSource.kindGithubIssues") }}</option>
            <option value="arxiv">{{ t("pluginManageSource.kindArxiv") }}</option>
          </select>
        </label>
        <input
          v-model="draft.primary"
          class="flex-1 min-w-[12rem] text-xs border border-gray-300 rounded px-2 py-1 font-mono"
          :placeholder="primaryPlaceholder"
          data-testid="sources-draft-primary"
          @keydown.enter="commitAdd"
        />
        <input
          v-model="draft.title"
          class="w-40 text-xs border border-gray-300 rounded px-2 py-1"
          :placeholder="t('pluginManageSource.titlePlaceholder')"
          data-testid="sources-draft-title"
          @keydown.enter="commitAdd"
        />
      </div>
      <div class="flex items-center justify-between text-xs">
        <span class="text-gray-500">
          {{ primaryHint }}
        </span>
        <div class="flex gap-2">
          <button class="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50" data-testid="sources-draft-cancel" @click="cancelAdd">
            {{ t("common.cancel") }}
          </button>
          <button
            class="px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
            :disabled="busy === 'add' || !draft.primary.trim()"
            data-testid="sources-draft-add"
            @click="commitAdd"
          >
            {{ busy === "add" ? t("pluginManageSource.addingLabel") : t("pluginManageSource.addAndRebuild") }}
          </button>
        </div>
      </div>
      <div v-if="draftError" class="text-xs text-red-600" data-testid="sources-draft-error">
        {{ draftError }}
      </div>
    </div>

    <div
      v-if="actionMessage"
      class="px-4 py-2 text-xs border-b shrink-0"
      :class="actionError ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'"
      data-testid="sources-action-message"
    >
      {{ actionMessage }}
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- Page-mode gate: hide empty state + preset buttons until the
           initial fetch completes, so users can't register presets
           against a still-empty local list (would re-POST slugs the
           server already has). Failed loads stay gated too — empty
           local state in that case means "unknown", not "zero". -->
      <div v-if="initialLoading" class="flex items-center justify-center h-full p-6" data-testid="sources-initial-loading">
        <span class="text-sm text-gray-500 italic">{{ t("pluginManageSource.initialLoading") }}</span>
      </div>
      <div v-else-if="initialLoadError" class="flex flex-col items-center justify-center h-full p-6 gap-3" data-testid="sources-initial-error">
        <span class="text-sm text-red-600">{{ t("pluginManageSource.initialLoadFailed") }}</span>
        <span class="text-xs text-gray-500 max-w-md text-center">{{ initialLoadError }}</span>
        <button
          class="px-3 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
          :disabled="initialLoading"
          data-testid="sources-initial-retry"
          @click="retryInitialLoad"
        >
          {{ t("pluginManageSource.retryLabel") }}
        </button>
      </div>
      <div v-else-if="sources.length === 0" class="flex flex-col items-center justify-center h-full p-6 gap-4" data-testid="sources-empty">
        <i18n-t keypath="pluginManageSource.emptyPickPack" tag="p" class="text-sm text-gray-500 italic text-center max-w-md">
          <template #addBold>
            <strong>{{ t("pluginManageSource.emptyAddStrong") }}</strong>
          </template>
        </i18n-t>
        <div class="w-full max-w-md space-y-2" data-testid="sources-presets">
          <button
            v-for="preset in PRESETS"
            :key="preset.id"
            class="w-full text-left border border-gray-200 rounded-lg p-3 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-gray-200"
            :disabled="busy === 'preset-' + preset.id"
            :data-testid="`sources-preset-${preset.id}`"
            @click="installPreset(preset)"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-sm font-medium text-gray-800">
                {{ preset.label }}
              </span>
              <span class="text-[11px] text-gray-500 shrink-0">
                {{ t("pluginManageSource.sourceCount", preset.entries.length, { named: { count: preset.entries.length } }) }}
              </span>
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {{ preset.description }}
            </div>
            <div v-if="busy === 'preset-' + preset.id" class="text-xs text-blue-600 mt-1 italic">{{ t("pluginManageSource.registering") }}</div>
          </button>
        </div>
      </div>
      <template v-else>
        <!-- Filter chip row (#768). Hidden when no sources are
             registered — the empty/preset state above already owns
             the screen. Single-select; clicking a chip replaces the
             active filter rather than toggling. -->
        <div
          v-if="sources.length > 0"
          class="px-4 py-2 border-b border-gray-100 flex flex-wrap items-center gap-1.5 shrink-0"
          data-testid="sources-filter"
          role="toolbar"
          :aria-label="t('pluginManageSource.filter.all')"
        >
          <FilterChip
            v-for="key in visibleFilterKeys"
            :key="key"
            :active="filterKey === key"
            :label="filterChipLabel(key)"
            :count="filterCounts[key]"
            :data-testid="`sources-filter-chip-${key}`"
            @click="selectFilter(key)"
          />
        </div>

        <!-- Filter-only empty state. Distinct from the no-sources
             empty state above: here the user has registered sources
             but the active chip has zero matches — offer a single
             "Clear filter" affordance. -->
        <div
          v-if="sources.length > 0 && filteredSources.length === 0"
          class="flex flex-col items-center justify-center p-6 gap-3"
          data-testid="sources-filter-empty"
        >
          <span class="text-sm text-gray-500 italic">{{ t("pluginManageSource.filter.noMatching") }}</span>
          <button
            class="text-xs px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
            data-testid="sources-filter-clear"
            @click="clearFilter"
          >
            {{ t("pluginManageSource.filter.clearFilter") }}
          </button>
        </div>

        <ul v-if="filteredSources.length > 0" class="divide-y divide-gray-100 border-b border-gray-100">
          <li
            v-for="source in filteredSources"
            :key="source.slug"
            class="px-4 py-3 flex items-start gap-3"
            :class="{
              'bg-amber-50': source.slug === highlightSlug,
            }"
            :data-testid="`source-row-${source.slug}`"
          >
            <span class="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 mt-0.5 shrink-0" :class="kindBadgeClass(source.fetcherKind)">
              {{ kindLabel(source.fetcherKind) }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <a :href="source.url" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-blue-700 hover:underline truncate">
                  {{ source.title }}
                </a>
                <code class="text-[11px] text-gray-400 shrink-0">
                  {{ source.slug }}
                </code>
              </div>
              <div class="text-xs text-gray-500 truncate">
                {{ source.url }}
              </div>
              <div v-if="source.categories.length > 0" class="mt-1 flex flex-wrap gap-1">
                <span v-for="cat in source.categories" :key="cat" class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                  {{ cat }}
                </span>
              </div>
              <div v-if="source.notes" class="mt-1 text-xs text-gray-600 italic">
                {{ source.notes }}
              </div>
            </div>
            <button
              class="text-xs text-red-600 hover:text-red-800 shrink-0 disabled:opacity-50"
              :disabled="busy === source.slug"
              :data-testid="`source-remove-${source.slug}`"
              @click="remove(source.slug)"
            >
              {{ busy === source.slug ? t("pluginManageSource.removingLabel") : t("pluginManageSource.removeLabel") }}
            </button>
          </li>
        </ul>
      </template>

      <!-- Today's brief. Auto-fetched on mount and refreshed after
           every Rebuild. Rendered as markdown so lists / headings
           feel like a document, not a dump. -->
      <div v-if="sources.length > 0 && (briefLoading || briefHtml || briefError)" class="p-4" data-testid="sources-brief">
        <div class="flex items-baseline justify-between mb-2">
          <h3 class="text-sm font-semibold text-gray-800">
            {{ t("pluginManageSource.todaysBrief") }}
            <span v-if="briefDate" class="text-xs text-gray-400 font-normal"> {{ t("pluginManageSource.briefDateLabel", { date: briefDate }) }} </span>
          </h3>
          <button v-if="briefFilePath" class="text-[11px] text-gray-500 hover:text-gray-700" :title="briefFilePath">
            {{ briefFilePath }}
          </button>
        </div>
        <div v-if="briefLoading" class="text-xs text-gray-500 italic">{{ t("pluginManageSource.todaysBriefLoading") }}</div>
        <div v-else-if="briefError" class="text-xs text-gray-500 italic" data-testid="sources-brief-empty">
          {{ briefError }}
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else class="markdown-content" v-html="briefHtml" />
      </div>
    </div>

    <div v-if="lastRebuild" class="px-4 py-2 border-t border-gray-100 shrink-0 text-xs text-gray-600" data-testid="sources-rebuild-summary">
      {{
        t("pluginManageSource.lastRebuildSummary", {
          date: lastRebuild.isoDate,
          itemCount: lastRebuild.itemCount,
          planned: lastRebuild.plannedCount,
          duplicates: lastRebuild.duplicateCount,
        })
      }}
      <span v-if="lastRebuild.archiveErrors.length > 0" class="text-red-600">
        {{ t("pluginManageSource.archiveErrorsSuffix", { count: lastRebuild.archiveErrors.length }) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ManageSourceData, RebuildSummary, Source } from "../plugins/manageSource/index";
import { apiGet, apiPost, apiDelete } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { SOURCE_FILTER_KEYS, countByFilter, matchesSourceFilter, type SourceFilterKey } from "../utils/sources/filter";
import FilterChip from "./FilterChip.vue";

const { t } = useI18n();

// Explicit mode — the null-vs-undefined `initialData` heuristic was
// fragile: a `manageSource` tool result that failed on the server
// leaves `selectedResult.data === undefined`, which would previously
// fall through to page-mode and trigger a live refreshList(), hiding
// the fact that the tool call failed. An explicit prop keeps plugin
// context (seed-driven, no mount fetch) and page context (mount
// fetch + loading gate) visibly distinct. See PR #676 review.
const props = defineProps<{
  mode: "page" | "plugin";
  initialData?: ManageSourceData | null;
}>();

const localSources = ref<Source[] | null>(props.initialData?.sources ?? null);
const lastRebuild = ref<RebuildSummary | null>(props.initialData?.lastRebuild ?? null);
const highlightSlugLocal = ref<string | null>(props.initialData?.highlightSlug ?? null);
const actionMessage = ref("");
const actionError = ref(false);
// Tracks the current button-driven request: "rebuild", "add", or a
// slug (Remove). Used to disable/relabel the matching button.
const busy = ref<string | null>(null);
// Page-mode initial-fetch gate. Prevents the user from pressing
// Add / presets / Rebuild before `GET /api/sources` resolves —
// otherwise `installPreset()` checks `sources.value` against an
// empty set and re-POSTs slugs the server already has.
//
// `initialLoadError` distinguishes "load finished, list really is
// empty" from "load failed, list is unknown". Without this split,
// a 500 on the first GET would release the gate with sources===[],
// letting the same double-register happen the gate was added to
// prevent. See PR #676 follow-up review.
const initialLoading = ref(props.mode === "page");
const initialLoadError = ref<string | null>(null);

// --- Add source form state ---------------------------------------------

type DraftKind = "rss" | "github-releases" | "github-issues" | "arxiv";
interface DraftState {
  kind: DraftKind;
  primary: string; // Feed URL / repo URL / repo slug / arxiv query
  title: string;
}

const adding = ref(false);
const draft = ref<DraftState>(emptyDraft());
const draftError = ref("");

function emptyDraft(): DraftState {
  return { kind: "rss", primary: "", title: "" };
}

function startAdd(): void {
  draft.value = emptyDraft();
  draftError.value = "";
  adding.value = true;
}

function cancelAdd(): void {
  adding.value = false;
  draftError.value = "";
}

function onKindChange(): void {
  draftError.value = "";
}

const primaryPlaceholder = computed(() => {
  switch (draft.value.kind) {
    case "rss":
      return t("pluginManageSource.primaryRssPlaceholder");
    case "github-releases":
    case "github-issues":
      return t("pluginManageSource.primaryGithubPlaceholder");
    case "arxiv":
      return t("pluginManageSource.primaryArxivPlaceholder");
  }
  return "";
});

const primaryHint = computed(() => {
  switch (draft.value.kind) {
    case "rss":
      return t("pluginManageSource.primaryRssHint");
    case "github-releases":
      return t("pluginManageSource.primaryGithubRelHint");
    case "github-issues":
      return t("pluginManageSource.primaryGithubIssHint");
    case "arxiv":
      return t("pluginManageSource.primaryArxivHint");
  }
  return "";
});

// Extract owner/repo from either a full github.com URL or a bare
// "owner/repo" string. Returns null when the input doesn't look
// like a recognisable GitHub repo.
function parseRepoSlug(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)/i);
  if (urlMatch) return `${urlMatch[1]}/${urlMatch[2].replace(/\.git$/, "")}`;
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) return trimmed.replace(/\.git$/, "");
  return null;
}

// Build the /api/sources body from the draft. Returns an error
// string when the input is invalid for the chosen kind.
interface RegisterPayload {
  title: string;
  url: string;
  fetcherKind: DraftKind;
  fetcherParams: Record<string, string>;
}

// Error returns are i18n keys (not literal strings) so commitAdd
// can resolve them with t() at the call site — keeps
// SourcesManager's validation pure and the error messages
// translatable across all 8 locales.
interface BuildError {
  errorKey: string;
}

function buildRegisterPayload(input: DraftState): RegisterPayload | BuildError {
  const primary = input.primary.trim();
  const title = input.title.trim();
  if (!primary) return { errorKey: "pluginManageSource.errPrimaryRequired" };
  switch (input.kind) {
    case "rss": {
      if (!/^https?:\/\//i.test(primary)) {
        return { errorKey: "pluginManageSource.errRssUrlProtocol" };
      }
      let hostname: string;
      try {
        hostname = new URL(primary).hostname;
      } catch {
        return { errorKey: "pluginManageSource.errRssUrlInvalid" };
      }
      if (!hostname) {
        return { errorKey: "pluginManageSource.errRssUrlHost" };
      }
      return {
        title: title || hostname,
        url: primary,
        fetcherKind: "rss",
        fetcherParams: { rss_url: primary },
      };
    }
    case "github-releases":
    case "github-issues": {
      const slug = parseRepoSlug(primary);
      if (!slug) {
        return { errorKey: "pluginManageSource.errGithubInvalid" };
      }
      return {
        title: title || slug,
        url: `https://github.com/${slug}`,
        fetcherKind: input.kind,
        fetcherParams: { github_repo: slug },
      };
    }
    case "arxiv": {
      const query = primary;
      return {
        title: title || `arXiv: ${query}`,
        url: `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}`,
        fetcherKind: "arxiv",
        fetcherParams: { arxiv_query: query },
      };
    }
  }
  return { errorKey: "pluginManageSource.errUnsupportedKind" };
}

async function commitAdd(): Promise<void> {
  const payload = buildRegisterPayload(draft.value);
  if ("errorKey" in payload) {
    draftError.value = t(payload.errorKey);
    return;
  }
  draftError.value = "";
  busy.value = "add";
  const response = await apiPost<unknown>(API_ROUTES.sources.create, payload);
  if (!response.ok) {
    draftError.value = response.error || t("pluginManageSource.flashRegisterFailed");
    busy.value = null;
    return;
  }
  flash(t("pluginManageSource.flashRegistered"));
  adding.value = false;
  await refreshList();
  // C: auto-rebuild so the user sees items without an extra click.
  busy.value = "rebuild";
  await rebuildInline();
  busy.value = null;
}

// --- Starter-pack presets ----------------------------------------------

interface PresetEntry {
  slug: string;
  title: string;
  url: string;
  fetcherKind: "rss" | "github-releases" | "github-issues" | "arxiv";
  fetcherParams: Record<string, string>;
  categories?: string[];
}

interface Preset {
  id: string;
  label: string;
  description: string;
  entries: PresetEntry[];
}

const PRESETS: Preset[] = [
  {
    id: "tech-news",
    label: "Tech news",
    description: "Hacker News front page — daily tech headlines.",
    entries: [
      {
        slug: "hacker-news",
        title: "Hacker News",
        url: "https://news.ycombinator.com/rss",
        fetcherKind: "rss",
        fetcherParams: { rss_url: "https://news.ycombinator.com/rss" },
        categories: ["tech-news", "startup"],
      },
    ],
  },
  {
    id: "ai-research",
    label: "AI research",
    description: "Latest arXiv papers in NLP (cs.CL) and machine learning (cs.LG).",
    entries: [
      {
        slug: "arxiv-cs-cl",
        title: "arXiv cs.CL",
        url: "https://export.arxiv.org/api/query?search_query=cat:cs.CL",
        fetcherKind: "arxiv",
        fetcherParams: { arxiv_query: "cat:cs.CL" },
        categories: ["ai", "research"],
      },
      {
        slug: "arxiv-cs-lg",
        title: "arXiv cs.LG",
        url: "https://export.arxiv.org/api/query?search_query=cat:cs.LG",
        fetcherKind: "arxiv",
        fetcherParams: { arxiv_query: "cat:cs.LG" },
        categories: ["ai", "research"],
      },
    ],
  },
  {
    id: "claude-code",
    label: "Claude Code updates",
    description: "New releases of the Claude Code CLI from the anthropics/claude-code repo.",
    entries: [
      {
        slug: "claude-code-releases",
        title: "Claude Code releases",
        url: "https://github.com/anthropics/claude-code",
        fetcherKind: "github-releases",
        fetcherParams: { github_repo: "anthropics/claude-code" },
        categories: ["ai", "tech-news"],
      },
    ],
  },
];

async function installPreset(preset: Preset): Promise<void> {
  busy.value = `preset-${preset.id}`;
  const alreadyHave = new Set(sources.value.map((source) => source.slug));
  const toRegister = preset.entries.filter((entry) => !alreadyHave.has(entry.slug));
  if (toRegister.length === 0) {
    flash(t("pluginManageSource.flashPresetAlreadyRegistered", { label: preset.label }));
    busy.value = null;
    return;
  }
  const failures: string[] = [];
  for (const entry of toRegister) {
    const response = await apiPost<unknown>(API_ROUTES.sources.create, {
      slug: entry.slug,
      title: entry.title,
      url: entry.url,
      fetcherKind: entry.fetcherKind,
      fetcherParams: entry.fetcherParams,
      // Presets know their categories — skip the classifier
      // CLI call so the first brief is ready sooner.
      categories: entry.categories,
      skipClassify: true,
    });
    if (!response.ok) {
      failures.push(`${entry.slug}: ${response.error}`);
    }
  }
  const okCount = toRegister.length - failures.length;
  if (failures.length > 0) {
    flash(
      t("pluginManageSource.flashPresetPartial", {
        ok: okCount,
        total: toRegister.length,
        errors: failures.join("; "),
      }),
      true,
    );
  } else {
    flash(t("pluginManageSource.flashPresetRegistered", toRegister.length, { named: { count: toRegister.length, label: preset.label } }));
  }
  // Skip the rebuild round-trip when nothing was actually registered
  // (every attempt failed) — refreshList is still useful to pick up
  // any server-side changes from before this click.
  await refreshList();
  if (okCount > 0) {
    await rebuildInline();
  }
  busy.value = null;
}

// Rebuild step extracted so commitAdd can chain it without recursing
// into rebuild()'s own busy-state machine.
async function rebuildInline(): Promise<void> {
  const response = await apiPost<RebuildSummary>(API_ROUTES.sources.rebuild);
  if (!response.ok) {
    flash(t("pluginManageSource.flashRegisterSucceededRebuildFailed", { error: response.error }), true);
    return;
  }
  const summary = response.data;
  lastRebuild.value = summary;
  flash(t("pluginManageSource.flashRebuildReady", summary.plannedCount, { named: { itemCount: summary.itemCount, planned: summary.plannedCount } }));
  await loadBrief(summary.isoDate);
}

const sources = computed<Source[]>(() => localSources.value ?? []);
const highlightSlug = computed(() => highlightSlugLocal.value);

// Filter chip state (#768). Single-select. `all` is the implicit
// default; clicking a chip replaces the active filter rather than
// toggling — the chip group is mutually exclusive across kind and
// schedule, so users always see the current bucket without
// remembering compound state.
const filterKey = ref<SourceFilterKey>("all");
const filteredSources = computed<Source[]>(() => sources.value.filter((source) => matchesSourceFilter(source, filterKey.value)));
const filterCounts = computed(() => countByFilter(sources.value));
// Hide chips for buckets that match zero sources so the chip row
// stays compact. `all` is always shown — it's the reset target.
const visibleFilterKeys = computed<readonly SourceFilterKey[]>(() => SOURCE_FILTER_KEYS.filter((key) => key === "all" || filterCounts.value[key] > 0));

function filterChipLabel(key: SourceFilterKey): string {
  switch (key) {
    case "all":
      return t("pluginManageSource.filter.all");
    case "rss":
      return t("pluginManageSource.filter.rss");
    case "github":
      return t("pluginManageSource.filter.github");
    case "arxiv":
      return t("pluginManageSource.filter.arxiv");
    case "schedule:daily":
      return t("pluginManageSource.filter.scheduleDaily");
    case "schedule:weekly":
      return t("pluginManageSource.filter.scheduleWeekly");
    case "schedule:manual":
      return t("pluginManageSource.filter.scheduleManual");
  }
}

function selectFilter(key: SourceFilterKey): void {
  filterKey.value = key;
}

function clearFilter(): void {
  filterKey.value = "all";
}

// Re-seed local state when the plugin caller switches to a different
// tool result (initialData identity changes). Plugin-only — page mode
// has no seed and shouldn't react to identity changes on null.
//
// A `null` or absent `next` here means "no newer seed" (e.g. the
// plugin caller passed a failed tool result with no data). We
// intentionally keep the existing local mirror rather than clearing
// it — clearing would flash an empty list for a tool result that
// just happens to lack a `.data` field.
watch(
  () => props.initialData,
  (next) => {
    if (!next) return;
    localSources.value = next.sources ?? [];
    const nextRebuild = next.lastRebuild;
    if (nextRebuild && (!lastRebuild.value || nextRebuild.isoDate >= lastRebuild.value.isoDate)) {
      lastRebuild.value = nextRebuild;
    }
    highlightSlugLocal.value = next.highlightSlug ?? null;
  },
);

function kindLabel(kind: Source["fetcherKind"]): string {
  switch (kind) {
    case "rss":
      return t("pluginManageSource.kindRss");
    case "github-releases":
      return t("pluginManageSource.kindGithubRel");
    case "github-issues":
      return t("pluginManageSource.kindGithubIss");
    case "arxiv":
      return t("pluginManageSource.kindArxiv");
  }
}

function kindBadgeClass(kind: Source["fetcherKind"]): string {
  switch (kind) {
    case "rss":
      return "bg-orange-100 text-orange-700";
    case "github-releases":
      return "bg-purple-100 text-purple-700";
    case "github-issues":
      return "bg-indigo-100 text-indigo-700";
    case "arxiv":
      return "bg-emerald-100 text-emerald-700";
  }
}

function flash(message: string, isError = false): void {
  actionMessage.value = message;
  actionError.value = isError;
  setTimeout(() => {
    if (actionMessage.value === message) actionMessage.value = "";
  }, 4000);
}

// Returns the server error string on failure so callers (e.g. the
// initial page-mode load) can keep that error visible in the UI
// rather than rely on the transient flash toast.
async function refreshList(): Promise<string | null> {
  const response = await apiGet<{ sources: Source[] }>(API_ROUTES.sources.list);
  if (!response.ok) {
    flash(t("pluginManageSource.flashRefreshListFailed", { error: response.error }), true);
    return response.error || t("pluginManageSource.initialLoadFailed");
  }
  localSources.value = response.data.sources;
  return null;
}

async function remove(slug: string): Promise<void> {
  if (!confirm(t("pluginManageSource.confirmRemove", { slug }))) return;
  busy.value = slug;
  const response = await apiDelete<unknown>(API_ROUTES.sources.remove.replace(":slug", encodeURIComponent(slug)));
  busy.value = null;
  if (!response.ok) {
    flash(t("pluginManageSource.flashRemoveFailed", { error: response.error }), true);
    return;
  }
  flash(t("pluginManageSource.flashRemoved", { slug }));
  await refreshList();
}

async function rebuild(): Promise<void> {
  busy.value = "rebuild";
  const response = await apiPost<RebuildSummary>(API_ROUTES.sources.rebuild);
  if (!response.ok) {
    flash(t("pluginManageSource.flashRebuildFailed", { error: response.error }), true);
    busy.value = null;
    return;
  }
  const summary = response.data;
  lastRebuild.value = summary;
  flash(t("pluginManageSource.flashRebuildComplete", { itemCount: summary.itemCount, planned: summary.plannedCount }));
  await Promise.all([refreshList(), loadBrief(summary.isoDate)]);
  busy.value = null;
}

// --- today's brief -------------------------------------------------------

// Fetched markdown (rendered via marked() into briefHtml below). Null
// while idle; "" after a confirmed empty/404 so the template can show
// a friendly message instead of a stuck spinner.
const briefMarkdown = ref<string | null>(null);
const briefError = ref("");
const briefLoading = ref(false);
const briefDate = ref("");
const briefFilePath = ref("");

// Build `news/daily/YYYY/MM/DD.md` from an ISO date. Local-time
// matches how the pipeline writes the file (see toLocalIsoDate).
function dailyPathFor(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `news/daily/${year}/${month}/${day}.md`;
}

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Monotonically-increasing token so concurrent loadBrief() calls
// (mount + rebuild + prop watch racing on slow networks) can drop
// stale responses that resolve after a newer one has already
// settled the state. Without this, an older fetch finishing last
// would clobber the latest brief.
let briefLoadToken = 0;

async function loadBrief(isoDate: string): Promise<void> {
  const token = ++briefLoadToken;
  briefLoading.value = true;
  briefError.value = "";
  briefDate.value = isoDate;
  const relPath = dailyPathFor(isoDate);
  briefFilePath.value = relPath;
  const response = await apiGet<{ content?: string; kind?: string }>(API_ROUTES.files.content, { path: relPath });
  if (token !== briefLoadToken) return;
  if (!response.ok) {
    if (response.status === 404) {
      briefMarkdown.value = "";
      briefError.value = t("pluginManageSource.briefNone");
    } else {
      briefError.value = response.error || t("pluginManageSource.briefLoadFailed");
    }
    briefLoading.value = false;
    return;
  }
  briefMarkdown.value = response.data.content ?? "";
  if (!briefMarkdown.value.trim()) {
    briefError.value = t("pluginManageSource.briefEmpty");
  }
  briefLoading.value = false;
}

// The daily file ends with a trailing ```json block that carries
// the structured item list for later machine consumption (Q2 of the
// plan: "Markdown + trailing fenced JSON block"). Strip it for the
// human-facing render so the UI doesn't dump a 1000-line JSON blob
// after the brief. The file on disk stays unchanged.
function stripTrailingJsonBlock(markdown: string): string {
  const marker = "\n```json\n";
  const idx = markdown.lastIndexOf(marker);
  if (idx < 0) return markdown;
  // Only strip if everything after the marker looks like it belongs
  // to that block (i.e. it's the last fenced block in the file).
  const tail = markdown.slice(idx);
  if (!tail.trimEnd().endsWith("```")) return markdown;
  return markdown.slice(0, idx).trimEnd();
}

const briefHtml = computed(() => {
  if (!briefMarkdown.value) return "";
  const body = stripTrailingJsonBlock(briefMarkdown.value);
  // marked() preserves raw HTML embedded in the markdown (RSS
  // content:encoded blocks often carry tracking pixels, iframes,
  // inline <script> from scraped sources). Sanitize before
  // binding to v-html.
  return DOMPurify.sanitize(marked(body) as string);
});

// Load on mount:
//   - page mode: fetch the source list via API first (with loading
//     gate so preset/add can't race an empty local state), then load
//     the brief for today.
//   - plugin mode: skip the list fetch — the tool-result seed (even
//     when .data is absent due to a failure) is authoritative until
//     the user clicks Rebuild/Remove/Add.
async function doInitialLoad(): Promise<void> {
  initialLoading.value = true;
  initialLoadError.value = null;
  try {
    initialLoadError.value = await refreshList();
  } finally {
    initialLoading.value = false;
  }
}

async function retryInitialLoad(): Promise<void> {
  await doInitialLoad();
  // Re-attempt the brief fetch too — a network blip that killed the
  // list also likely killed the brief, and we only hit this path on
  // the retry button, so users expect a full reload.
  const initial = lastRebuild.value?.isoDate ?? todayIsoDate();
  loadBrief(initial);
}

onMounted(async () => {
  if (props.mode === "page") {
    await doInitialLoad();
  }
  const initial = lastRebuild.value?.isoDate ?? todayIsoDate();
  loadBrief(initial);
});

// Re-fetch when the caller's seed brings a new rebuild summary
// (e.g. the LLM triggered another rebuild in the plugin context).
watch(
  () => props.initialData?.lastRebuild?.isoDate,
  (next) => {
    if (next && next !== briefDate.value) loadBrief(next);
  },
);
</script>
