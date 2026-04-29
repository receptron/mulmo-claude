<template>
  <div class="html-container">
    <div class="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between">
      <span class="text-sm font-medium text-gray-700 truncate">{{ title ?? t("pluginPresentHtml.untitled") }}</span>
      <button
        class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 shrink-0"
        :title="t('pluginPresentHtml.saveAsPdf')"
        @click="printToPdf"
      >
        <span class="material-icons text-sm align-middle">picture_as_pdf</span>
        {{ t("pluginPresentHtml.pdf") }}
      </button>
    </div>
    <div class="iframe-wrapper">
      <iframe v-if="previewUrl" :src="previewUrl" sandbox="allow-scripts" class="w-full h-full border-0" />
      <div v-else class="h-full flex items-center justify-center text-sm text-gray-500">
        {{ t("pluginPresentHtml.untitled") }}
      </div>
    </div>

    <div class="bottom-bar-wrapper">
      <details ref="sourceDetails" class="html-source" @toggle="onDetailsToggle">
        <summary>{{ t("pluginPresentHtml.editSource") }}</summary>
        <div v-if="sourceError" class="load-error-banner" role="alert">
          {{ t("pluginPresentHtml.sourceError", { error: sourceError }) }}
        </div>
        <textarea
          v-model="editableHtml"
          :disabled="sourceLoading"
          :placeholder="sourceLoading ? t('pluginPresentHtml.loadingSource') : ''"
          spellcheck="false"
          class="html-editor"
        ></textarea>
        <div class="editor-actions">
          <button class="apply-btn" :disabled="!hasChanges || saving || sourceLoading" @click="applyHtml">
            {{ saving ? t("pluginPresentHtml.saving") : t("pluginPresentHtml.applyChanges") }}
          </button>
          <button class="cancel-btn" @click="cancelEdit">{{ t("pluginPresentHtml.cancel") }}</button>
        </div>
        <p v-if="saveError" class="save-error" role="alert">{{ t("pluginPresentHtml.saveError", { error: saveError }) }}</p>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentHtmlData } from "./index";
import { htmlPreviewUrlFor } from "../../composables/useContentDisplay";
import { apiFetchRaw, apiPut } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { errorMessage } from "../../utils/errors";
import { buildPrintCspContent } from "../../utils/html/previewCsp";
import { useFileChange } from "../../composables/useFileChange";

const { t } = useI18n();

const props = defineProps<{
  selectedResult: ToolResultComplete<PresentHtmlData>;
}>();

const PRINT_STYLE_CSS = `@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { width: 100% !important; margin: 0 !important; padding: 8px !important; }
  @page { margin: 10mm; }
}`;

// Inline auto-print script tags injected into the hidden print iframe.
// Both opening and closing tags are built by concatenation so the raw
// open- and close-script byte sequences never appear verbatim in this
// source file — otherwise the Vue SFC HTML parser would either misread
// an inner opening tag as a new block, or terminate the surrounding
// setup block early.
// eslint-disable-next-line no-useless-concat -- prevent the opening-script byte sequence from appearing in source; see comment above
const PRINT_SCRIPT_OPEN_TAG = `<` + `script>`;
// eslint-disable-next-line no-useless-concat -- prevent the closing-script byte sequence from appearing in source; see comment above
const PRINT_SCRIPT_CLOSE_TAG = `<` + `/script>`;
const PRINT_AUTO_SCRIPT = `${PRINT_SCRIPT_OPEN_TAG}addEventListener("load", () => setTimeout(() => window.print(), 100));${PRINT_SCRIPT_CLOSE_TAG}`;

const data = computed(() => props.selectedResult.data);
const title = computed(() => data.value?.title);
const filePath = computed(() => data.value?.filePath ?? null);

// `version` bumps to the post-write `mtimeMs` whenever any tab (or
// browser, or the agent loop) writes this file. Wired to the iframe
// `:src` as `?v=<mtime>` so the browser cache-busts the stale page.
const { version: previewVersion } = useFileChange(filePath);
const previewUrl = computed(() => {
  const base = htmlPreviewUrlFor(filePath.value);
  if (!base) return null;
  return previewVersion.value > 0 ? `${base}?v=${previewVersion.value}` : base;
});

