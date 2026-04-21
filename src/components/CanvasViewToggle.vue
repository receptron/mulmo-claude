<template>
  <button
    class="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-gray-100"
    :class="isStack ? 'text-blue-500' : 'text-gray-400 hover:text-gray-700'"
    :title="
      isStack
        ? 'Stack view · click to switch to Single (⌘1)'
        : 'Single view · click to switch to Stack (⌘2)'
    "
    :aria-label="isStack ? 'Switch to Single view' : 'Switch to Stack view'"
    :data-testid="`canvas-view-toggle-${modelValue}`"
    @click="
      emit(
        'update:modelValue',
        isStack ? CANVAS_VIEW.single : CANVAS_VIEW.stack,
      )
    "
  >
    <span class="material-icons text-lg">view_agenda</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { CANVAS_VIEW, type CanvasViewMode } from "../utils/canvas/viewMode";

const props = defineProps<{
  modelValue: CanvasViewMode;
}>();

const emit = defineEmits<{
  "update:modelValue": [mode: CanvasViewMode];
}>();

const isStack = computed(() => props.modelValue === CANVAS_VIEW.stack);
</script>
