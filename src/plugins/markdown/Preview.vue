<template>
  <div class="p-3 bg-purple-100 rounded overflow-hidden">
    <div class="text-sm text-gray-800 font-medium truncate">
      {{ displayTitle }}
    </div>
    <div
      v-if="contentPreview"
      class="text-xs text-gray-500 mt-1 line-clamp-4 whitespace-pre-line"
    >
      {{ contentPreview }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import { isFilePath, type MarkdownToolData } from "./definition";

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
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(raw)}`,
    );
    if (!res.ok) {
      fetchedContent.value = "";
      return;
    }
    const json: { content?: string } = await res.json();
    fetchedContent.value = json.content ?? "";
  } catch {
    fetchedContent.value = "";
  }
}

fetchContent();
watch(() => props.result.data?.markdown, fetchContent);

const displayTitle = computed(() => {
  if (props.result.title) {
    return props.result.title;
  }
  const md = resolvedMarkdown.value;
  if (md) {
    const match = md.match(/^#\s+(.+)$/m);
    if (match) {
      return match[1];
    }
  }
  return "Markdown Document";
});

const resolvedMarkdown = computed(() => {
  const raw = props.result.data?.markdown;
  if (!raw) return "";
  return isFilePath(raw) ? fetchedContent.value : raw;
});

function extractPreview(md: string): string {
  const lines = md
    .split("\n")
    .filter((l) => !/^#{1,6}\s/.test(l) && l.trim() !== "")
    .map((l) => l.replace(/[*_`~[\]]/g, "").trim())
    .filter(Boolean);
  return lines.slice(0, 6).join("\n");
}

const contentPreview = computed(() => {
  const md = resolvedMarkdown.value;
  if (!md) return "";
  return extractPreview(md);
});
</script>
