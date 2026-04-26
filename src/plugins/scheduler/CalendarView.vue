<template>
  <!-- Calendar mount point used in two places (#758, #824):
       1. Standalone /calendar page — no `selectedResult`, View.vue
          fetches items itself.
       2. `manageCalendar` chat tool result — `selectedResult` is
          forwarded so View.vue seeds items from the tool payload.
       Both modes lock the tab to "calendar" so the legacy tab bar
       inside SchedulerView stays hidden. -->
  <SchedulerView :force-tab="SCHEDULER_TAB.calendar" :selected-result="selectedResult" @update-result="(result) => emit('updateResult', result)" />
</template>

<script setup lang="ts">
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import SchedulerView from "./View.vue";
import { SCHEDULER_TAB } from "./viewModes";
import type { SchedulerData } from "./index";

defineProps<{
  selectedResult?: ToolResultComplete<SchedulerData>;
}>();

const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();
</script>
