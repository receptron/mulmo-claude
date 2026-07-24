<template>
  <div class="svg-container">
    <div class="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between gap-2">
      <span class="text-sm font-medium text-gray-700 truncate">{{ title ?? t("pluginPresentSvg.untitled") }}</span>
      <div class="flex items-center gap-2 shrink-0">
        <span v-if="exportError" class="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1" role="alert">
          {{ t("pluginPresentSvg.exportError", { error: exportError }) }}
        </span>
        <button
          class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
          :disabled="!previewUrl"
          :title="t('pluginPresentSvg.saveAsPng')"
          @click="exportPng"
        >
          <span class="material-icons text-sm align-middle">image</span>
          {{ t("pluginPresentSvg.png") }}
        </button>
        <button
          class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
          :disabled="!previewUrl"
          :title="t('pluginPresentSvg.saveAsPdf')"
          @click="printToPdf"
        >
          <span class="material-icons text-sm align-middle">picture_as_pdf</span>
          {{ t("pluginPresentSvg.pdf") }}
        </button>
      </div>
    </div>
    <div class="image-wrapper">
      <img v-if="previewUrl" :src="previewUrl" :alt="title ?? t('pluginPresentSvg.untitled')" data-testid="present-svg-image" class="svg-image" />
      <div v-else class="h-full flex items-center justify-center text-sm text-gray-500">
        {{ t("pluginPresentSvg.untitled") }}
      </div>
    </div>

    <div class="bottom-bar-wrapper">
      <details ref="sourceDetails" class="svg-source" @toggle="onDetailsToggle">
        <summary>{{ t("pluginPresentSvg.editSource") }}</summary>
        <div v-if="sourceError" class="load-error-banner" role="alert">
          {{ t("pluginPresentSvg.sourceError", { error: sourceError }) }}
        </div>
        <textarea
          v-model="editableSvg"
          :disabled="sourceLoading"
          :placeholder="sourceLoading ? t('pluginPresentSvg.loadingSource') : ''"
          spellcheck="false"
          class="svg-editor"
        ></textarea>
        <div class="editor-actions">
          <button class="apply-btn" :disabled="!hasChanges || saving || sourceLoading" @click="applySvg">
            {{ saving ? t("pluginPresentSvg.saving") : t("pluginPresentSvg.applyChanges") }}
          </button>
          <button class="cancel-btn" @click="cancelEdit">{{ t("pluginPresentSvg.cancel") }}</button>
        </div>
        <p v-if="saveError" class="save-error" role="alert">{{ t("pluginPresentSvg.saveError", { error: saveError }) }}</p>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentSvgData } from "./index";
import { svgPreviewUrlFor } from "../../composables/useContentDisplay";
import { apiFetchRaw, apiPut } from "../../utils/api";
import { pluginEndpoints } from "../api";
import type { SvgEndpoints } from "./definition";
import { errorMessage } from "../../utils/errors";
import { useFileChange } from "../../composables/useFileChange";
import { saveBlob } from "../../utils/blobDownload";
import { svgExportBaseName } from "./exportName";
import { resolveEditorTextAfterReload } from "./editorRefresh";
import { parseViewBoxAspect, pngCanvasSize } from "./pngExport";
import { buildPrintableHtml } from "./printableHtml";

const endpoints = pluginEndpoints<SvgEndpoints>("svg");
const filesEndpoints = pluginEndpoints<{ raw: string }>("files");

const { t } = useI18n();

const props = defineProps<{
  selectedResult: ToolResultComplete<PresentSvgData>;
}>();

const data = computed(() => props.selectedResult.data);
const title = computed(() => data.value?.title);
const filePath = computed(() => data.value?.filePath ?? null);

const { version: previewVersion } = useFileChange(filePath);
const previewUrl = computed(() => {
  const base = svgPreviewUrlFor(filePath.value);
  if (!base) return null;
  return previewVersion.value > 0 ? `${base}?v=${previewVersion.value}` : base;
});

const sourceDetails = ref<HTMLDetailsElement>();
const sourceCache = ref<Record<string, string>>({});
const sourceLoading = ref(false);
const sourceError = ref<string | null>(null);
const editableSvg = ref("");
const saving = ref(false);
const saveError = ref<string | null>(null);
// PNG export error surfaces next to the toolbar so a failure (canvas
// tainted, `toBlob` returns null, image fetch fails) is visible even
// when the edit-source pane is closed.
const exportError = ref<string | null>(null);

// Own-property reads so a filePath named after an `Object.prototype`
// member can never resolve to an inherited function. (`Object.hasOwn`
// needs es2022 lib — not enabled for the frontend config.)
const hasCached = (path: string): boolean => Object.prototype.hasOwnProperty.call(sourceCache.value, path);

const cachedSource = computed(() => {
  const path = filePath.value;
  if (!path || !hasCached(path)) return null;
  return sourceCache.value[path];
});
const hasChanges = computed(() => cachedSource.value !== null && editableSvg.value !== cachedSource.value);

// Monotonic id so a stale in-flight GET can never overwrite the cache
// entry written by a newer one (the file may change between the two).
let fetchSeq = 0;

