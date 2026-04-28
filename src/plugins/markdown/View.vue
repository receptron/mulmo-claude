<template>
  <div class="markdown-container">
    <div v-if="loading" class="min-h-full p-8 flex items-center justify-center">
      <div class="text-gray-500">{{ t("pluginMarkdown.loading") }}</div>
    </div>
    <div v-else-if="loadError && !markdownContent" class="min-h-full p-8 flex items-center justify-center">
      <div class="load-error-banner" role="alert">{{ t("pluginMarkdown.loadFailed", { error: loadError }) }}</div>
    </div>
    <div v-else-if="!markdownContent" class="min-h-full p-8 flex items-center justify-center">
      <div class="text-gray-500">{{ t("pluginMarkdown.noContent") }}</div>
    </div>
    <template v-else>
      <div class="flex items-center justify-end gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
        <button
          class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          :disabled="pdfDownloading"
          @click="downloadPdf"
        >
          <span class="material-icons text-base">{{ pdfDownloading ? "hourglass_empty" : "download" }}</span>
          {{ t("pluginMarkdown.pdf") }}
        </button>
        <span v-if="pdfError" class="text-xs text-red-500" :title="pdfError">{{ t("pluginMarkdown.pdfFailedShort") }}</span>
      </div>
      <div v-if="loadError" class="load-error-banner" role="alert">
        {{ t("pluginMarkdown.refreshFailed", { error: loadError }) }}
      </div>
      <div class="markdown-content-wrapper">
        <div class="p-4">
          <!-- Frontmatter properties panel (FileContentRenderer-style)
               — only rendered when the file has a `---\n...\n---`
               header. Lazy-on-write means most existing files don't
               have one yet (#895). -->
          <div v-if="mdDoc.fields.length > 0" class="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-xs">
            <div v-for="field in mdDoc.fields" :key="field.key" class="flex items-baseline gap-2 py-0.5">
              <span class="font-semibold text-gray-600 shrink-0">{{ field.key }}:</span>
              <template v-if="Array.isArray(field.value)">
                <span class="flex flex-wrap gap-1">
                  <span
                    v-for="(item, idx) in field.value"
                    :key="String(idx) + ':' + formatScalarField(item)"
                    class="rounded-full bg-white border border-gray-300 px-2 py-0.5 text-gray-700"
                  >
                    {{ formatScalarField(item) }}
                  </span>
                </span>
              </template>
              <span v-else class="text-gray-800 break-words">{{ formatScalarField(field.value) }}</span>
            </div>
          </div>
          <!-- Click delegation: a single listener on the wrapper picks
               up every interactive checkbox inserted by v-html. We
               cannot bind @click directly on each `<input>` because
               v-html bypasses Vue's template compiler. -->
          <div class="markdown-content prose prose-slate max-w-none" @click="onMarkdownClick" v-html="renderedHtml"></div>
        </div>
      </div>

      <div class="bottom-bar-wrapper">
        <details ref="sourceDetails" class="markdown-source" @toggle="onDetailsToggle">
          <summary>{{ t("pluginMarkdown.editSource") }}</summary>
          <textarea v-model="editableMarkdown" class="markdown-editor" spellcheck="false"></textarea>
          <div class="editor-actions">
            <button class="apply-btn" :disabled="!hasChanges || saving" @click="applyMarkdown">
              {{ saving ? t("pluginMarkdown.saving") : t("pluginMarkdown.applyChanges") }}
            </button>
            <button class="cancel-btn" @click="cancelEdit">{{ t("pluginMarkdown.cancel") }}</button>
          </div>
          <p v-if="saveError" class="save-error" role="alert">{{ t("pluginMarkdown.saveError", { error: saveError }) }}</p>
        </details>
        <button v-show="!editing" class="copy-btn" :title="copied ? t('pluginMarkdown.copiedLabel') : t('pluginMarkdown.copyLabel')" @click="copyText">
          <span class="material-icons">{{ copied ? "check" : "content_copy" }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import { formatScalarField, useMarkdownDoc } from "../../composables/useMarkdownDoc";
import type { ToolResult } from "gui-chat-protocol";
import { isFilePath, type MarkdownToolData } from "./definition";
import { rewriteMarkdownImageRefs } from "../../utils/image/rewriteMarkdownImageRefs";
import { findTaskLines, makeTasksInteractive, toggleTaskAt } from "../../utils/markdown/taskList";
import { usePdfDownload } from "../../composables/usePdfDownload";
import { apiGet, apiPut } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { useClipboardCopy } from "../../composables/useClipboardCopy";
import { buildPdfFilename } from "../../utils/files/filename";
import { useAppApi } from "../../composables/useAppApi";

const { t } = useI18n();

const props = defineProps<{
  selectedResult: ToolResult<MarkdownToolData>;
}>();

const emit = defineEmits<{
  updateResult: [result: ToolResult<MarkdownToolData>];
}>();

const appApi = useAppApi();

const loading = ref(false);
const saving = ref(false);
// Human-readable message shown next to the Save button when a PUT
// fails. null while the editor is idle or the last save succeeded.
const saveError = ref<string | null>(null);
// Error loading the markdown content from the server. Distinct from an
// intentionally empty document — we used to wipe `markdownContent` on
// failure, which made "fetch failed" look like "no content available".
const loadError = ref<string | null>(null);
// The actual markdown content (fetched from server or inline)
const markdownContent = ref("");
const editableMarkdown = ref("");

async function fetchMarkdownContent(): Promise<void> {
  loadError.value = null;
  const raw = props.selectedResult.data?.markdown;
  if (!raw) {
    markdownContent.value = "";
    editableMarkdown.value = "";
    return;
  }
  if (isFilePath(raw)) {
    loading.value = true;
    const result = await apiGet<{ content?: string }>(API_ROUTES.files.content, {
      path: raw,
    });
    if (!result.ok) {
      // Preserve any previously-loaded content instead of wiping it —
      // the user sees the banner AND whatever they were reading, not
      // a blank canvas. editableMarkdown is left in sync so the editor
      // (if open) doesn't flip between states.
      loadError.value = result.error;
      loading.value = false;
      return;
    }
    markdownContent.value = result.data.content ?? "";
    loading.value = false;
  } else {
    // Legacy inline content
    markdownContent.value = raw;
  }
  editableMarkdown.value = markdownContent.value;
}

// Fetch on mount
fetchMarkdownContent();

const hasChanges = computed(() => editableMarkdown.value !== markdownContent.value);

// Frontmatter-aware view of the loaded content — separates the
// `---\n...\n---` header (rendered as a properties panel) from the
// markdown body (passed to marked). Without this split the header
// would render as a stray `<hr>` plus key:value plain text in
// every file the LLM saved with frontmatter (#895 PR A).
const mdDoc = useMarkdownDoc(markdownContent);

const renderedHtml = computed(() => {
  if (!markdownContent.value) return "";
  // Rewrite workspace-relative image refs BEFORE marked parses them —
  // same approach as wiki/View.vue and FilesView.vue. Markdown files
  // under `markdowns/<year>/foo.md` typically use `../images/x.png`,
  // so the basePath is the directory of the file; for inline legacy
  // content we have no path, so basePath is empty and only rooted
  // references get rewritten.
  const raw = props.selectedResult.data?.markdown;
  const basePath = typeof raw === "string" && isFilePath(raw) ? raw.slice(0, raw.lastIndexOf("/")) : "";
  const withImages = rewriteMarkdownImageRefs(mdDoc.value.body, basePath);
  // Strip the `disabled=""` attribute marked puts on GFM task
  // checkboxes and tag them so `onMarkdownClick` can find them
  // (#775). Inline content (no file backing) gets the same
  // treatment so non-file-backed sessions still feel responsive,
  // even though clicks there only update local state.
  return makeTasksInteractive(marked(withImages) as string);
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
const { copied, copy } = useClipboardCopy();

function onDetailsToggle(event: Event) {
  const { open } = event.target as HTMLDetailsElement;
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
  await copy(markdownContent.value);
}

const { pdfDownloading, pdfError, downloadPdf: rawDownloadPdf } = usePdfDownload();

async function downloadPdf() {
  if (!markdownContent.value) return;
  const prefix = props.selectedResult.data?.filenamePrefix;
  const rawName = prefix || props.selectedResult.title || "";
  const { uuid } = props.selectedResult;
  const filename = buildPdfFilename({
    name: rawName,
    fallback: "document",
    timestampMs: uuid ? appApi.getResultTimestamp(uuid) : undefined,
  });
  await rawDownloadPdf(markdownContent.value, filename);
}

async function applyMarkdown() {
  const raw = props.selectedResult.data?.markdown;
  if (!raw) return;

  saveError.value = null;

  // If file-based, save to server. The `raw` value is the
  // workspace-relative path returned by the server, so we send it
  // verbatim — the route accepts any depth under `artifacts/documents/`
  // (e.g. the YYYY/MM partitions added in #764).
  if (isFilePath(raw)) {
    saving.value = true;
    const result = await apiPut<unknown>(API_ROUTES.plugins.updateMarkdown, {
      relativePath: raw,
      markdown: editableMarkdown.value,
    });
    saving.value = false;
    if (!result.ok) {
      // Store the raw error; the template formats it via t() so locale
      // switches re-render without double-translating.
      saveError.value = result.error;
      return;
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

// ── Inline task-list checkbox toggle (#775) ──────────────────────
//
// Click delegation handler bound to the rendered viewer. When the
// user clicks a GFM task checkbox we:
//   1. compute the new source via `toggleTaskAt`
//   2. update local state optimistically (v-html re-renders to match)
//   3. for file-backed docs, queue a PUT through the existing
//      `/api/markdowns/update` route
//
// Skipped while the source editor is open — the textarea has its own
// edit/apply flow and a checkbox click would race with whatever the
// user is typing.

let taskPersistChain: Promise<unknown> = Promise.resolve();

async function persistTaskMarkdown(relativePath: string, markdown: string): Promise<void> {
  // Bail if the user navigated to a different result while this PUT
  // was queued — the snapshot belongs to a document that's no longer
  // on screen, and persisting it would clobber unrelated state.
  if (props.selectedResult.data?.markdown !== relativePath) return;

  const result = await apiPut<unknown>(API_ROUTES.plugins.updateMarkdown, {
    relativePath,
    markdown,
  });

  // The user may have switched results during the round-trip. Skip
  // every state mutation past this point — the watcher on
  // `selectedResult.data?.markdown` already loads the new document,
  // and writing `saveError` / triggering a refetch here would touch
  // unrelated state (or refetch the *new* doc, masking edits the
  // user just made there).
  if (props.selectedResult.data?.markdown !== relativePath) return;

  if (!result.ok) {
    saveError.value = result.error;
    // Refetch synchronously inside the chain so subsequent queued
    // clicks observe the canonical (server-side) markdown before
    // computing their own toggle. Detaching this with `void` could
    // let the refetch land after a newer click already wrote.
    await fetchMarkdownContent();
    return;
  }
  // Clear any stale error from a prior failed click.
  saveError.value = null;
}

function onMarkdownClick(event: MouseEvent): void {
  const { target } = event;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== "checkbox") return;
  if (!target.classList.contains("md-task")) return;
  if (editing.value) {
    // Edit panel open — let the textarea own the source. Reverting
    // here keeps the visual in sync with the still-untouched markdown.
    target.checked = !target.checked;
    return;
  }

  const root = event.currentTarget as HTMLElement;
  const taskInputs = root.querySelectorAll<HTMLInputElement>("input.md-task");
  const taskIndex = Array.from(taskInputs).indexOf(target);
  if (taskIndex < 0) return;

  // Cross-check: if the source-side walker sees a different number
  // of tasks than `marked` rendered into the DOM, the index map
  // can't be trusted. The most common cause is a `- [ ]`-shaped line
  // inside a 4-space indented code block (the source walker treats
  // it as a task; marked treats it as code) — toggling source by
  // index would corrupt the file. Refuse all clicks when this
  // happens.
  // Walk only the body (the same source `marked` rendered) so
  // frontmatter contents containing `- [ ]`-shaped YAML never
  // collide with task counting (#895 PR A). The prefix is
  // preserved byte-for-byte and re-attached after the toggle.
  const { body } = mdDoc.value;
  const prefix = markdownContent.value.slice(0, markdownContent.value.length - body.length);
  const sourceTasks = findTaskLines(body);
  if (sourceTasks.length !== taskInputs.length) {
    target.checked = !target.checked;
    saveError.value = t("pluginMarkdown.taskCountMismatch");
    return;
  }

  const updatedBody = toggleTaskAt(body, taskIndex);
  if (updatedBody === null) {
    // Source/DOM drift — refuse to write something we can't trace.
    target.checked = !target.checked;
    return;
  }

  const updated = prefix + updatedBody;
  // Optimistic local update — v-html will re-render and the
  // textarea (if anyone opens it next) sees the same content.
  markdownContent.value = updated;
  editableMarkdown.value = updated;

  const raw = props.selectedResult.data?.markdown;
  if (typeof raw === "string" && isFilePath(raw)) {
    // Serialize PUTs so quick successive clicks don't race each
    // other on the wire — the chain captures `updated` per click.
    taskPersistChain = taskPersistChain.then(() => persistTaskMarkdown(raw, updated));
  } else {
    // Inline content — emit so the parent stores the edit.
    emit("updateResult", {
      ...props.selectedResult,
      data: {
        ...props.selectedResult.data,
        markdown: updated,
        pdfPath: undefined,
      },
    });
  }
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

.load-error-banner {
  margin: 0.75rem 1rem;
  padding: 0.5rem 0.75rem;
  background: #fdecea;
  color: #b71c1c;
  border: 1px solid #f5c2c7;
  border-radius: 4px;
  font-size: 0.875rem;
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
