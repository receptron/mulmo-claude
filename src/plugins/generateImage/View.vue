<template>
  <div data-testid="generate-image-view" class="w-full h-full">
    <ImageView v-if="imageResult" :selected-result="imageResult" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { ImageView } from "../ui-image";
import type { ToolResult } from "gui-chat-protocol";
import type { ImageToolData } from "./definition";
import { TOOL_NAME } from "./definition";

const props = defineProps<{
  selectedResult: ToolResult<ImageToolData>;
  sendTextMessage: (text?: string) => void;
}>();

defineEmits<{
  updateResult: [result: ToolResult];
}>();

// Use ref + watch pattern for proper reactivity from external packages.
// No `deep: true`: the result object is REPLACED, never mutated in place, so
// a shallow watch fires on every switch — and deep-walking a multi-MB base64
// `imageData` payload on each trigger is pure waste.
const imageResult = ref<ToolResult<ImageToolData> | null>(null);

watch(
  () => props.selectedResult,
  (newResult) => {
    if (newResult?.toolName === TOOL_NAME && newResult.data) {
      imageResult.value = newResult;
    }
  },
  { immediate: true },
);
</script>
