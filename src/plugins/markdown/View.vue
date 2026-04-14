<template>
  <div class="markdown-container">
    <div v-if="loading" class="min-h-full p-8 flex items-center justify-center">
      <div class="text-gray-500">Loading document...</div>
    </div>
    <div
      v-else-if="!markdownContent"
      class="min-h-full p-8 flex items-center justify-center"
    >
      <div class="text-gray-500">No markdown content available</div>
    </div>
    <template v-else>
      <div class="markdown-content-wrapper">
        <div class="p-4">
          <div class="header-row">
            <h1 class="document-title">
              {{ selectedResult.title || "Document" }}
            </h1>
            <div class="button-group">
              <button
                class="download-btn download-btn-green"
                :disabled="pdfDownloading"
                @click="downloadPdf"
              >
                <span class="material-icons">{{
                  pdfDownloading ? "hourglass_empty" : "download"
                }}</span>
                PDF
              </button>
            </div>
            <span
              v-if="pdfError"
              class="text-xs text-red-500 self-center ml-2"
              :title="pdfError"
              >⚠ PDF failed</span
            >
          </div>
          <div
            class="markdown-content prose prose-slate max-w-none"
            v-html="renderedHtml"
          ></div>
        </div>
      </div>

      <div class="bottom-bar-wrapper">
        <details
          ref="sourceDetails"
          class="markdown-source"
          @toggle="onDetailsToggle"
        >
          <summary>Edit Markdown Source</summary>
          <textarea
            v-model="editableMarkdown"
            class="markdown-editor"
            spellcheck="false"
          ></textarea>
          <div class="editor-actions">
            <button
              class="apply-btn"
              :disabled="!hasChanges || saving"
              @click="applyMarkdown"
            >
              {{ saving ? "Saving..." : "Apply Changes" }}
            </button>
            <button class="cancel-btn" @click="cancelEdit">Cancel</button>
          </div>
          <p v-if="saveError" class="save-error" role="alert">
            ⚠ {{ saveError }}
          </p>
        </details>
        <button
          v-show="!editing"
          class="copy-btn"
          :title="copied ? 'Copied!' : 'Copy'"
          @click="copyText"
        >
          <span class="material-icons">{{
            copied ? "check" : "content_copy"
          }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { marked } from "marked";
import type { ToolResult } from "gui-chat-protocol";
import { isFilePath, type MarkdownToolData } from "./definition";
import { resolveImageSrc } from "../../utils/image/resolve";
import { usePdfDownload } from "../../composables/usePdfDownload";

const props = defineProps<{
  selectedResult: ToolResult<MarkdownToolData>;
}>();

const emit = defineEmits<{
  updateResult: [result: ToolResult<MarkdownToolData>];
}>();

const loading = ref(false);
const saving = ref(false);
// Human-readable message shown next to the Save button when a PUT
// fails. null while the editor is idle or the last save succeeded.
const saveError = ref<string | null>(null);
// The actual markdown content (fetched from server or inline)
const markdownContent = ref("");
const editableMarkdown = ref("");

async function fetchMarkdownContent(): Promise<void> {
  const raw = props.selectedResult.data?.markdown;
  if (!raw) {
    markdownContent.value = "";
    editableMarkdown.value = "";
    return;
  }
  if (isFilePath(raw)) {
    loading.value = true;
    try {
      const res = await fetch(
        `/api/files/content?path=${encodeURIComponent(raw)}`,
      );
      if (!res.ok) {
        console.error("Failed to fetch markdown:", res.statusText);
        markdownContent.value = "";
        editableMarkdown.value = "";
        return;
      }
      const json: { content?: string } = await res.json();
      markdownContent.value = json.content ?? "";
    } catch (err) {
      console.error("Failed to fetch markdown:", err);
      markdownContent.value = "";
    } finally {
      loading.value = false;
    }
  } else {
    // Legacy inline content
    markdownContent.value = raw;
  }
  editableMarkdown.value = markdownContent.value;
}

// Fetch on mount
fetchMarkdownContent();

const hasChanges = computed(() => {
  return editableMarkdown.value !== markdownContent.value;
});

// Resolve image paths in rendered HTML so workspace-relative paths become URLs.
// Markdown files use "../images/xyz.png" (relative from markdowns/ dir);
// strip the "../" prefix to get the workspace-relative path for resolveImageSrc.
function resolveImagesInHtml(html: string): string {
  return html.replace(
    /(<img\s[^>]*src=")([^"]+)(")/g,
    (_match, before: string, src: string, after: string) => {
      if (src.startsWith("data:") || src.startsWith("http")) return _match;
      const normalized = src.replace(/^\.\.\//, "");
      return `${before}${resolveImageSrc(normalized)}${after}`;
    },
  );
}

const renderedHtml = computed(() => {
  if (!markdownContent.value) return "";
  const html = marked(markdownContent.value) as string;
  return resolveImagesInHtml(html);
});

// Watch for scroll requests from viewState
watch(
  () => props.selectedResult?.viewState?.scrollToAnchor as string | undefined,
  (anchorId) => {
    if (!anchorId) return;
    nextTick(() => {
      const element = document.getElementById(anchorId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        console.warn(`Anchor element with id "${anchorId}" not found`);
      }
    });
  },
);

const sourceDetails = ref<HTMLDetailsElement>();
const editing = ref(false);
const copied = ref(false);

function onDetailsToggle(e: Event) {
  const open = (e.target as HTMLDetailsElement).open;
  editing.value = open;
  if (!open) {
    editableMarkdown.value = markdownContent.value;
    saveError.value = null;
  }
}

function cancelEdit() {
  if (sourceDetails.value) sourceDetails.value.open = false;
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(markdownContent.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // clipboard API may be blocked in some contexts
  }
}

const {
  pdfDownloading,
  pdfError,
  downloadPdf: rawDownloadPdf,
} = usePdfDownload();

async function downloadPdf() {
  if (!markdownContent.value) return;
  const hint = props.selectedResult.data?.filenameHint;
  const title = hint
    ? hint.replace(/[/\\:*?"<>|]/g, "_")
    : props.selectedResult.title
      ? props.selectedResult.title.replace(/[/\\:*?"<>|]/g, "_")
      : "document";
  await rawDownloadPdf(markdownContent.value, `${title}.pdf`);
}

async function applyMarkdown() {
  const raw = props.selectedResult.data?.markdown;
  if (!raw) return;

  saveError.value = null;

  // If file-based, save to server
  if (isFilePath(raw)) {
    saving.value = true;
    try {
      const filename = raw.replace(/^markdowns\//, "");
      const res = await fetch(`/api/markdowns/${filename}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: editableMarkdown.value }),
      });
      if (!res.ok) {
        saveError.value = `Save failed: ${res.status} ${res.statusText}`;
        return;
      }
    } catch (err) {
      saveError.value = `Save failed: ${err instanceof Error ? err.message : String(err)}`;
      return;
    } finally {
      saving.value = false;
    }
  }

  // Update local state
  markdownContent.value = editableMarkdown.value;

  // Emit update to parent (clears pdfPath since content changed)
  const updatedResult: ToolResult<MarkdownToolData> = {
    ...props.selectedResult,
    data: {
      ...props.selectedResult.data,
      markdown: isFilePath(raw) ? raw : editableMarkdown.value,
      pdfPath: undefined,
    },
  };
  emit("updateResult", updatedResult);

  // Close the edit panel
  if (sourceDetails.value) sourceDetails.value.open = false;
}

// Watch for external changes to selectedResult (when user clicks different result)
watch(
  () => props.selectedResult.data?.markdown,
  () => {
    fetchMarkdownContent();
  },
);
</script>

<style scoped>
.markdown-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
}

.markdown-content-wrapper {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1em;
}

.document-title {
  font-size: 2em;
  margin: 0;
}

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

.bottom-bar-wrapper {
  position: relative;
  flex-shrink: 0;
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

.markdown-source {
  padding: 0.5rem;
  background: #f5f5f5;
  border-top: 1px solid #e0e0e0;
  font-family: monospace;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.markdown-source summary {
  cursor: pointer;
  user-select: none;
  padding: 0.5rem;
  background: #e8e8e8;
  border-radius: 4px;
  font-weight: 500;
  color: #333;
}

.markdown-source[open] summary {
  margin-bottom: 0.5rem;
}

.markdown-source summary:hover {
  background: #d8d8d8;
}

.markdown-editor {
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

.markdown-editor:focus {
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

.editor-actions {
  display: flex;
  justify-content: space-between;
}

.save-error {
  margin: 0.5rem 0 0;
  padding: 0.4rem 0.6rem;
  background: #fdecea;
  color: #b71c1c;
  border: 1px solid #f5c2c7;
  border-radius: 4px;
  font-size: 0.85rem;
}

.cancel-btn {
  padding: 0.5rem 1rem;
  background: #e0e0e0;
  color: #333;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s;
  font-weight: 500;
}

.cancel-btn:hover {
  background: #d0d0d0;
}
</style>
