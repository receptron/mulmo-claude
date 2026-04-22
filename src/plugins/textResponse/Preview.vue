<template>
  <div class="preview-text text-sm leading-snug" :class="textColorClass">{{ previewText }}</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "./types";

const props = defineProps<{
  result: ToolResultComplete<TextResponseData>;
}>();

const messageRole = computed(() => props.result.data?.role ?? "assistant");

const textColorClass = computed(() => {
  switch (messageRole.value) {
    case "system":
      return "text-blue-700";
    case "user":
      return "text-green-700 font-medium";
    default:
      return "text-gray-700";
  }
});

const previewText = computed(() => markdownToPlainText(props.result.data?.text ?? ""));

function markdownToPlainText(markdown: string): string {
  const html = marked(markdown, { breaks: true, gfm: true }) as string;
  const spaced = html
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|tr|blockquote|pre|div)>/gi, "$&\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const doc = new DOMParser().parseFromString(spaced, "text/html");
  const text = doc.body.textContent ?? "";
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
</script>

<style scoped>
.preview-text {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
