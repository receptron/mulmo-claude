<template>
  <div class="p-2 text-sm">
    <div class="font-medium text-gray-700 truncate">
      {{ title }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentHtmlData } from "./index";

const props = defineProps<{ result: ToolResultComplete<PresentHtmlData> }>();

const data = computed(() => props.result.data);
const title = computed(() => data.value?.title ?? "HTML Page");
</script>
