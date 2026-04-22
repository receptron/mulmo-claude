<template>
  <div class="w-full h-full overflow-y-auto">
    <div class="min-h-full flex flex-col items-center justify-center p-4">
      <div v-if="resolvedSrc" class="flex-1 flex items-center justify-center min-h-0">
        <img :src="resolvedSrc" class="max-w-full max-h-full object-contain rounded" :alt="alt" />
      </div>
      <div v-else class="flex-1 flex items-center justify-center text-gray-400 text-sm">{{ t("common.noImageYet") }}</div>
      <div v-if="selectedResult.data?.prompt" class="mt-4 p-3 bg-gray-100 rounded-lg max-w-full flex-shrink-0">
        <p class="text-sm text-gray-700">
          <span class="font-medium">{{ t("pluginUiImage.promptLabel", { label: promptLabel }) }}</span>
          {{ selectedResult.data.prompt }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResult } from "gui-chat-protocol/vue";
import type { ImageToolData } from "./types";
import { resolveImageSrcFresh } from "../../utils/image/resolve";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    selectedResult: ToolResult<ImageToolData>;
    alt?: string;
    promptLabel?: string;
  }>(),
  { alt: "Image", promptLabel: "Prompt" },
);

const resolvedSrc = computed(() => (props.selectedResult.data?.imageData ? resolveImageSrcFresh(props.selectedResult.data.imageData) : ""));
</script>
