<template>
  <div class="min-h-24 flex items-center justify-center">
    <img
      v-if="result.data?.imageData"
      :src="resolvedSrc"
      class="max-w-full h-auto rounded"
      alt="Generated image"
    />
    <div v-else class="text-gray-400 text-sm">No image yet</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResult, ImageToolData } from "./types";
import { resolveImageSrc } from "../../utils/image/resolve";

const props = defineProps<{
  result: ToolResult<ImageToolData>;
}>();

const resolvedSrc = computed(() =>
  props.result.data?.imageData
    ? resolveImageSrc(props.result.data.imageData)
    : "",
);
</script>
