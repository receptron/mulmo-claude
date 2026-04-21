// Composable: derive content-type flags and formatted views from the
// current selection. Extracted from FilesView.vue (#507 step 5).

import { computed, type Ref } from "vue";
import type { FileContent } from "./useFileSelection";
import { wrapHtmlWithPreviewCsp } from "../utils/html/previewCsp";
import {
  tokenizeJson,
  tokenizeJsonl,
  prettyJson,
} from "../utils/format/jsonSyntax";
import { extractFrontmatter } from "../utils/format/frontmatter";

function hasExt(filePath: string | null, exts: string[]): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

export function useContentDisplay(
  selectedPath: Ref<string | null>,
  content: Ref<FileContent | null>,
) {
  const isMarkdown = computed(() =>
    hasExt(selectedPath.value, [".md", ".markdown"]),
  );
  const isHtml = computed(() => hasExt(selectedPath.value, [".html", ".htm"]));
  const isJson = computed(() => hasExt(selectedPath.value, [".json"]));
  const isJsonl = computed(() =>
    hasExt(selectedPath.value, [".jsonl", ".ndjson"]),
  );

  const sandboxedHtml = computed(() =>
    content.value?.kind === "text" && isHtml.value
      ? wrapHtmlWithPreviewCsp(content.value.content)
      : "",
  );

  const jsonTokens = computed(() => {
    if (!content.value || content.value.kind !== "text") return [];
    if (!isJson.value) return [];
    return tokenizeJson(prettyJson(content.value.content));
  });

  const jsonlLines = computed(() => {
    if (!content.value || content.value.kind !== "text") return [];
    if (!isJsonl.value) return [];
    return tokenizeJsonl(content.value.content);
  });

  const mdFrontmatter = computed(() => {
    if (!content.value || content.value.kind !== "text") return null;
    if (!isMarkdown.value) return null;
    return extractFrontmatter(content.value.content);
  });

  return {
    isMarkdown,
    isHtml,
    isJson,
    isJsonl,
    sandboxedHtml,
    jsonTokens,
    jsonlLines,
    mdFrontmatter,
  };
}
