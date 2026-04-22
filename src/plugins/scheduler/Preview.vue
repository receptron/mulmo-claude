<template>
  <div class="p-2 text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span>📅</span>
      <span>{{ upcomingItems.length }} upcoming</span>
    </div>
    <div v-for="item in preview" :key="item.id" class="text-xs truncate text-gray-600">
      <span v-if="item.props.date" class="text-gray-400 mr-1">{{ item.props.date }}</span>
      {{ item.title }}
    </div>
    <div v-if="more > 0" class="text-xs text-gray-400">+ {{ more }} more…</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SchedulerData, ScheduledItem } from "./index";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import { API_ROUTES } from "../../config/apiRoutes";

const props = defineProps<{ result: ToolResultComplete<SchedulerData> }>();

const items = ref<ScheduledItem[]>(props.result.data?.items ?? []);

const { refresh } = useFreshPluginData<ScheduledItem[]>({
  endpoint: () => API_ROUTES.scheduler.base,
  extract: (json) => {
    const extracted = (json as { data?: { items?: ScheduledItem[] } }).data?.items;
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

const today = new Date().toISOString().slice(0, 10);

const upcomingItems = computed(() => {
  const withDate: ScheduledItem[] = [];
  const noDate: ScheduledItem[] = [];

  for (const item of items.value) {
    const dateVal = item.props.date;
    if (typeof dateVal === "string") {
      if (dateVal >= today) withDate.push(item);
    } else {
      noDate.push(item);
    }
  }

  withDate.sort((itemA, itemB) => (String(itemA.props.date) < String(itemB.props.date) ? -1 : 1));

  return [...withDate, ...noDate];
});

const preview = computed(() => upcomingItems.value.slice(0, 3));
const more = computed(() => Math.max(0, upcomingItems.value.length - 3));
</script>
