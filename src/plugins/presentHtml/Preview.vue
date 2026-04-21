<template>
  <div class="text-sm">
    <div class="font-medium text-gray-700 truncate mb-1">
      {{ title }}
    </div>
    <div v-if="hint" class="text-xs text-gray-500 leading-relaxed truncate">
      {{ hint }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentHtmlData } from "./index";
import { stripHtmlToPreview } from "./helpers";

const HINT_MAX_LENGTH = 60;

const props = defineProps<{ result: ToolResultComplete<PresentHtmlData> }>();

const data = computed(() => props.result.data);
const title = computed(() => data.value?.title ?? "HTML Page");
const hint = computed(() => stripHtmlToPreview(data.value?.html ?? "", HINT_MAX_LENGTH));
</script>
