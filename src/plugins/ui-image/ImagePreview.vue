<template>
  <div class="min-h-24 flex items-center justify-center">
    <img v-if="resolvedSrc" :src="resolvedSrc" class="max-w-full h-auto rounded" :alt="alt" />
    <div v-else class="text-gray-400 text-sm">{{ t("common.noImageYet") }}</div>
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
    result: ToolResult<ImageToolData>;
    alt?: string;
  }>(),
  { alt: "Image" },
);

const resolvedSrc = computed(() => (props.result.data?.imageData ? resolveImageSrcFresh(props.result.data.imageData) : ""));
</script>
