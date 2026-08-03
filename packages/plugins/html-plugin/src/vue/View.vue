<template>
  <div class="html-container">
    <div class="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between gap-2">
      <span class="text-sm font-medium text-gray-700 truncate">{{ title ?? t.untitled }}</span>
      <div class="flex items-center gap-2 shrink-0">
        <button
          class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          :title="t.downloadZip"
          :disabled="downloading || !filePath"
          data-testid="present-html-download"
          @click="downloadZip"
        >
          <span class="material-icons text-sm align-middle">download</span>
          {{ t.download }}
        </button>
        <button class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50" :title="t.saveAsPdf" @click="printToPdf">
          <span class="material-icons text-sm align-middle">picture_as_pdf</span>
          {{ t.pdf }}
        </button>
      </div>
    </div>
    <div v-if="downloadError" class="download-error" role="alert">{{ t.downloadError(downloadError) }}</div>
    <div class="iframe-wrapper">
      <iframe v-if="frameSrc" data-testid="present-html-iframe" :src="frameSrc" sandbox="allow-scripts" class="w-full h-full border-0" />
      <div v-else class="h-full flex items-center justify-center text-sm text-gray-500">
        {{ t.untitled }}
      </div>
    </div>

    <div class="bottom-bar-wrapper">
      <details ref="sourceDetails" class="html-source" @toggle="onDetailsToggle">
        <summary>{{ t.editSource }}</summary>
        <div v-if="sourceError" class="load-error-banner" role="alert">
          {{ t.sourceError(sourceError) }}
        </div>
        <textarea
          v-model="editableHtml"
          :disabled="sourceLoading"
          :placeholder="sourceLoading ? t.loadingSource : ''"
          spellcheck="false"
          class="html-editor"
        ></textarea>
        <div class="editor-actions">
          <button class="apply-btn" :disabled="!hasChanges || saving || sourceLoading" @click="applyHtml">
            {{ saving ? t.saving : t.applyChanges }}
          </button>
          <button class="cancel-btn" @click="cancelEdit">{{ t.cancel }}</button>
        </div>
        <p v-if="saveError" class="save-error" role="alert">{{ t.saveError(saveError) }}</p>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRuntime, type ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentHtmlData } from "../core/types";
import { readLoadHtmlResult, readPackHtmlResult, readSaveHtmlResult } from "../core/contract";
import { htmlArtifactPreviewUrl } from "../core/paths";
import { useT } from "../lang";
import { buildPrintCspContent } from "./previewCsp";
import { useFileWatch } from "@mulmoclaude/core/plugin-vue";
import { errorMessage } from "@mulmoclaude/common";

const runtime = useRuntime();
const t = useT();

const props = defineProps<{
  selectedResult: ToolResultComplete<PresentHtmlData>;
}>();

const PRINT_STYLE_CSS = `@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { width: 100% !important; margin: 0 !important; padding: 8px !important; }
  @page { margin: 10mm; }
}`;

// Inline auto-print script tags injected into the hidden print iframe. Both
// tags are built by concatenation so the raw open/close-script byte sequences
// never appear verbatim in this SFC source (the Vue SFC parser would otherwise
// misread them).
const PRINT_SCRIPT_OPEN_TAG = `<` + `script>`;
const PRINT_SCRIPT_CLOSE_TAG = `<` + `/script>`;
const PRINT_AUTO_SCRIPT = `${PRINT_SCRIPT_OPEN_TAG}addEventListener("load", () => setTimeout(() => window.print(), 100));${PRINT_SCRIPT_CLOSE_TAG}`;

const data = computed(() => props.selectedResult.data);
const title = computed(() => data.value?.title);
const filePath = computed(() => data.value?.filePath ?? null);

// `version` bumps to the post-write `mtimeMs` whenever any tab / the agent loop
// rewrites this file. Wired to the iframe `:src` as `?v=<mtime>` so the browser
// cache-busts the stale page.
const { version: previewVersion } = useFileWatch(filePath);

// Prefer the host-injected served URL (`data.previewUrl`) when present — a host
// can serve `artifacts/html/…` at a custom path. Otherwise derive the default
// `/artifacts/html/…` URL from `filePath` so already-presented results (whose
// stored data predates `previewUrl`) still render. Relative asset refs resolve
// against this real URL. Single source for BOTH the iframe render and the print
// base href, so they stay in lockstep for pre-`previewUrl` artifacts.
const previewBaseUrl = computed(() => data.value?.previewUrl ?? htmlArtifactPreviewUrl(filePath.value));

const frameSrc = computed(() => {
  const base = previewBaseUrl.value;
  if (!base) return null;
  return previewVersion.value > 0 ? `${base}?v=${previewVersion.value}` : base;
});

