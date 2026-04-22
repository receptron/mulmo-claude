<template>
  <div class="p-2 text-sm">
    <div class="font-medium text-gray-700 truncate mb-1">
      {{ title }}
    </div>
    <div v-if="hint" class="text-xs text-gray-500 leading-relaxed truncate">
      {{ hint }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSourceData, Source } from "./index";

const props = defineProps<{ result: ToolResultComplete<ManageSourceData> }>();

const data = computed(() => props.result.data);
const title = computed(() => "Information sources");

const hint = computed(() => {
  const sources = data.value?.sources ?? [];
  if (sources.length === 0) return "No sources registered yet.";
  const names = sources
    .slice(0, 3)
    .map((source: Source) => source.slug)
    .join(", ");
  const tail = sources.length > 3 ? ", …" : "";
  const plural = sources.length === 1 ? "" : "s";
  return `${sources.length} source${plural}: ${names}${tail}`;
});
</script>
