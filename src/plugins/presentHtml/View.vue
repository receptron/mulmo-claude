<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between">
      <span class="text-sm font-medium text-gray-700 truncate">{{ title ?? t("pluginPresentHtml.untitled") }}</span>
      <div class="flex items-center gap-2">
        <button
          class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 shrink-0"
          :title="t('pluginPresentHtml.saveAsPdf')"
          @click="printToPdf"
        >
          <span class="material-icons text-sm align-middle">picture_as_pdf</span>
          {{ t("pluginPresentHtml.pdf") }}
        </button>
        <button class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 shrink-0" @click="toggleSource">
          {{ sourceOpen ? t("pluginPresentHtml.hideSource") : t("pluginPresentHtml.showSource") }}
        </button>
      </div>
    </div>
    <div v-if="sourceOpen" class="border-b border-gray-100 shrink-0">
      <div v-if="sourceError" class="px-3 py-2 text-xs text-red-700 bg-red-50">
        {{ t("pluginPresentHtml.sourceError", { error: sourceError }) }}
      </div>
      <textarea :value="textareaValue" readonly class="w-full text-xs text-gray-600 bg-gray-50 p-3 font-mono resize-none outline-none" rows="16" />
    </div>
    <iframe v-if="previewUrl" :src="previewUrl" sandbox="allow-scripts" class="flex-1 w-full border-0" />
    <div v-else class="flex-1 flex items-center justify-center text-sm text-gray-500">
      {{ t("pluginPresentHtml.untitled") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentHtmlData } from "./index";
import { htmlPreviewUrlFor } from "../../composables/useContentDisplay";
import { apiFetchRaw } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { errorMessage } from "../../utils/errors";
import { buildPrintCspContent } from "../../utils/html/previewCsp";

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
const previewUrl = computed(() => htmlPreviewUrlFor(filePath.value));

const sourceOpen = ref(false);
// Keyed by filePath so a remounted/reused View instance with a
// different selectedResult does not return stale source.
const sourceCache = ref<Record<string, string>>({});
const sourceLoading = ref(false);
const sourceError = ref<string | null>(null);

const cachedSource = computed(() => (filePath.value ? (sourceCache.value[filePath.value] ?? null) : null));

const textareaValue = computed(() => {
  if (sourceLoading.value) return t("pluginPresentHtml.loadingSource");
  return cachedSource.value ?? "";
});

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

async function toggleSource() {
  if (sourceOpen.value) {
    sourceOpen.value = false;
    return;
  }
  sourceOpen.value = true;
  await fetchSource();
}

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
    // without shipping a second error UI.
    sourceOpen.value = true;
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
