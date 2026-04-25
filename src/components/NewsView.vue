<template>
  <div class="h-full flex flex-col bg-white" data-testid="news-view">
    <!-- Header: title + filter chips + actions. -->
    <div class="px-3 py-2 border-b border-gray-200 flex flex-wrap items-center gap-2 shrink-0">
      <h1 class="text-base font-semibold text-gray-900 mr-3">{{ t("pluginNews.title") }}</h1>
      <span class="text-xs text-gray-500" data-testid="news-counts">{{
        t("pluginNews.itemCount", {
          unread: unreadCount,
          total: items.length,
        })
      }}</span>
      <div class="ml-auto flex items-center gap-2">
        <div class="flex border border-gray-300 rounded overflow-hidden" role="tablist">
          <button
            v-for="filter in readFilterChoices"
            :key="filter.value"
            :class="[
              'h-8 px-2.5 flex items-center gap-1 text-sm transition-colors',
              readFilter === filter.value ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
            ]"
            :data-testid="`news-filter-${filter.value}`"
            :aria-pressed="readFilter === filter.value"
            @click="readFilter = filter.value"
          >
            {{ filter.label }}
          </button>
        </div>
        <button
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="unreadCount === 0"
          data-testid="news-mark-all-read"
          @click="markAllReadNow"
        >
          {{ t("pluginNews.markAllRead") }}
        </button>
      </div>
    </div>

    <!-- Source filter chip row (only sources with items). -->
    <div v-if="sourceChoices.length > 1" class="px-3 py-2 border-b border-gray-100 flex flex-wrap items-center gap-1 shrink-0">
      <FilterChip
        v-for="choice in sourceChoices"
        :key="choice.slug"
        :active="sourceFilter === choice.slug"
        :label="choice.label"
        :count="choice.count"
        :data-testid="`news-source-${choice.slug}`"
        @click="sourceFilter = choice.slug"
      />
    </div>

    <!-- Body: list (left) + detail (right). -->
    <div class="flex-1 min-h-0 flex">
      <!-- List pane -->
      <div class="w-80 shrink-0 border-r border-gray-200 overflow-y-auto" data-testid="news-list">
        <div v-if="loading" class="p-4 text-sm text-gray-400">{{ t("common.loading") }}</div>
        <div v-else-if="error" class="p-4 text-sm text-red-600 bg-red-50" role="alert">
          {{ t("pluginNews.loadError", { error }) }}
        </div>
        <div v-else-if="visibleItems.length === 0" class="p-4 text-sm text-gray-400">{{ t("pluginNews.empty") }}</div>
        <ul v-else class="divide-y divide-gray-100">
          <li
            v-for="item in visibleItems"
            :key="item.id"
            :class="['px-3 py-2 cursor-pointer', selectedId === item.id ? 'bg-blue-50' : 'hover:bg-gray-50']"
            :data-testid="`news-item-${item.id}`"
            @click="selectItem(item.id)"
          >
            <div class="flex items-start gap-2">
              <span
                v-if="!isRead(item.id)"
                class="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"
                :title="t('pluginNews.unread')"
                :aria-label="t('pluginNews.unread')"
              />
              <div class="min-w-0 flex-1">
                <div :class="['text-sm leading-snug', isRead(item.id) ? 'text-gray-500' : 'text-gray-900 font-medium']">
                  {{ item.title }}
                </div>
                <div class="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
                  <span class="truncate">{{ item.sourceSlug }}</span>
                  <span>{{ formatSmartTime(item.publishedAt) }}</span>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- Detail pane -->
      <div class="flex-1 min-w-0 overflow-y-auto" data-testid="news-detail">
        <div v-if="!selected" class="h-full flex items-center justify-center text-sm text-gray-400">
          {{ t("pluginNews.selectPrompt") }}
        </div>
        <div v-else class="px-6 py-4 max-w-3xl">
          <h2 class="text-xl font-semibold text-gray-900 leading-snug">{{ selected.title }}</h2>
          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>{{ selected.sourceSlug }}</span>
            <span>{{ formatSmartTime(selected.publishedAt) }}</span>
            <span v-for="cat in selected.categories" :key="cat" class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
              {{ cat }}
            </span>
          </div>
          <a
            :href="selected.url"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-3 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
            data-testid="news-open-original"
          >
            <span class="material-icons text-sm">open_in_new</span>
            {{ t("pluginNews.openOriginal") }}
          </a>
          <div class="mt-4">
            <div v-if="bodyLoading" class="text-sm text-gray-400">{{ t("common.loading") }}</div>
            <div v-else-if="bodyError" class="text-sm text-red-600">{{ t("pluginNews.bodyError", { error: bodyError }) }}</div>
            <div v-else-if="!body" class="text-sm text-gray-400 italic">{{ t("pluginNews.noBody") }}</div>
            <div v-else class="markdown-content prose prose-slate max-w-none" v-html="renderedBody"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import { useRoute } from "vue-router";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet } from "../utils/api";
