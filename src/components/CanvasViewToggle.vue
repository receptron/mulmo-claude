<template>
  <div class="flex border border-gray-300 rounded overflow-hidden text-xs">
    <button
      v-for="mode in MODES"
      :key="mode.key"
      class="px-2.5 py-1 flex items-center gap-1"
      :class="
        modelValue === mode.key
          ? 'bg-blue-500 text-white'
          : 'bg-white text-gray-600 hover:bg-gray-50'
      "
      :title="mode.title"
      @click="emit('update:modelValue', mode.key)"
    >
      <span class="material-icons text-sm">{{ mode.icon }}</span>
      <span>{{ mode.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { CanvasViewMode } from "../utils/canvas/viewMode";

interface ModeOption {
  key: CanvasViewMode;
  icon: string;
  label: string;
  title: string;
}

defineProps<{
  modelValue: CanvasViewMode;
}>();

const emit = defineEmits<{
  "update:modelValue": [mode: CanvasViewMode];
}>();

// Files view is no longer exposed through this toggle — the plugin
// launcher (src/components/PluginLauncher.vue) is the entry point,
// with dedicated buttons for todos / scheduler / wiki / skills plus
// a generic "Files" button for the workspace root.
const MODES: ModeOption[] = [
  {
    key: "single",
    icon: "view_agenda",
    label: "Single",
    title: "Single result (⌘1)",
  },
  {
    key: "stack",
    icon: "view_stream",
    label: "Stack",
    title: "All results stacked (⌘2)",
  },
];
</script>
