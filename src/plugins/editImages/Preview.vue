<template>
  <ImagePreview :result="result" alt="Edited image" />
</template>

<script setup lang="ts">
import { ImagePreview } from "../ui-image";
import type { ToolResult } from "gui-chat-protocol";
import type { ImageToolData } from "./definition";

defineProps<{
  result: ToolResult<ImageToolData>;
}>();
</script>
