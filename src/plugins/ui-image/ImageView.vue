<template>
  <div class="w-full h-full overflow-y-auto">
    <div class="min-h-full flex flex-col items-center justify-center p-4">
      <div class="flex-1 flex items-center justify-center min-h-0">
        <img
          :src="resolvedSrc"
          class="max-w-full max-h-full object-contain rounded"
          alt="Current generated image"
        />
      </div>
      <div
        v-if="selectedResult.data?.prompt"
        class="mt-4 p-3 bg-gray-100 rounded-lg max-w-full flex-shrink-0"
      >
        <p class="text-sm text-gray-700">
          <span class="font-medium">Prompt:</span>
          {{ selectedResult.data.prompt }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResult, ImageToolData } from "./types";
import { resolveImageSrc } from "../../utils/image/resolve";

const props = defineProps<{
  selectedResult: ToolResult<ImageToolData>;
}>();

const resolvedSrc = computed(() =>
  props.selectedResult.data?.imageData
    ? resolveImageSrc(props.selectedResult.data.imageData)
    : "",
);
</script>