import { formatSmartTime } from "../utils/format/date";
import { useNewsItems } from "../composables/useNewsItems";
import { useNewsReadState } from "../composables/useNewsReadState";
import FilterChip from "./FilterChip.vue";

const { t } = useI18n();
const route = useRoute();

const { items, loading, error, load: loadItems } = useNewsItems();
const { isRead, markRead, markAllRead, load: loadReadState } = useNewsReadState();

type ReadFilter = "all" | "unread";
const readFilter = ref<ReadFilter>("unread");
const sourceFilter = ref<string>("all");
const selectedId = ref<string | null>(null);
const body = ref<string | null>(null);
const bodyLoading = ref(false);
const bodyError = ref<string | null>(null);

const readFilterChoices = computed<{ value: ReadFilter; label: string }[]>(() => [
  { value: "unread", label: t("pluginNews.filterUnread") },
  { value: "all", label: t("pluginNews.filterAll") },
]);

const visibleItems = computed(() =>
  items.value.filter((item) => {
    if (readFilter.value === "unread" && isRead(item.id)) return false;
    if (sourceFilter.value !== "all" && item.sourceSlug !== sourceFilter.value) return false;
    return true;
  }),
);

// Source chips: derived from the current items list, sorted by
// per-source count desc so the busiest source surfaces first.
const sourceChoices = computed<{ slug: string; label: string; count: number }[]>(() => {
  const counts = new Map<string, number>();
  for (const item of items.value) {
    counts.set(item.sourceSlug, (counts.get(item.sourceSlug) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries())
    .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
    .map(([slug, count]) => ({ slug, label: slug, count }));
  return [{ slug: "all", label: t("pluginNews.allSources"), count: items.value.length }, ...sorted];
});

const unreadCount = computed(() => items.value.filter((item) => !isRead(item.id)).length);

const selected = computed(() => items.value.find((item) => item.id === selectedId.value) ?? null);

const renderedBody = computed(() => (body.value ? marked(body.value, { breaks: true, gfm: true }) : ""));

function selectItem(itemId: string): void {
  selectedId.value = itemId;
  // Auto mark-as-read on selection. Defer slightly so a rapid arrow-
  // key scroll doesn't burn through the unread queue accidentally —
  // we only mark when the user dwells on a card.
  setTimeout(() => {
    if (selectedId.value === itemId) markRead(itemId);
  }, 250);
}

function markAllReadNow(): void {
  markAllRead(items.value.map((item) => item.id));
}

// Body fetch fires whenever the selection changes. Cancellation via
// a token: a stale response just no-ops if the user moved on.
let bodyToken = 0;
watch(
  () => selectedId.value,
  async (itemId) => {
    body.value = null;
    bodyError.value = null;
    if (!itemId) return;
    bodyLoading.value = true;
    const token = ++bodyToken;
    const url = API_ROUTES.news.itemBody.replace(":id", encodeURIComponent(itemId));
    const result = await apiGet<{ body: string | null }>(url);
    if (token !== bodyToken) return;
    bodyLoading.value = false;
    if (!result.ok) {
      bodyError.value = result.error;
      return;
    }
    body.value = result.data.body;
  },
);

// Apply `?source=<slug>` deep link from the Sources page once items
// land — the sourceFilter only takes effect if the slug is one of
// the registered sources in the current items list.
function applyRouteSourceFilter(): void {
  const querySource = route.query.source;
  if (typeof querySource === "string" && querySource.length > 0) {
    sourceFilter.value = querySource;
  }
}

onMounted(async () => {
  applyRouteSourceFilter();
  await Promise.all([loadItems(), loadReadState()]);
});

watch(
  () => route.query.source,
  () => applyRouteSourceFilter(),
);
</script>
