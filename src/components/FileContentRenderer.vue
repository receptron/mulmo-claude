<template>
  <div class="flex-1 overflow-auto min-h-0">
    <div v-if="!selectedPath" class="h-full flex items-center justify-center text-gray-400 text-sm">{{ t("fileContentRenderer.selectFile") }}</div>
    <div v-else-if="contentError" class="p-4 text-sm text-red-600">
      {{ contentError }}
    </div>
    <div v-else-if="contentLoading" class="p-4 text-sm text-gray-400">{{ t("common.loading") }}</div>
    <template v-else-if="content">
      <!-- System-managed file? Show description banner above the
           body so the user knows what the file is for, who writes
           it, and whether hand-editing is safe (#832). -->
      <SystemFileBanner v-if="systemDescriptor && selectedPath" :descriptor="systemDescriptor" :path="selectedPath" />
      <template v-if="content.kind === 'text'">
        <!-- Scheduler items.json: render with the scheduler plugin's
             calendar/list view by synthesizing a fake tool result. -->
        <div v-if="schedulerResult" class="h-full">
          <SchedulerView :selected-result="schedulerResult" />
        </div>
        <!-- Todos todos.json: full kanban / table / list explorer. -->
        <div v-else-if="todoExplorerResult" class="h-full">
          <TodoExplorer :selected-result="todoExplorerResult" />
        </div>
        <!-- Markdown rendered: frontmatter panel + body -->
        <div v-else-if="isMarkdown && !mdRawMode" class="h-full flex flex-col overflow-auto">
          <div v-if="mdFrontmatter && mdFrontmatter.fields.length > 0" class="shrink-0 m-4 mb-0 rounded border border-gray-200 bg-gray-50 p-3 text-xs">
            <div v-for="field in mdFrontmatter.fields" :key="field.key" class="flex items-baseline gap-2 py-0.5">
              <span class="font-semibold text-gray-600 shrink-0">{{ field.key }}:</span>
              <template v-if="Array.isArray(field.value)">
                <span class="flex flex-wrap gap-1">
                  <span v-for="item in field.value" :key="item" class="rounded-full bg-white border border-gray-300 px-2 py-0.5 text-gray-700">
                    {{ item }}
                  </span>
                </span>
              </template>
              <span v-else class="text-gray-800 break-words">{{ field.value }}</span>
            </div>
          </div>
          <div class="flex-1 min-h-0" @click.capture="(e: MouseEvent) => emit('markdownLinkClick', e)">
            <TextResponseView
              :selected-result="markdownResult(mdFrontmatter ? mdFrontmatter.body : content.content)"
              :editable-source="content.content"
              @update-source="(src: string) => emit('updateSource', src)"
            />
          </div>
          <div v-if="rawSaveError" class="shrink-0 m-4 mt-0 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700" role="alert">
            ⚠ {{ rawSaveError }}
          </div>
        </div>
        <!-- Markdown raw source (includes frontmatter) -->
        <pre v-else-if="isMarkdown && mdRawMode" class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800">{{ content.content }}</pre>
        <!-- HTML: sandboxed iframe preview.
             `allow-scripts` lets Chart.js / canvas drawing / other
             JS-driven HTML (the common case for LLM-generated
             results) run. We deliberately DO NOT grant
             `allow-same-origin`, so the iframe keeps a null
             origin — it can't read MulmoClaude's cookies,
             localStorage, or the parent window's DOM.
             A CSP meta tag is injected via wrapHtmlWithPreviewCsp
             to restrict script loads to a vetted CDN whitelist +
             inline; connect-src is `'none'` so the page can't
             phone home. See src/utils/html/previewCsp.ts. -->
        <iframe
          v-else-if="isHtml"
          :srcdoc="sandboxedHtml"
          class="w-full h-full border-0"
          sandbox="allow-scripts"
          :title="t('fileContentRenderer.htmlPreview')"
        />
        <!-- JSON: pretty-printed with simple syntax coloring. Fall
             back to raw content if the file is malformed. -->
        <pre v-else-if="isJson" class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800"><span
          v-for="(tok, i) in jsonTokens"
          :key="i"
          :class="JSON_TOKEN_CLASS[tok.type]"
        >{{ tok.value }}</span></pre>
        <!-- JSONL / NDJSON: one pretty-printed + colored record per line -->
        <div v-else-if="isJsonl" class="p-4 space-y-2">
          <div v-for="(line, i) in jsonlLines" :key="i" class="rounded border bg-gray-50 p-3" :class="line.parseError ? 'border-red-300' : 'border-gray-200'">
            <div v-if="line.parseError" class="text-xs text-red-600 mb-1 font-sans">{{ t("fileContentRenderer.parseError") }}</div>
            <pre class="text-xs font-mono text-gray-800 whitespace-pre-wrap"><span
              v-for="(tok, j) in line.tokens"
              :key="j"
              :class="JSON_TOKEN_CLASS[tok.type]"
            >{{ tok.value }}</span></pre>
          </div>
        </div>
        <!-- Plain text fallback -->
        <pre v-else class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800">{{ content.content }}</pre>
      </template>
      <!-- Image -->
      <div v-else-if="content.kind === 'image' && selectedPath" class="h-full flex items-center justify-center p-4">
        <img :src="rawUrl(selectedPath)" :alt="selectedPath" class="max-w-full max-h-full object-contain" />
      </div>
      <!-- PDF -->
      <iframe
        v-else-if="content.kind === 'pdf' && selectedPath"
        :src="rawUrl(selectedPath)"
        class="w-full h-full border-0"
        :title="t('fileContentRenderer.pdfPreview')"
      />
      <!-- Audio -->
      <div v-else-if="content.kind === 'audio' && selectedPath" class="h-full flex items-center justify-center p-4">
        <audio :key="selectedPath" :src="rawUrl(selectedPath)" controls preload="metadata" class="w-full max-w-2xl" />
      </div>
      <!-- Video -->
      <div v-else-if="content.kind === 'video' && selectedPath" class="h-full flex items-center justify-center p-4 bg-black">
        <video :key="selectedPath" :src="rawUrl(selectedPath)" controls preload="metadata" class="max-w-full max-h-full" />
      </div>
      <!-- Binary or too-large -->
      <div v-else class="p-4 text-sm text-gray-500">
        <template v-if="'message' in content">{{ content.message }}</template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import TextResponseView from "../plugins/textResponse/View.vue";
import SchedulerView from "../plugins/scheduler/View.vue";
import TodoExplorer from "./TodoExplorer.vue";
import SystemFileBanner from "./SystemFileBanner.vue";
import type { FileContent } from "../composables/useFileSelection";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "../plugins/textResponse/types";
import type { SchedulerData } from "../plugins/scheduler/index";
import type { TodoData } from "../plugins/todo/index";
import { JSON_TOKEN_CLASS } from "../utils/format/jsonSyntax";
import type { JsonToken, JsonlLine } from "../utils/format/jsonSyntax";
import type { Frontmatter } from "../utils/format/frontmatter";
import { rewriteMarkdownImageRefs } from "../utils/image/rewriteMarkdownImageRefs";
import { API_ROUTES } from "../config/apiRoutes";
import { descriptorForPath } from "../config/systemFileDescriptors";

const { t } = useI18n();

const props = defineProps<{
  selectedPath: string | null;
  content: FileContent | null;
  contentError: string | null;
  contentLoading: boolean;
  schedulerResult: ToolResultComplete<SchedulerData> | null;
  todoExplorerResult: ToolResultComplete<TodoData> | null;
  isMarkdown: boolean;
  isHtml: boolean;
  isJson: boolean;
  isJsonl: boolean;
  mdRawMode: boolean;
  sandboxedHtml: string;
  jsonTokens: JsonToken[];
  jsonlLines: JsonlLine[];
  mdFrontmatter: Frontmatter | null;
  rawSaveError: string | null;
}>();

const emit = defineEmits<{
  markdownLinkClick: [event: MouseEvent];
  updateSource: [newSource: string];
}>();

const systemDescriptor = computed(() => (props.selectedPath ? descriptorForPath(props.selectedPath) : null));

function rawUrl(filePath: string): string {
  return `${API_ROUTES.files.raw}?path=${encodeURIComponent(filePath)}`;
}

function markdownResult(text: string): ToolResultComplete<TextResponseData> {
  // Rewrite `![alt](path)` refs BEFORE handing the markdown to
  // TextResponseView so workspace-relative image paths resolve via
  // /api/files/raw instead of 404-ing against the SPA page URL.
  const current = props.selectedPath ?? "";
  const slash = current.lastIndexOf("/");
  const basePath = slash >= 0 ? current.slice(0, slash) : "";
  const rewritten = rewriteMarkdownImageRefs(text, basePath);
  return {
    uuid: "files-preview",
    toolName: "text-response",
    message: rewritten,
    title: props.selectedPath ?? "",
    // role: "user" hides the PDF download button in TextResponseView
    data: { text: rewritten, role: "user", transportKind: "text-rest" },
  };
}
</script>
