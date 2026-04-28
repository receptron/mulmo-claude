<template>
  <div class="p-2 text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span aria-hidden="true">{{ t("pluginScheduler.previewIcon") }}</span>
      <span>{{ t("pluginScheduler.previewAutomations", { count: items.length }) }}</span>
    </div>
    <div v-for="item in preview" :key="item.id" class="text-xs truncate text-gray-600">
      {{ item.title }}
    </div>
    <div v-if="more > 0" class="text-xs text-gray-400">{{ t("pluginScheduler.previewMore", { count: more }) }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SchedulerData } from "./index";

// No /api/scheduler auto-refresh: that endpoint returns calendar items, not tasks (#828). The preview is a frozen
// snapshot of one tool call — re-fetching would either drift to wrong data or duplicate AutomationsView's state.

const { t } = useI18n();

const props = defineProps<{ result: ToolResultComplete<SchedulerData> }>();

const items = computed(() => props.result.data?.items ?? []);
const PREVIEW_LIMIT = 3;
const preview = computed(() => items.value.slice(0, PREVIEW_LIMIT));
const more = computed(() => Math.max(0, items.value.length - PREVIEW_LIMIT));
</script>
