<template>
  <!-- Right-edge hover handle for the session-history side panel.
       Hidden until the parent (marked with Tailwind `group`) is
       hovered or contains focus, so the expand affordance stays
       reachable by keyboard/touch without cluttering the header. -->
  <button
    class="absolute top-0 bottom-0 right-0 flex items-center justify-center w-6 bg-gray-400/30 text-gray-700 hover:bg-gray-400/50 transition-opacity opacity-0 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    :title="modelValue ? t('sessionHistoryExpand.collapseTooltip') : t('sessionHistoryExpand.expandTooltip')"
    :aria-label="modelValue ? t('sessionHistoryExpand.collapse') : t('sessionHistoryExpand.expand')"
    :aria-pressed="modelValue"
    :data-testid="`session-history-expand-${modelValue ? 'on' : 'off'}`"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="material-icons" style="font-size: 40px" aria-hidden="true">{{ modelValue ? "arrow_left" : "arrow_right" }}</span>
  </button>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();
</script>
