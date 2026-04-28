<template>
  <!-- View-only fallback for sessions saved before the #824 split: routes by payload shape. Never produces fresh tool calls. -->
  <AutomationsView v-if="renderAutomations" :selected-result="selectedResult" @update-result="(result) => emit('updateResult', result)" />
  <CalendarView v-else :selected-result="selectedResult" @update-result="(result) => emit('updateResult', result)" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import AutomationsView from "./AutomationsView.vue";
import CalendarView from "./CalendarView.vue";
import { isLegacyAutomationsShape } from "./legacyShape";
import type { SchedulerData } from "./index";

const props = defineProps<{
  selectedResult?: ToolResultComplete<SchedulerData>;
}>();

const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

// Default to CalendarView on unknown shapes — it degrades gracefully on missing fields; AutomationsView would render empty.
const renderAutomations = computed(() => isLegacyAutomationsShape(props.selectedResult?.data));
</script>
