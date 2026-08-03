<template>
  <div class="p-2 bg-purple-100 rounded overflow-hidden">
    <div class="text-sm text-gray-800 font-medium truncate flex items-center gap-1">
      <span v-if="marpInfo" class="material-icons text-base text-purple-700" aria-hidden="true">slideshow</span>
      <span class="truncate">{{ displayTitle }}</span>
    </div>
    <div v-if="marpInfo" class="text-xs text-purple-700 mt-1">
      {{ t("pluginMarkdown.marpSlidesMode", { count: marpInfo.slideCount }) }}
    </div>
    <div v-else-if="contentPreview" class="text-xs text-gray-500 mt-1 line-clamp-4 whitespace-pre-line">
      {{ contentPreview }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import { documentPathOf, type MarkdownToolData } from "./definition";
import { extractFirstH1 } from "@mulmoclaude/markdown-utils/markdown/extractFirstH1";
import { parseFrontmatter } from "@mulmoclaude/markdown-utils/markdown/frontmatter";
import { isMarpDocument } from "@mulmoclaude/markdown-utils/markdown/marpDetect";
import { useRuntime } from "gui-chat-protocol/vue";
import { readDocContent } from "./contract";
import { useT } from "../../lang";

const t = useT();
const { dispatch } = useRuntime();

const props = defineProps<{
  result: ToolResult<MarkdownToolData>;
}>();

const fetchedContent = ref("");

async function fetchContent(): Promise<void> {
  const filePath = documentPathOf(props.result.data);
  if (filePath === null) {
    fetchedContent.value = "";
    return;
  }
  try {
    const { content } = await dispatch({ kind: "loadDoc", path: filePath }, readDocContent);
    fetchedContent.value = content ?? "";
  } catch {
    fetchedContent.value = "";
  }
}

fetchContent();
watch(() => props.result.data?.markdown, fetchContent);

const resolvedMarkdown = computed(() => {
  if (documentPathOf(props.result.data) !== null) return fetchedContent.value;
  return props.result.data?.markdown ?? "";
});

function countMarpSlides(body: string): number {
  if (!body.trim()) return 0;
  const separators = body.match(/^---\s*$/gm);
  return (separators?.length ?? 0) + 1;
}

const marpInfo = computed(() => {
  const markdown = resolvedMarkdown.value;
  if (!markdown) return null;
  const { meta, body } = parseFrontmatter(markdown);
  if (!isMarpDocument(meta)) return null;
  return { slideCount: countMarpSlides(body) };
});

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