const sourceDetails = ref<HTMLDetailsElement>();
const editing = ref(false);
// Keyed by filePath so a remounted/reused View instance with a
// different selectedResult does not return stale source.
const sourceCache = ref<Record<string, string>>({});
const sourceLoading = ref(false);
const sourceError = ref<string | null>(null);
const editableHtml = ref("");
const saving = ref(false);
const saveError = ref<string | null>(null);

const cachedSource = computed(() => (filePath.value ? (sourceCache.value[filePath.value] ?? null) : null));
const hasChanges = computed(() => cachedSource.value !== null && editableHtml.value !== cachedSource.value);

async function fetchSource(): Promise<string | null> {
  const path = filePath.value;
  if (!path) return null;
  const hit = sourceCache.value[path];
  if (hit !== undefined) return hit;
  sourceLoading.value = true;
  sourceError.value = null;
  try {
    const resp = await apiFetchRaw(API_ROUTES.files.raw, { query: { path } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    // Stale-response guard: only commit the result if the user has
    // not navigated to a different file in the meantime.
    if (filePath.value === path) {
      sourceCache.value = { ...sourceCache.value, [path]: text };
      // Seed the editor with the fresh source if the user hasn't
      // started typing — avoids clobbering an in-progress edit if a
      // refetch races with user input.
      if (editableHtml.value === "") {
        editableHtml.value = text;
      }
    }
    return text;
  } catch (err) {
    if (filePath.value === path) {
      sourceError.value = errorMessage(err);
    }
    return null;
  } finally {
    if (filePath.value === path) {
      sourceLoading.value = false;
    }
  }
}

function onDetailsToggle(event: Event) {
  const { open } = event.target as HTMLDetailsElement;
  editing.value = open;
  if (open) {
    saveError.value = null;
    editableHtml.value = cachedSource.value ?? "";
    if (cachedSource.value === null) {
      void fetchSource();
    }
  } else {
    editableHtml.value = cachedSource.value ?? "";
    saveError.value = null;
  }
}

function cancelEdit() {
  if (sourceDetails.value) sourceDetails.value.open = false;
}

async function applyHtml() {
  const path = filePath.value;
  if (!path) return;
  saveError.value = null;
  saving.value = true;
  const result = await apiPut<{ path: string }>(API_ROUTES.html.update, {
    relativePath: path,
    html: editableHtml.value,
  });
  saving.value = false;
  if (!result.ok) {
    saveError.value = result.error;
    return;
  }
  // Commit the just-saved text as the canonical source so the editor
  // doesn't refetch over its own write when the file-change event
  // arrives. Iframe cache-bust happens via `previewVersion` when the
  // event lands.
  sourceCache.value = { ...sourceCache.value, [path]: editableHtml.value };
  if (sourceDetails.value) sourceDetails.value.open = false;
}

// When the user navigates to a different result, reset the editor so
// stale text from the previous file doesn't carry over. `previewVersion`
// resets inside the composable when `filePath` flips.
watch(filePath, () => {
  if (sourceDetails.value) sourceDetails.value.open = false;
  editableHtml.value = "";
  saveError.value = null;
  sourceError.value = null;
});

// Remote write detected: invalidate the editor's cached source so the
// next read goes back to disk. If the edit panel is open AND the user
// has no pending changes, silently refresh `editableHtml` to the new
// on-disk text. If they have unsaved edits, leave `editableHtml` alone
// — `cachedSource` becomes the newly-fetched text, `hasChanges` stays
// true, and pressing Apply overwrites the remote change. (Surfacing a
// "remote changed" banner is a follow-up — see
// plans/feat-file-change-pubsub.md.)
watch(previewVersion, async (current, previous) => {
  if (current === 0 || current === previous) return;
  const path = filePath.value;
  if (!path) return;
  // Snapshot dirtiness BEFORE invalidating the cache — `hasChanges`
  // depends on `cachedSource`, which flips to `null` the moment we
  // delete the entry.
  const wasDirty = hasChanges.value;
  const next = { ...sourceCache.value };
  Reflect.deleteProperty(next, path);
  sourceCache.value = next;
  if (sourceDetails.value?.open === true) {
    const fresh = await fetchSource();
    if (fresh !== null && !wasDirty) {
      editableHtml.value = fresh;
    }
  }
});

// Build the print-mode HTML by injecting four pieces into <head>:
// (1) `<base href>` so relative refs in the LLM HTML
// (`../../../images/...`) resolve against the file's real URL.
// (2) `<meta CSP>` with `img-src ${origin}` — the print iframe is
// srcdoc, so its origin is opaque and `'self'` would not match.
// (3) PRINT_STYLE_CSS for color-exact print and tight margins.
// (4) Auto-print script — fires `window.print()` once load completes.
// Match `</head>` case-insensitively with optional whitespace before
// the `>` — same convention as `wrapHtmlWithPreviewCsp` so uppercase
// or weird whitespace LLM HTML still gets the injection.
const HEAD_CLOSE_RE = /<\/head\s*>/i;

function buildPrintableHtml(sourceHtml: string, baseHrefDir: string): string {
  const cspContent = buildPrintCspContent(window.location.origin);
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${cspContent}">`;
  const baseTag = `<base href="${baseHrefDir}">`;
  const styleTag = `<style>${PRINT_STYLE_CSS}</style>`;
  const injection = `${baseTag}${cspMeta}${styleTag}${PRINT_AUTO_SCRIPT}`;
  const match = HEAD_CLOSE_RE.exec(sourceHtml);
  if (match) {
    return sourceHtml.replace(match[0], `${injection}${match[0]}`);
  }
  return `<head>${injection}</head>${sourceHtml}`;
}

function printableBaseHrefDir(filePathValue: string): string | null {
  const previewPath = htmlPreviewUrlFor(filePathValue);
  if (!previewPath) return null;
  // Strip filename: `/artifacts/html/2026/04/page.html` -> `/artifacts/html/2026/04/`
  const lastSlash = previewPath.lastIndexOf("/");
  return lastSlash >= 0 ? previewPath.slice(0, lastSlash + 1) : previewPath;
}

async function printToPdf() {
  if (!filePath.value) return;
  const baseHrefDir = printableBaseHrefDir(filePath.value);
  if (!baseHrefDir) return;
  const sourceHtml = await fetchSource();
  if (sourceHtml === null) {
    // Reuse the sourceError banner so the user sees the failure
    // without shipping a second error UI. Open the edit panel so the
    // banner is visible.
    if (sourceDetails.value) sourceDetails.value.open = true;
    return;
  }
  const printable = buildPrintableHtml(sourceHtml, baseHrefDir);
  const printFrame = document.createElement("iframe");
  printFrame.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;border:0";
  printFrame.sandbox.value = "allow-scripts allow-modals";
  printFrame.srcdoc = printable;
  document.body.appendChild(printFrame);
  // Browsers keep the iframe alive until the user dismisses the
  // print dialog. Schedule a long-tail cleanup so the frame does not
  // leak even if the dialog stays open.
  setTimeout(() => printFrame.remove(), 60_000);
}
</script>

<style scoped>
.html-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
  overflow: hidden;
}

.iframe-wrapper {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.bottom-bar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.html-source {
  padding: 0.5rem;
  background: #f5f5f5;
  border-top: 1px solid #e0e0e0;
  font-family: monospace;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.html-source summary {
  cursor: pointer;
  user-select: none;
  padding: 0.5rem;
  background: #e8e8e8;
  border-radius: 4px;
  font-weight: 500;
  color: #333;
}

.html-source[open] summary {
  margin-bottom: 0.5rem;
}

.html-source summary:hover {
  background: #d8d8d8;
}

.html-editor {
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

.html-editor:focus {
  outline: none;
  border-color: #4caf50;
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.1);
}

.html-editor:disabled {
  background: #f5f5f5;
  color: #888;
  cursor: not-allowed;
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
  margin: 0 0 0.5rem;
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
