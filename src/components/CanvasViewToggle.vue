<template>
  <button
    class="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-gray-100"
    :class="isStack ? 'text-blue-500' : 'text-gray-400 hover:text-gray-700'"
    :title="isStack ? t('canvasViewToggle.stackViewTooltip') : t('canvasViewToggle.singleViewTooltip')"
    :aria-label="isStack ? t('canvasViewToggle.switchToSingle') : t('canvasViewToggle.switchToStack')"
    :data-testid="`canvas-view-toggle-${modelValue}`"
    @click="emit('update:modelValue', isStack ? CANVAS_VIEW.single : CANVAS_VIEW.stack)"
  >
    <span class="material-icons text-lg">view_agenda</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { CANVAS_VIEW, type CanvasViewMode } from "../utils/canvas/viewMode";

const { t } = useI18n();

const props = defineProps<{
  modelValue: CanvasViewMode;
}>();

const emit = defineEmits<{
  "update:modelValue": [mode: CanvasViewMode];
}>();

const isStack = computed(() => props.modelValue === CANVAS_VIEW.stack);
</script>
