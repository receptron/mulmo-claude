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
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TodoData } from "./index";
import { PREVIEW_ITEM_COUNT } from "../../config/ui";

const props = defineProps<{ result: ToolResultComplete<TodoData> }>();

const items = computed(() => props.result.data?.items ?? []);
const completedCount = computed(
  () => items.value.filter((i) => i.completed).length,
);
const preview = computed(() => items.value.slice(0, PREVIEW_ITEM_COUNT));
const more = computed(() =>
  Math.max(0, items.value.length - PREVIEW_ITEM_COUNT),
);
</script>
