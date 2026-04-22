<template>
  <div class="h-full flex flex-col">
    <div v-if="isAssistant" class="flex justify-end px-4 py-2 border-b border-gray-100 shrink-0">
      <div class="button-group">
        <button class="download-btn download-btn-green" :disabled="pdfDownloading" @click="downloadPdf">
          <span class="material-icons">{{ pdfDownloading ? "hourglass_empty" : "download" }}</span>
          {{ t("pluginTextResponse.pdf") }}
        </button>
      </div>
      <span v-if="pdfError" class="text-xs text-red-500 self-center ml-2" :title="pdfError">{{ t("pluginTextResponse.pdfFailed") }}</span>
    </div>
    <div class="flex-1 overflow-hidden relative" @click.capture="openLinksInNewTab">
      <div class="text-response-container">
        <div class="text-response-content-wrapper">
          <div class="p-6">
            <div class="max-w-3xl mx-auto space-y-4">
              <div class="rounded-lg border border-gray-300 bg-white shadow-sm p-5" :class="roleTheme">
                <div class="flex justify-between items-start mb-2 text-sm text-gray-500">
                  <span class="font-medium text-gray-700">{{ speakerLabel }}</span>
                  <span v-if="transportKind" class="italic">{{ transportKind }}</span>
                </div>
                <div class="markdown-content prose prose-slate max-w-none leading-relaxed text-gray-900" v-html="renderedHtml"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Collapsible Editor -->
        <details v-if="editable" ref="detailsEl" class="text-response-source" data-testid="text-response-edit">
          <summary data-testid="text-response-edit-summary">{{ t("pluginTextResponse.editContent") }}</summary>
          <textarea v-model="editedText" class="text-response-editor" spellcheck="false" data-testid="text-response-edit-textarea"></textarea>
          <button class="apply-btn" :disabled="!hasChanges" data-testid="text-response-apply-btn" @click="applyChanges">
            {{ t("pluginTextResponse.applyChanges") }}
          </button>
        </details>
      </div>
      <button v-show="!editing" class="copy-btn" :title="copied ? t('pluginTextResponse.copiedLabel') : t('pluginTextResponse.copyLabel')" @click="copyText">
        <span class="material-icons">{{ copied ? "check" : "content_copy" }}</span>
      </button>
      <button v-show="editing" class="cancel-btn" @click="cancelEdit">{{ t("pluginTextResponse.cancel") }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import type { ToolResult, ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "./types";
import { handleExternalLinkClick } from "../../utils/dom/externalLink";
import { classifyWorkspacePath } from "../../utils/path/workspaceLinkRouter";
import { useAppApi } from "../../composables/useAppApi";
import { usePdfDownload } from "../../composables/usePdfDownload";
import { useClipboardCopy } from "../../composables/useClipboardCopy";

const { t } = useI18n();
const appApi = useAppApi();

const props = withDefaults(
  defineProps<{
    selectedResult: ToolResultComplete<TextResponseData>;
    editable?: boolean;
    // When set, the editor textarea edits this string instead of the
    // displayed `data.text`. FilesView uses it to feed the editor the
    // raw on-disk source (with frontmatter intact, no image-URL
    // rewriting) while the rendered pane keeps showing the cleaned-up
    // display text. Callers listen for `updateSource` to receive the
    // edited source and handle persistence themselves.
    editableSource?: string;
  }>(),
  { editable: true, editableSource: undefined },
);
const emit = defineEmits<{
  updateResult: [result: ToolResult];
  updateSource: [source: string];
}>();

// --- Data & computed from upstream View ---

const messageText = computed(() => props.selectedResult.data?.text ?? "");
// Source fed into the editor. When the parent passes `editableSource`
// it wins; otherwise we edit the displayed text, matching the
// component's original (chat-message) behaviour.
const editorSource = computed(() => (props.editableSource !== undefined ? props.editableSource : messageText.value));
const editedText = ref(editorSource.value);

watch(editorSource, (next) => {
  editedText.value = next;
});

const messageRole = computed(() => props.selectedResult.data?.role ?? "assistant");
const transportKind = computed(() => props.selectedResult.data?.transportKind ?? "");

const renderedHtml = computed(() => {
  if (!messageText.value) return "";

  let processedText = messageText.value;

  // Detect and wrap JSON content in code fences
  const trimmedText = processedText.trim();
  if ((trimmedText.startsWith("{") && trimmedText.endsWith("}")) || (trimmedText.startsWith("[") && trimmedText.endsWith("]"))) {
    try {
      JSON.parse(trimmedText);
      processedText = "```json\n" + trimmedText + "\n```";
    } catch {
      // Not valid JSON, continue with original text
    }
  }

  // Process <think> blocks to make them grey
  processedText = processedText.replace(/<think>([\s\S]*?)<\/think>/g, (_, content) => {
    const thinkContent = marked(content.trim());
    return `<div class="think-block">${thinkContent}</div>`;
  });

  return marked(processedText, { breaks: true, gfm: true });
});

const speakerLabel = computed(() => {
  switch (messageRole.value) {
    case "system":
      return "System";
    case "user":
      return "You";
    default:
      return "Assistant";
  }
});

const roleTheme = computed(() => {
  switch (messageRole.value) {
    case "system":
      return "bg-blue-50 border-blue-200";
    case "user":
      return "bg-green-50 border-green-200";
    default:
      return "bg-purple-50 border-purple-200";
  }
});

const hasChanges = computed(() => editedText.value !== editorSource.value);

function applyChanges() {
  if (!hasChanges.value) return;

  if (props.editableSource !== undefined) {
    // Source-editing mode: hand the edited string to the parent and
    // let it decide how to persist. The component's own `data.text`
    // isn't touched — the parent will re-supply `editableSource` after
    // the save round-trip.
    emit("updateSource", editedText.value);
  } else {
    const updatedResult: ToolResult = {
      ...props.selectedResult,
      data: {
        ...props.selectedResult.data,
        text: editedText.value,
      },
    };
    emit("updateResult", updatedResult);
  }
  if (detailsEl.value) detailsEl.value.open = false;
}

// --- Local customizations: PDF, copy, edit toggle, external links ---

const isAssistant = computed(() => (props.selectedResult.data?.role ?? "assistant") === "assistant");

function openLinksInNewTab(event: MouseEvent): void {
  if (handleExternalLinkClick(event)) return;
  // Internal workspace-path links (rendered by marked from agent
  // Markdown): route to the appropriate view instead of letting them
  // navigate the SPA to a non-existent session route.
  const target = event.target as HTMLElement;
  const anchor = target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return;
  if (classifyWorkspacePath(href)) {
    event.preventDefault();
    appApi.navigateToWorkspacePath(href);
  }
}

const { pdfDownloading, pdfError, downloadPdf: rawDownloadPdf } = usePdfDownload();

const detailsEl = ref<HTMLDetailsElement>();
const editing = ref(false);

function onDetailsToggle(event: Event) {
  editing.value = (event.target as HTMLDetailsElement).open;
}

onMounted(() => {
  detailsEl.value?.addEventListener("toggle", onDetailsToggle);
});

onBeforeUnmount(() => {
  detailsEl.value?.removeEventListener("toggle", onDetailsToggle);
});

function cancelEdit() {
  if (detailsEl.value) detailsEl.value.open = false;
  // Reset edited text to whatever the editor started with — in
  // source-editing mode that's the raw source, otherwise the display
  // text. Using the computed `editorSource` keeps both paths correct.
  editedText.value = editorSource.value;
}

const { copied, copy } = useClipboardCopy();

async function copyText() {
  await copy(props.selectedResult.data?.text ?? "");
}

async function downloadPdf() {
  const text = props.selectedResult.data?.text ?? "";
  const filename = `${props.selectedResult.title ?? "response"}.pdf`;
  await rawDownloadPdf(text, filename);
}
</script>

<style scoped>
.markdown-content :deep(h1) {
  font-size: 2rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.markdown-content :deep(h2) {
  font-size: 1.75rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.markdown-content :deep(h3) {
  font-size: 1.5rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.markdown-content :deep(h4) {
  font-size: 1.25rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.markdown-content :deep(h5) {
  font-size: 1.125rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.markdown-content :deep(h6) {
  font-size: 1rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.markdown-content :deep(p) {
  margin-bottom: 1em;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-left: 1.5em;
  margin-bottom: 1em;
}

.markdown-content :deep(li) {
  margin-bottom: 0.5em;
}

.markdown-content :deep(code) {
  background-color: #f5f5f5;
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  background-color: #f5f5f5;
  padding: 1em;
  border-radius: 4px;
  overflow-x: auto;
  margin-bottom: 1em;
}

.markdown-content :deep(pre code) {
  background-color: transparent;
  padding: 0;
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid #ddd;
  padding-left: 1em;
  color: #666;
  margin: 1em 0;
}

.markdown-content :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}

.markdown-content :deep(a:hover) {
  color: #1d4ed8;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 1em;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid #ddd;
  padding: 0.5em;
  text-align: left;
}

.markdown-content :deep(th) {
  background-color: #f5f5f5;
  font-weight: bold;
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid #ddd;
  margin: 1.5em 0;
}

.markdown-content :deep(.think-block) {
  color: #6b7280;
  background-color: #f9fafb;
  border-left: 3px solid #d1d5db;
  padding: 0.75em 1em;
  margin: 1em 0;
  border-radius: 4px;
  font-style: italic;
}

.markdown-content :deep(.think-block p) {
  color: #6b7280;
}

.markdown-content :deep(.think-block code) {
  background-color: #e5e7eb;
  color: #4b5563;
}

/* Container styles */
.text-response-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.text-response-content-wrapper {
  flex: 1;
  overflow-y: auto;
}

/* Editor panel styles */
.text-response-source {
  padding: 0.5rem;
  background: #f5f5f5;
  border-top: 1px solid #e0e0e0;
  font-family: monospace;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.text-response-source summary {
  cursor: pointer;
  user-select: none;
  padding: 0.5rem;
  background: #e8e8e8;
  border-radius: 4px;
  font-weight: 500;
  color: #333;
}

.text-response-source[open] summary {
  margin-bottom: 0.5rem;
}

.text-response-source summary:hover {
  background: #d8d8d8;
}

.text-response-editor {
  width: 100%;
  height: 40vh;
  padding: 1rem;
  background: #ffffff;
  border: 1px solid #ccc;
  border-radius: 4px;
  color: #333;
  font-family: "Courier New", monospace;
  font-size: 0.9rem;
  resize: vertical;
  margin-bottom: 0.5rem;
  line-height: 1.5;
}

.text-response-editor:focus {
  outline: none;
  border-color: #4caf50;
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.1);
}

.apply-btn {
  padding: 0.5rem 1rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s;
  font-weight: 500;
}

.apply-btn:hover {
  background: #45a049;
}

.apply-btn:active {
  background: #3d8b40;
}

.apply-btn:disabled {
  background: #cccccc;
  color: #666666;
  cursor: not-allowed;
  opacity: 0.6;
}

.apply-btn:disabled:hover {
  background: #cccccc;
}

/* Toolbar button styles */
.button-group {
  display: flex;
  gap: 0.5em;
}

.download-btn {
  padding: 0.5em 1em;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 0.5em;
}

.download-btn-green {
  background-color: #4caf50;
}

.download-btn .material-icons {
  font-size: 1.2em;
}

.download-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.copy-btn {
  position: absolute;
  bottom: 0.3rem;
  right: 0.65rem;
  padding: 0.4rem;
  background: none;
  border: none;
  color: #333;
  cursor: pointer;
  z-index: 1;
}

.copy-btn:hover {
  color: #000;
}

.copy-btn .material-icons {
  font-size: 1.15rem;
}

.cancel-btn {
  position: absolute;
  bottom: 0.5rem;
  right: 0.65rem;
  padding: 0.5rem 1rem;
  background: #e0e0e0;
  color: #333;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  z-index: 1;
}

.cancel-btn:hover {
  background: #d0d0d0;
}
</style>
