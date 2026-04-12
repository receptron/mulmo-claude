<template>
  <ImageView v-if="imageResult" :selectedResult="imageResult" />
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

// Use ref + watch pattern for proper reactivity from external packages
const imageResult = ref<ToolResult<ImageToolData> | null>(null);

watch(
  () => props.selectedResult,
  (newResult) => {
    if (newResult?.toolName === TOOL_NAME && newResult.data) {
      imageResult.value = newResult;
    }
  },
  { immediate: true, deep: true },
);
</script>