const sourceDetails = ref<HTMLDetailsElement>();
// Keyed by filePath so a remounted/reused View instance with a different
// selectedResult does not return stale source.
const sourceCache = ref<Record<string, string>>({});
const sourceLoading = ref(false);
const sourceError = ref<string | null>(null);
const editableHtml = ref("");
const saving = ref(false);
const saveError = ref<string | null>(null);
const downloading = ref(false);
const downloadError = ref<string | null>(null);

// Decode the base64 zip returned by the host into a Blob and trigger a
// browser download — keeps the transport JSON-safe over `dispatch`.
function triggerBlobDownload(zipBase64: string, filename: string) {
  const bytes = Uint8Array.from(atob(zipBase64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function downloadZip() {
  const path = filePath.value;
  if (!path || downloading.value) return;
  downloading.value = true;
  downloadError.value = null;
  try {
    const { zipBase64, filename } = await runtime.dispatch({ kind: "packHtml", path }, readPackHtmlResult);
    triggerBlobDownload(zipBase64, filename);
  } catch (err) {
    downloadError.value = errorMessage(err);
  } finally {
    downloading.value = false;
  }
}

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
    const { html } = await runtime.dispatch({ kind: "loadHtml", path }, readLoadHtmlResult);
    // Stale-response guard: only commit if the user hasn't navigated away.
    if (filePath.value === path) {
      sourceCache.value = { ...sourceCache.value, [path]: html };
      // Seed the editor only if the user hasn't started typing — avoids
      // clobbering an in-progress edit if a refetch races with input.
      if (editableHtml.value === "") {
        editableHtml.value = html;
      }
    }
    return html;
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
  try {
    await runtime.dispatch({ kind: "saveHtml", path, html: editableHtml.value }, readSaveHtmlResult);
    // Commit the just-saved text as canonical so the editor doesn't refetch
    // over its own write when the file-change event arrives. Iframe cache-bust
    // happens via `previewVersion` when the event lands.
    sourceCache.value = { ...sourceCache.value, [path]: editableHtml.value };
    if (sourceDetails.value) sourceDetails.value.open = false;
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

// Reset the editor when the user navigates to a different result so stale text
// doesn't carry over. `previewVersion` resets inside the composable when
// `filePath` flips.
watch(filePath, () => {
  if (sourceDetails.value) sourceDetails.value.open = false;
  editableHtml.value = "";
  saveError.value = null;
  sourceError.value = null;
});

// Remote write detected: invalidate the editor's cached source so the next read
// goes back to disk. If the edit panel is open AND the user has no pending
// changes, silently refresh `editableHtml`; otherwise leave their edits alone.
watch(previewVersion, async (current, previous) => {
  if (current === 0 || current === previous) return;
  const path = filePath.value;
  if (!path) return;
  // Snapshot dirtiness BEFORE invalidating the cache — `hasChanges` depends on
  // `cachedSource`, which flips to null the moment we delete the entry.
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

// Build the print-mode HTML by injecting four pieces into <head>: a `<base href>`
// so relative refs resolve against the file's real URL, a `<meta CSP>` with the
// explicit origin (srcdoc is opaque-origin so `'self'` wouldn't match), the
// print stylesheet, and the auto-print script. Match `</head>`
// case-insensitively (same convention as the preview CSP wrapper).
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

// Strip the filename from the host-served preview URL:
// `/artifacts/html/2026/04/page.html` -> `/artifacts/html/2026/04/`
function printableBaseHrefDir(previewUrlValue: string): string {
  const lastSlash = previewUrlValue.lastIndexOf("/");
  return lastSlash >= 0 ? previewUrlValue.slice(0, lastSlash + 1) : previewUrlValue;
}

async function printToPdf() {
  // Same fallback source as `frameSrc` — print must work for legacy results
  // that have no persisted `previewUrl`, exactly like the iframe render.
  const url = previewBaseUrl.value;
  if (!url) return;
  const baseHrefDir = printableBaseHrefDir(url);
  const sourceHtml = await fetchSource();
  if (sourceHtml === null) {
    // Reuse the sourceError banner so the failure is visible; open the panel.
    if (sourceDetails.value) sourceDetails.value.open = true;
    return;
  }
  const printable = buildPrintableHtml(sourceHtml, baseHrefDir);
  const printFrame = document.createElement("iframe");
  printFrame.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;border:0";
  printFrame.sandbox.value = "allow-scripts allow-modals";
  printFrame.srcdoc = printable;
  document.body.appendChild(printFrame);
  // Browsers keep the iframe alive until the print dialog is dismissed.
  // Schedule a long-tail cleanup so the frame doesn't leak.
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
  font-family: Consolas, "MS Gothic", "BIZ UDGothic", monospace;
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
  font-family: "Courier New", "MS Gothic", "BIZ UDGothic", monospace;
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

.download-error {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #fdecea;
  color: #b71c1c;
  border-bottom: 1px solid #f5c2c7;
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
