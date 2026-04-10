<template>
  <div class="text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span class="material-icons text-sm">history</span>
      <span
        >{{ results.length }} result{{ results.length === 1 ? "" : "s" }}</span
      >
    </div>
    <div class="text-xs text-gray-500 truncate">
      {{ query }}
    </div>
    <div
      v-for="result in topResults"
      :key="result.id"
      class="text-xs truncate text-gray-600 mt-0.5"
    >
      · {{ result.title || "(untitled)" }}
    </div>
    <div v-if="more > 0" class="text-xs text-gray-400">+ {{ more }} more…</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ChatHistorySearchData } from "./index";

const props = defineProps<{
  result: ToolResultComplete<ChatHistorySearchData>;
}>();

const query = computed(() => props.result.data?.query ?? "");
const results = computed(() => props.result.data?.results ?? []);
const topResults = computed(() => results.value.slice(0, 3));
const more = computed(() => Math.max(0, results.value.length - 3));
</script>