async function fetchSource(): Promise<string | null> {
  const path = filePath.value;
  if (!path) return null;
  if (hasCached(path)) return sourceCache.value[path];
  const seq = ++fetchSeq;
  sourceLoading.value = true;
  sourceError.value = null;
  try {
    const resp = await apiFetchRaw(filesEndpoints.raw, { query: { path } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (seq !== fetchSeq || filePath.value !== path) return null;
    sourceCache.value = { ...sourceCache.value, [path]: text };
    return text;
  } catch (err) {
    if (seq === fetchSeq && filePath.value === path) {
      sourceError.value = errorMessage(err);
    }
    return null;
  } finally {
    if (seq === fetchSeq && filePath.value === path) {
      sourceLoading.value = false;
    }
  }
}

function onDetailsToggle(event: Event) {
  const { open } = event.target as HTMLDetailsElement;
  saveError.value = null;
  editableSvg.value = cachedSource.value ?? "";
  if (open && cachedSource.value === null) {
    void fetchSource().then((text) => {
      // The textarea is disabled while loading, so "" here can only mean
      // "not yet populated" — safe to fill without clobbering an edit.
      if (text !== null && sourceDetails.value?.open === true && editableSvg.value === "") {
        editableSvg.value = text;
      }
    });
  }
}

function cancelEdit() {
  if (sourceDetails.value) sourceDetails.value.open = false;
}

async function applySvg() {
  const path = filePath.value;
  if (!path) return;
  const svg = editableSvg.value;
  saveError.value = null;
  saving.value = true;
  const result = await apiPut<{ path: string }>(endpoints.update.url, {
    relativePath: path,
    svg,
  });
  saving.value = false;
  if (!result.ok) {
    if (filePath.value === path) saveError.value = result.error;
    return;
  }
  sourceCache.value = { ...sourceCache.value, [path]: svg };
  if (filePath.value === path && sourceDetails.value) sourceDetails.value.open = false;
}

watch(filePath, () => {
  if (sourceDetails.value) sourceDetails.value.open = false;
  editableSvg.value = "";
  saveError.value = null;
  sourceError.value = null;
  sourceLoading.value = false;
});

watch(previewVersion, async (current, previous) => {
  if (current === 0 || current === previous) return;
  const path = filePath.value;
  if (!path) return;
  const wasDirty = hasChanges.value;
  const next = { ...sourceCache.value };
  Reflect.deleteProperty(next, path);
  sourceCache.value = next;
  if (sourceDetails.value?.open === true) {
    const fresh = await fetchSource();
    editableSvg.value = resolveEditorTextAfterReload({ current: editableSvg.value, fresh, wasDirty });
  }
});

async function printToPdf() {
  const relative = previewUrl.value;
  if (!relative) return;
  exportError.value = null;
  // Pre-flight the URL: a missing file would otherwise fail silently
  // inside the sandboxed iframe (no onerror path back to this component).
  try {
    const resp = await apiFetchRaw(relative);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } catch (err) {
    exportError.value = errorMessage(err);
    return;
  }
  // Iframe srcdoc has an opaque origin, so the `<img>` needs an
  // absolute URL — relative paths would not resolve.
  const printable = buildPrintableHtml(`${window.location.origin}${relative}`);
  const printFrame = document.createElement("iframe");
  printFrame.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;border:0";
  // `allow-scripts` is still needed for the wrapper's inline `onload`
  // handler to fire — but the SVG content itself can't execute scripts
  // because it's loaded via `<img>`. `allow-modals` lets `window.print()`
  // open the print dialog.
  printFrame.sandbox.value = "allow-scripts allow-modals";
  printFrame.srcdoc = printable;
  document.body.appendChild(printFrame);
  setTimeout(() => printFrame.remove(), 60_000);
}

// PNG export — load the SVG into an Image, draw onto a canvas at 2x
// the intrinsic dimensions for crispness, export via toBlob, trigger
// download. The Image is loaded from the same-origin /artifacts/svg/...
// URL, so the canvas is not tainted and toBlob is allowed.
async function exportPng() {
  const url = previewUrl.value;
  if (!url) return;
  exportError.value = null;
  try {
    const blob = await rasterizeToPng(url);
    saveBlob(blob, `${svgExportBaseName(filePath.value)}.png`);
  } catch (err) {
    exportError.value = errorMessage(err);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to load SVG into Image"));
    img.src = url;
  });
}

async function rasterizeToPng(url: string): Promise<Blob> {
  const img = await loadImage(url);
  const needsAspect = img.naturalWidth === 0 || img.naturalHeight === 0;
  const source = needsAspect ? await fetchSource() : null;
  const size = pngCanvasSize(img.naturalWidth, img.naturalHeight, parseViewBoxAspect(source ?? ""));
  return drawToPngBlob(img, size);
}

function drawToPngBlob(img: HTMLImageElement, size: { width: number; height: number }): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("canvas 2D context unavailable"));
      return;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))), "image/png");
  });
}
</script>

<style scoped>
.svg-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
  overflow: hidden;
}

.image-wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: #fafafa;
}

.svg-image {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  display: block;
}

.bottom-bar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.svg-source {
  padding: 0.5rem;
  background: #f5f5f5;
  border-top: 1px solid #e0e0e0;
  font-family: Consolas, "MS Gothic", "BIZ UDGothic", monospace;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.svg-source summary {
  cursor: pointer;
  user-select: none;
  padding: 0.5rem;
  background: #e8e8e8;
  border-radius: 4px;
  font-weight: 500;
  color: #333;
}

.svg-source[open] summary {
  margin-bottom: 0.5rem;
}

.svg-source summary:hover {
  background: #d8d8d8;
}

.svg-editor {
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

.svg-editor:focus {
  outline: none;
  border-color: #4caf50;
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.1);
}

.svg-editor:disabled {
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
