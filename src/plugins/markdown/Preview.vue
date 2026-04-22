<template>
  <div class="p-2 bg-purple-100 rounded overflow-hidden">
    <div class="text-sm text-gray-800 font-medium truncate">
      {{ displayTitle }}
    </div>
    <div v-if="contentPreview" class="text-xs text-gray-500 mt-1 line-clamp-4 whitespace-pre-line">
      {{ contentPreview }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import { isFilePath, type MarkdownToolData } from "./definition";
import { extractFirstH1 } from "../../utils/markdown/extractFirstH1";
import { apiGet } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

const props = defineProps<{
  result: ToolResult<MarkdownToolData>;
}>();

const fetchedContent = ref("");

async function fetchContent(): Promise<void> {
  const raw = props.result.data?.markdown;
  if (!raw || !isFilePath(raw)) {
    fetchedContent.value = "";
    return;
  }
  const result = await apiGet<{ content?: string }>(API_ROUTES.files.content, {
    path: raw,
  });
  if (!result.ok) {
    fetchedContent.value = "";
    return;
  }
  fetchedContent.value = result.data.content ?? "";
}

fetchContent();
watch(() => props.result.data?.markdown, fetchContent);

const displayTitle = computed(() => {
  if (props.result.title) {
    return props.result.title;
  }
  const markdown = resolvedMarkdown.value;
  if (markdown) {
    const heading = extractFirstH1(markdown);
    if (heading) return heading;
  }
  return "Markdown Document";
});

const resolvedMarkdown = computed(() => {
  const raw = props.result.data?.markdown;
  if (!raw) return "";
  return isFilePath(raw) ? fetchedContent.value : raw;
});

function extractPreview(markdown: string): string {
  const lines = markdown
    .split("\n")
    .filter((line) => !/^#{1,6}\s/.test(line) && line.trim() !== "")
    .map((line) => line.replace(/[*_`~[\]]/g, "").trim())
    .filter(Boolean);
  return lines.slice(0, 6).join("\n");
}

const contentPreview = computed(() => {
  const markdown = resolvedMarkdown.value;
  if (!markdown) return "";
  return extractPreview(markdown);
});
</script>
