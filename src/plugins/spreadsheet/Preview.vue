<template>
  <div class="text-center p-4 bg-green-50 dark:bg-green-900 rounded">
    <div class="text-green-600 dark:text-green-300 font-medium">📊 Spreadsheet</div>
    <div class="text-sm text-gray-800 dark:text-gray-200 mt-1 font-medium truncate">
      {{ displayTitle }}
    </div>
    <div v-if="sheetCount > 1" class="text-xs text-gray-600 dark:text-gray-400 mt-1">{{ sheetCount }} sheets</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import type { SpreadsheetToolData } from "./definition";

const props = defineProps<{
  result: ToolResult<SpreadsheetToolData>;
}>();

const displayTitle = computed(() => {
  return props.result.title || "Spreadsheet";
});

const sheetCount = computed(() => {
  const sheets = props.result.data?.sheets;
  if (!sheets || typeof sheets === "string") return 0;
  return sheets.length;
});
</script>
