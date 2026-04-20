<template>
  <button
    class="flex items-center justify-center w-8 h-8 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
    :title="current.title"
    :aria-label="current.title"
    :data-testid="`canvas-view-toggle-${modelValue}`"
    @click="emit('update:modelValue', other.key)"
  >
    <span class="material-icons text-base">{{ current.icon }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { CANVAS_VIEW, type CanvasViewMode } from "../utils/canvas/viewMode";

interface ModeOption {
  key: CanvasViewMode;
  icon: string;
  title: string;
}

const props = defineProps<{
  modelValue: CanvasViewMode;
}>();

const emit = defineEmits<{
  "update:modelValue": [mode: CanvasViewMode];
}>();

const SINGLE: ModeOption = {
  key: CANVAS_VIEW.single,
  icon: "crop_square",
  title: "Single view · click to switch to Stack (⌘2)",
};
const STACK: ModeOption = {
  key: CANVAS_VIEW.stack,
  icon: "layers",
  title: "Stack view · click to switch to Single (⌘1)",
};

// Show the current mode's icon; clicking switches to the other.
const current = computed<ModeOption>(() =>
  props.modelValue === CANVAS_VIEW.stack ? STACK : SINGLE,
);
const other = computed<ModeOption>(() =>
  props.modelValue === CANVAS_VIEW.stack ? SINGLE : STACK,
);
</script>
