<template>
  <div class="p-2 text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span aria-hidden="true">{{ t("todoPreview.headerIcon") }}</span>
      <span>{{ t("todoPreview.completedRatio", { done: completedCount, total: items.length }) }}</span>
    </div>
    <div
      v-for="item in preview"
      :key="item.id"
      class="text-xs truncate flex items-center gap-1"
      :class="item.completed ? 'line-through text-gray-400' : 'text-gray-600'"
    >
      <span class="shrink-0">{{ item.completed ? t("todoPreview.doneIcon") : t("todoPreview.pendingIcon") }}</span>
      <span class="truncate">{{ item.text }}</span>
      <template v-if="(item.labels?.length ?? 0) > 0">
        <span
          v-for="label in (item.labels ?? []).slice(0, 2)"
          :key="label"
          class="px-1 rounded-full text-[9px] font-medium shrink-0"
          :class="colorForLabel(label)"
          >{{ label }}</span
        >
        <span v-if="(item.labels?.length ?? 0) > 2" class="text-[9px] text-gray-400 shrink-0">{{
          t("todoPreview.moreLabels", { count: (item.labels?.length ?? 0) - 2 })
        }}</span>
      </template>
    </div>
    <div v-if="more > 0" class="text-xs text-gray-400">{{ t("todoPreview.moreItems", { count: more }) }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TodoData, TodoItem } from "./index";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import { API_ROUTES } from "../../config/apiRoutes";
import { colorForLabel } from "./labels";

const { t } = useI18n();

const props = defineProps<{ result: ToolResultComplete<TodoData> }>();

const items = ref<TodoItem[]>(props.result.data?.items ?? []);

const { refresh } = useFreshPluginData<TodoItem[]>({
  endpoint: () => API_ROUTES.todos.list,
  extract: (json) => {
    const extracted = (json as { data?: { items?: TodoItem[] } }).data?.items;
    return Array.isArray(extracted) ? extracted : null;
  },
  apply: (data) => {
    items.value = data;
  },
});

watch(
  () => props.result.uuid,
  () => {
    items.value = props.result.data?.items ?? [];
    void refresh();
  },
);
const completedCount = computed(() => items.value.filter((i) => i.completed).length);
const preview = computed(() => items.value.slice(0, 3));
const more = computed(() => Math.max(0, items.value.length - 3));
</script>
