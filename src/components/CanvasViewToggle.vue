<template>
  <button
    class="flex items-center justify-center w-8 h-8 rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
    :title="isStack ? t('canvasViewToggle.stackViewTooltip') : t('canvasViewToggle.singleViewTooltip')"
    :aria-label="isStack ? t('canvasViewToggle.switchToSingle') : t('canvasViewToggle.switchToStack')"
    :data-testid="`canvas-view-toggle-${modelValue}`"
    @click="emit('update:modelValue', isStack ? LAYOUT_MODES.single : LAYOUT_MODES.stack)"
  >
    <span class="material-symbols-outlined text-lg" aria-hidden="true">{{ isStack ? "auto_awesome_motion" : "crop_square" }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LAYOUT_MODES, type LayoutMode } from "../utils/canvas/layoutMode";

const { t } = useI18n();

const props = defineProps<{
  modelValue: LayoutMode;
}>();

const emit = defineEmits<{
  "update:modelValue": [mode: LayoutMode];
}>();

const isStack = computed(() => props.modelValue === LAYOUT_MODES.stack);
</script>
