<template>
  <div class="text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span>☑</span>
      <span>{{ completedCount }}/{{ items.length }} completed</span>
    </div>
    <div
      v-for="item in preview"
      :key="item.id"
      class="text-xs truncate"
      :class="item.completed ? 'line-through text-gray-400' : 'text-gray-600'"
    >
      {{ item.completed ? "✓" : "○" }} {{ item.text }}
    </div>
    <div v-if="more > 0" class="text-xs text-gray-400">+ {{ more }} more…</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TodoData, TodoItem } from "./index";

const props = defineProps<{ result: ToolResultComplete<TodoData> }>();

const items = ref<TodoItem[]>(props.result.data?.items ?? []);

watch(
  () => props.result.data?.items,
  (newItems) => {
    if (newItems) items.value = newItems;
  },
);

onMounted(async () => {
  try {
    const res = await fetch("/api/todos");
    if (res.ok) {
      const json: { data: { items: TodoItem[] } } = await res.json();
      items.value = json.data?.items ?? [];
    }
  } catch {
    // Fall back to prop data
  }
});
const completedCount = computed(
  () => items.value.filter((i) => i.completed).length,
);
const preview = computed(() => items.value.slice(0, 3));
const more = computed(() => Math.max(0, items.value.length - 3));
</script>
