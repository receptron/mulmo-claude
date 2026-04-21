<template>
  <div class="text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span class="material-icons" style="font-size: 14px">menu_book</span>
      <span>{{ label }}</span>
    </div>
    <div v-for="entry in previewEntries" :key="entry.slug" class="text-xs text-gray-500 truncate">
      {{ entry.title }}
    </div>
    <div v-if="more > 0" class="text-xs text-gray-400">+ {{ more }} more…</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WikiData, WikiPageEntry } from "./index";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import { API_ROUTES } from "../../config/apiRoutes";

const props = defineProps<{ result: ToolResultComplete<WikiData> }>();

const action = ref(props.result.data?.action ?? "index");
const title = ref(props.result.data?.title ?? "Wiki");
const pageEntries = ref<WikiPageEntry[]>(props.result.data?.pageEntries ?? []);

const { refresh } = useFreshPluginData<WikiData>({
  endpoint: () => API_ROUTES.wiki.base,
  extract: (json) => (json as { data?: WikiData }).data ?? null,
  apply: (data) => {
    // Bug fix (CodeRabbit V1 #6): /api/wiki (no slug) always
    // returns the index payload. The Preview component is reused
    // for page / log / lint_report previews as well, so blindly
    // overwriting action/title/pageEntries would clobber non-index
    // previews with "Wiki Index" the moment the fetch resolves.
    // Only apply when this preview is currently showing the index.
    if (action.value !== "index") return;
    title.value = data.title ?? "Wiki";
    pageEntries.value = data.pageEntries ?? [];
  },
});

watch(
  () => props.result.uuid,
  () => {
    const d = props.result.data;
    if (d) {
      action.value = d.action ?? "index";
      title.value = d.title ?? "Wiki";
      pageEntries.value = d.pageEntries ?? [];
    }
    void refresh();
  },
);

const label = computed(() => {
  if (action.value === "index") return `Wiki Index (${pageEntries.value.length} pages)`;
  if (action.value === "log") return "Wiki Log";
  if (action.value === "lint_report") return "Wiki Lint";
  return `Wiki: ${title.value}`;
});

const previewEntries = computed(() => pageEntries.value.slice(0, 3));
const more = computed(() => Math.max(0, pageEntries.value.length - 3));
</script>
