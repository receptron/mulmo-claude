<template>
  <ImagePreview :result="result" alt="Canvas drawing" />
</template>

<script setup lang="ts">
import { ImagePreview } from "../ui-image";
import type { ToolResult } from "gui-chat-protocol/vue";
import type { ImageToolData } from "./definition";

defineProps<{
  result: ToolResult<ImageToolData>;
}>();
</script>
