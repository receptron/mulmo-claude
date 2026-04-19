<template>
  <div class="min-h-24 flex items-center justify-center">
    <img
      v-if="resolvedSrc"
      :src="resolvedSrc"
      class="max-w-full h-auto rounded"
      :alt="alt"
    />
    <div v-else class="text-gray-400 text-sm">No image yet</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResult } from "gui-chat-protocol/vue";
import type { ImageToolData } from "./types";
import { resolveImageSrc } from "../../utils/image/resolve";

const props = withDefaults(
  defineProps<{
    result: ToolResult<ImageToolData>;
    alt?: string;
  }>(),
  { alt: "Image" },
);

const resolvedSrc = computed(() =>
  props.result.data?.imageData
    ? resolveImageSrc(props.result.data.imageData)
    : "",
);
</script>
