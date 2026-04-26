<template>
  <!-- Automations mount point used in two places (#758, #824):
       1. Standalone /automations page — no `selectedResult`, the
          underlying TasksTab fetches via /api/scheduler/tasks.
       2. `manageAutomations` chat tool result — `selectedResult`
          is forwarded so View.vue can pick up task-shaped data.
       Both modes lock the tab to "tasks" so the legacy tab bar
       inside SchedulerView stays hidden. -->
  <SchedulerView :force-tab="SCHEDULER_TAB.tasks" :selected-result="selectedResult" @update-result="(result) => emit('updateResult', result)" />
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
