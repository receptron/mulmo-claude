<template>
  <div class="text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span class="material-icons" style="font-size: 14px">menu_book</span>
      <span>{{ label }}</span>
    </div>
    <div
      v-for="entry in previewEntries"
      :key="entry.slug"
      class="text-xs text-gray-500 truncate"
    >
      {{ entry.title }}
    </div>
    <div v-if="more > 0" class="text-xs text-gray-400">+ {{ more }} more…</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WikiData } from "./index";

const props = defineProps<{ result: ToolResultComplete<WikiData> }>();

const action = computed(() => props.result.data?.action ?? "index");
const title = computed(() => props.result.data?.title ?? "Wiki");
const pageEntries = computed(() => props.result.data?.pageEntries ?? []);

const label = computed(() => {
  if (action.value === "index")
    return `Wiki Index (${pageEntries.value.length} pages)`;
  if (action.value === "log") return "Wiki Log";
  if (action.value === "lint_report") return "Wiki Lint";
  return `Wiki: ${title.value}`;
});

const previewEntries = computed(() => pageEntries.value.slice(0, 3));
const more = computed(() => Math.max(0, pageEntries.value.length - 3));
</script>
