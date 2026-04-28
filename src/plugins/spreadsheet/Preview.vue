<template>
  <div class="p-2 bg-green-50 dark:bg-green-900 rounded">
    <div class="text-sm text-gray-800 dark:text-gray-200 font-medium break-words">
      {{ displayTitle }}
    </div>
    <div v-if="sheetCount > 1" class="text-xs text-gray-600 dark:text-gray-400 mt-1">
      {{ t("pluginSpreadsheet.previewSheets", sheetCount, { named: { count: sheetCount } }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResult } from "gui-chat-protocol";
import type { SpreadsheetToolData } from "./definition";

const { t } = useI18n();

const props = defineProps<{
  result: ToolResult<SpreadsheetToolData>;
}>();

const displayTitle = computed(() => props.result.title || t("pluginSpreadsheet.previewUntitled"));

const sheetCount = computed(() => {
  const sheets = props.result.data?.sheets;
  if (!sheets || typeof sheets === "string") return 0;
  return sheets.length;
});
</script>
