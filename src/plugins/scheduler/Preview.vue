<template>
  <div class="text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span>📅</span>
      <span>{{ upcomingItems.length }} upcoming</span>
    </div>
    <div
      v-for="item in preview"
      :key="item.id"
      class="text-xs truncate text-gray-600"
    >
      <span v-if="item.props.date" class="text-gray-400 mr-1">{{
        item.props.date
      }}</span>
      {{ item.title }}
    </div>
    <div v-if="more > 0" class="text-xs text-gray-400">+ {{ more }} more…</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SchedulerData, ScheduledItem } from "./index";

const props = defineProps<{ result: ToolResultComplete<SchedulerData> }>();

const items = ref<ScheduledItem[]>(props.result.data?.items ?? []);

watch(
  () => props.result.data?.items,
  (newItems) => {
    if (newItems) items.value = newItems;
  },
);

onMounted(async () => {
  try {
    const res = await fetch("/api/scheduler");
    if (res.ok) {
      const json: { data: { items: ScheduledItem[] } } = await res.json();
      items.value = json.data?.items ?? [];
    }
  } catch {
    // Fall back to prop data
  }
});

const today = new Date().toISOString().slice(0, 10);

const upcomingItems = computed(() => {
  const withDate: ScheduledItem[] = [];
  const noDate: ScheduledItem[] = [];

  for (const item of items.value) {
    const d = item.props.date;
    if (typeof d === "string") {
      if (d >= today) withDate.push(item);
    } else {
      noDate.push(item);
    }
  }

  withDate.sort((a, b) =>
    String(a.props.date) < String(b.props.date) ? -1 : 1,
  );

  return [...withDate, ...noDate];
});

const preview = computed(() => upcomingItems.value.slice(0, 3));
const more = computed(() => Math.max(0, upcomingItems.value.length - 3));
</script>
