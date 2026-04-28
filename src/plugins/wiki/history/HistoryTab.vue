<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatRelativeTime, formatSmartTime } from "../../../utils/format/date";
import { fetchHistoryList, type SnapshotSummary } from "./api";
import HistoryDetail from "./HistoryDetail.vue";

const props = defineProps<{
  slug: string;
  /** Live page body + frontmatter, supplied by the parent so the
   *  detail view can diff against the current state without an
   *  extra fetch. */
  currentBody: string;
  currentMeta: Record<string, unknown>;
}>();

const emit = defineEmits<{
  /** Bubbled up from the detail view after a successful restore.
   *  The parent (View.vue) handles the tab switch + success toast. */
  restored: [];
}>();

const { t } = useI18n();

const loading = ref(true);
const fetchError = ref<string | null>(null);
const snapshots = ref<SnapshotSummary[]>([]);
/** Per Q15=B, this state persists across `Content` ↔ `History` tab
 *  switches as long as the slug doesn't change. The parent keeps
 *  the History tab mounted via `v-show`. */
const selectedStamp = ref<string | null>(null);

// Stale-response guard (codex iter-1 #946). A user who switches
// slugs faster than the network responds would otherwise see a
// late list arrive and overwrite the new slug's state. Each load
// bumps the counter; resolutions whose token has been superseded
// drop on the floor.
let loadToken = 0;

onMounted(async () => {
  await loadList();
});

watch(
  () => props.slug,
  async (next, prev) => {
    if (next === prev) return;
    selectedStamp.value = null;
    await loadList();
  },
);

async function loadList(): Promise<void> {
  const myToken = ++loadToken;
  loading.value = true;
  fetchError.value = null;
  const result = await fetchHistoryList(props.slug);
  if (myToken !== loadToken) return;
  loading.value = false;
  if (!result.ok) {
    fetchError.value = result.error;
    snapshots.value = [];
    return;
  }
  snapshots.value = result.data.snapshots;
}

const selectedIndex = computed(() => {
  if (selectedStamp.value === null) return -1;
  return snapshots.value.findIndex((entry) => entry.stamp === selectedStamp.value);
});

const selectedSummary = computed<SnapshotSummary | null>(() => {
  const idx = selectedIndex.value;
  return idx === -1 ? null : snapshots.value[idx];
});

const previousSummary = computed<SnapshotSummary | null>(() => {
  // List is newest-first; `previous` (older) is at index+1.
  const idx = selectedIndex.value;
  if (idx === -1) return null;
  return snapshots.value[idx + 1] ?? null;
});

function selectStamp(stamp: string): void {
  selectedStamp.value = stamp;
}

function clearSelection(): void {
  selectedStamp.value = null;
}

function editorBadgeFor(editor: SnapshotSummary["editor"]): { label: string; className: string } {
  if (editor === "llm") {
    return { label: t("pluginWiki.history.editorBadgeLLM"), className: "bg-purple-50 text-purple-700" };
  }
  if (editor === "system") {
    return { label: t("pluginWiki.history.editorBadgeSystem"), className: "bg-gray-100 text-gray-700" };
  }
  return { label: t("pluginWiki.history.editorBadgeUser"), className: "bg-blue-50 text-blue-700" };
}

function onRestored(): void {
  emit("restored");
  // After restore we expect the parent to switch tabs and the new
  // restore snapshot is now the newest entry. Refresh the list so
  // returning to History reflects the new state.
  void loadList();
  selectedStamp.value = null;
}
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0" data-testid="wiki-history-tab">
    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
      <span class="material-icons animate-spin text-base mr-2">progress_activity</span>
      {{ t("pluginWiki.history.loading") }}
    </div>

    <!-- Fetch error -->
    <div v-else-if="fetchError" class="m-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="wiki-history-fetch-error">
      {{ fetchError }}
    </div>

    <!-- Detail view (Q15=B: persists when user toggles tabs) -->
    <HistoryDetail
      v-else-if="selectedSummary !== null"
      :slug="props.slug"
      :summary="selectedSummary"
      :previous-summary="previousSummary"
      :current-body="props.currentBody"
      :current-meta="props.currentMeta"
      @back="clearSelection"
      @restored="onRestored"
    />

    <!-- Empty state -->
    <div
      v-else-if="snapshots.length === 0"
      class="flex-1 flex items-center justify-center px-6 text-gray-400 text-sm text-center"
      data-testid="wiki-history-empty"
    >
      <p>{{ t("pluginWiki.history.empty") }}</p>
    </div>

    <!-- List view -->
    <div v-else class="flex-1 overflow-y-auto" data-testid="wiki-history-list">
      <button
        v-for="entry in snapshots"
        :key="entry.stamp"
        type="button"
        class="w-full text-left px-4 py-2 border-b border-gray-100 hover:bg-blue-50 transition-colors flex items-baseline gap-3"
        :data-testid="`wiki-history-row-${entry.stamp}`"
        @click="selectStamp(entry.stamp)"
      >
        <span :class="['inline-flex items-center px-2 h-5 rounded text-xs font-medium shrink-0', editorBadgeFor(entry.editor).className]">
          {{ editorBadgeFor(entry.editor).label }}
        </span>
        <span class="text-sm text-gray-700 shrink-0" :title="formatSmartTime(entry.ts)">
          {{ formatRelativeTime(entry.ts) }}
        </span>
        <span v-if="entry.reason" class="text-sm text-gray-500 truncate">{{ ` — ${entry.reason}` }}</span>
      </button>
    </div>
  </div>
</template>
