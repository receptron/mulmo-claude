<template>
  <!-- View-only fallback for chat sessions saved before the
       manageScheduler split (#824). The legacy tool returned two
       distinct payload shapes — calendar items vs task records —
       so we route on shape and mount the matching post-split view.
       Never produces fresh tool calls (the plugin is not exposed
       to the LLM); only renders persisted history. -->
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

// Shape-based dispatch. Errors on the side of CalendarView when
// the payload shape is unknown — calendar was the more common
// pre-split action and the view degrades gracefully on missing
// fields, while the automations view assumes the task shape and
// would render an empty Tasks tab.
const renderAutomations = computed(() => isLegacyAutomationsShape(props.selectedResult?.data));
</script>
