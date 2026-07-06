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
        <!-- Marp slides: detected via `marp: true` frontmatter; replaces
             the default markdown render with the slide-stack canvas
             component. Frontmatter envelope is fed to Marp verbatim
             because marp-core consumes its own directives (theme,
             paginate, size, …) from the YAML header. -->
        <template v-if="isMarkdown && !mdRawMode && marpMode">
          <!-- Edit mode: shared MarpSplitEditor — textarea on the
               left feeds a live MarpView preview on the right via
               v-model. Layout / inline-style rationale lives in
               the component. -->
          <MarpSplitEditor
            v-if="marpEditing"
            v-model="marpDraft"
            :pdf-filename="marpPdfFilename"
            :base-dir="marpBaseDir"
            :editor-label="t('fileContentRenderer.marpEditorLabel')"
          >
            <template #actions>
              <button
                class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                data-testid="files-marp-cancel-btn"
                @click="cancelMarpEdit"
              >
                {{ t("common.cancel") }}
              </button>
              <button
                class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-green-600 hover:bg-green-700 text-white"
                data-testid="files-marp-save-btn"
                @click="saveMarpEdit"
              >
                <span class="material-icons text-sm" aria-hidden="true">save</span>
                {{ t("common.save") }}
              </button>
            </template>
          </MarpSplitEditor>
          <!-- Preview-only mode (default). `m-auto` centres a short
               MarpView vertically in the file-pane canvas (same pattern
               as View.vue's marp branch). -->
          <div v-else class="h-full flex flex-col overflow-y-auto">
            <div class="m-auto w-full">
              <MarpView :markdown="content.content" :pdf-filename="marpPdfFilename" :base-dir="marpBaseDir">
                <template #toolbar>
                  <button
                    class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm"
                    :title="t('fileContentRenderer.editMarp')"
                    :aria-label="t('fileContentRenderer.editMarp')"
                    data-testid="files-marp-edit-btn"
                    @click="startMarpEdit"
                  >
                    <span class="material-icons text-sm" aria-hidden="true">edit</span>
                    {{ t("fileContentRenderer.editMarp") }}
                  </button>
                </template>
              </MarpView>
            </div>
          </div>
          <div
            v-if="rawSaveError"
            class="shrink-0 m-4 mt-0 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700"
            role="alert"
            data-testid="files-marp-save-error"
          >
            ⚠ {{ rawSaveError }}
          </div>
        </template>
        <!-- Markdown rendered: frontmatter panel + body -->
        <div v-else-if="isMarkdown && !mdRawMode" class="h-full flex flex-col overflow-auto">
          <div v-if="mdFrontmatter && mdFrontmatter.fields.length > 0" class="shrink-0 m-4 mb-0 rounded border border-gray-200 bg-gray-50 p-3 text-xs">
            <div v-for="field in mdFrontmatter.fields" :key="field.key" class="flex items-baseline gap-2 py-0.5">
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

             Two branches:
              - Files under `artifacts/html/` load via iframe `src=`
                pointing at the `/artifacts/html` static mount, so the
                browser resolves relative `<img src="../images/...">`
                against the file's real URL. CSP arrives as an HTTP
                header on the response.
              - Anything else falls back to `srcdoc` with a CSP meta
                tag injected by `wrapHtmlWithPreviewCsp`. Relative
                paths don't resolve under `srcdoc` (base URL is
                `about:srcdoc`), but that's the historical behavior
                for non-`artifacts/html/` HTML. -->
        <div v-else-if="isHtml && htmlPreviewUrl" class="relative w-full h-full">
          <!-- Only `.html` is packable (server gates on `isHtmlPath`); a
               `.htm` preview shows no button so the action can't 400. -->
          <div v-if="canDownloadZip" class="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
            <button
              class="px-2 py-1 text-xs rounded border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 disabled:opacity-50 shadow-sm"
              :title="t('fileContentRenderer.downloadZip')"
              :disabled="packing"
              data-testid="file-html-download"
              @click="downloadHtmlZip"
            >
              <span class="material-icons text-sm align-middle">download</span>
              {{ t("fileContentRenderer.download") }}
            </button>
            <span v-if="packFailed" class="text-xs text-red-600 bg-white/90 px-1 rounded" role="alert">{{ t("fileContentRenderer.downloadError") }}</span>
          </div>
          <iframe :src="htmlPreviewUrl" class="w-full h-full border-0" sandbox="allow-scripts" :title="t('fileContentRenderer.htmlPreview')" />
        </div>
        <iframe
          v-else-if="isHtml"
          :srcdoc="sandboxedHtml"
          class="w-full h-full border-0"
          sandbox="allow-scripts"
          :title="t('fileContentRenderer.htmlPreview')"
        />
        <!-- JSON: read-only pretty-print, or an inline text editor for
             policy-editable config files (#833 Phase 1). The server
             JSON-validates on save and returns 400 → rawSaveError. -->
        <div v-else-if="isJson" class="h-full flex flex-col overflow-auto">
          <div class="shrink-0 flex items-center justify-end gap-2 px-4 pt-3">
            <template v-if="jsonEditing">
              <button
                class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                data-testid="files-json-cancel-btn"
                @click="cancelJsonEdit"
              >
                {{ t("common.cancel") }}
              </button>
              <span v-if="!jsonDraftValid" class="text-xs text-red-600 self-center" data-testid="files-json-invalid-hint">
                {{ t("fileContentRenderer.invalidJson") }}
              </span>
              <button
                class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="files-json-save-btn"
                :disabled="!jsonDraftValid"
                :title="jsonDraftValid ? undefined : t('fileContentRenderer.invalidJson')"
                @click="saveJsonEdit"
              >
                <span class="material-icons text-sm">save</span>
                {{ t("common.save") }}
              </button>
            </template>
            <button
              v-else-if="jsonEditable"
              class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
              data-testid="files-json-edit-btn"
              @click="startJsonEdit"
            >
              <span class="material-icons text-sm">edit</span>
              {{ t("fileContentRenderer.editJson") }}
            </button>
          </div>
          <JsonEditor v-if="jsonEditing" v-model="jsonDraft" :editor-label="t('fileContentRenderer.jsonEditorLabel')" class="flex-1 min-h-0 m-4" />
          <pre v-else class="flex-1 p-4 text-xs whitespace-pre-wrap font-mono text-gray-800"><span
            v-for="(tok, i) in jsonTokens"
            :key="i"
            :class="JSON_TOKEN_CLASS[tok.type]"
          >{{ tok.value }}</span></pre>
          <div
            v-if="rawSaveError"
            class="shrink-0 m-4 mt-0 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700"
            role="alert"
            data-testid="files-json-save-error"
          >
            ⚠ {{ rawSaveError }}
          </div>
        </div>
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
      <!-- XLSX (server-converted to CSV per sheet, rendered as a table) -->
      <div v-else-if="content.kind === 'office-xlsx' && selectedPath" class="h-full flex flex-col overflow-hidden">
        <div v-if="content.sheets.length > 1" class="flex-shrink-0 px-3 pt-2 flex items-center gap-2 border-b border-gray-200 text-xs">
          <span class="text-gray-500">{{ t("fileContentRenderer.xlsxSheet") }}:</span>
          <select v-model="activeXlsxSheet" class="px-2 py-1 border border-gray-300 rounded">
            <option v-for="s in content.sheets" :key="s.name" :value="s.name">{{ s.name }}</option>
          </select>
        </div>
        <div class="flex-1 overflow-auto p-3">
          <table class="text-xs border-collapse">
            <tbody>
              <tr v-for="(row, ri) in currentXlsxRows" :key="ri">
                <td v-for="(cell, ci) in row" :key="ci" class="border border-gray-200 px-2 py-1 whitespace-pre align-top">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <!-- DOCX (server-extracted plain text) -->
      <pre v-else-if="content.kind === 'office-docx' && selectedPath" class="p-4 text-sm whitespace-pre-wrap font-sans text-gray-800 overflow-auto h-full">{{
        content.content
      }}</pre>
      <!-- PPTX (server-converted to PDF via LibreOffice) -->
      <iframe
        v-else-if="content.kind === 'office-pptx' && selectedPath"
        :src="content.previewUrl"
        class="w-full h-full border-0"
        :title="t('fileContentRenderer.pptxPreview')"
      />
      <!-- Binary or too-large -->
      <div v-else class="p-4 text-sm text-gray-500 flex flex-col gap-3">
        <template v-if="'message' in content">{{ content.message }}</template>
        <div v-if="selectedPath">
          <button
            type="button"
            class="h-8 px-3 flex items-center gap-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium disabled:opacity-50"
            :disabled="openInOsBusy"
            data-testid="file-open-in-os"
            @click="openInOs"
          >
            <span class="material-icons text-sm">open_in_new</span>
            {{ openInOsBusy ? t("fileContentRenderer.openingInOs") : t("fileContentRenderer.openInOs") }}
          </button>
          <p v-if="openInOsError" class="mt-2 text-xs text-red-600">{{ openInOsError }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, type Component } from "vue";
import { useI18n } from "vue-i18n";
import TextResponseView from "../plugins/textResponse/View.vue";
import SystemFileBanner from "./SystemFileBanner.vue";
import type { FileContent } from "../composables/useFileSelection";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "../plugins/textResponse/types";
import { JSON_TOKEN_CLASS } from "../utils/format/jsonSyntax";
import type { JsonToken, JsonlLine } from "../utils/format/jsonSyntax";
import { formatScalarField, type MarkdownDocView } from "../composables/useMarkdownDoc";
import { rewriteMarkdownImageRefs } from "../utils/image/rewriteMarkdownImageRefs";
import { API_ROUTES } from "../config/apiRoutes";
import { apiPost } from "../utils/api";
import { useSharePack } from "../composables/useSharePack";
import { descriptorForPath, jsonEditableByPolicy } from "../config/systemFileDescriptors";
import { isMarpDocument } from "../utils/markdown/marpDetect";
import { buildPdfFilename } from "../utils/files/filename";
import { MarpView as MarpViewRaw, MarpSplitEditor as MarpSplitEditorRaw } from "@mulmoclaude/markdown-plugin/vue";
import { wrapWithScope } from "../plugins/scope";
// MarpView / MarpSplitEditor call useRuntime() (for marpThemes + PDF
// export via dispatch), so they must mount inside a markdown scope
// provider — same scope the plugin canvas uses, so both reach the
// built-in "markdown" dispatch handler (task #6).
const MarpView = wrapWithScope("markdown", MarpViewRaw as unknown as Component);
const MarpSplitEditor = wrapWithScope("markdown", MarpSplitEditorRaw as unknown as Component);
// Lazy: CodeMirror (~390 KB raw) is only fetched when a user actually
// opens the inline JSON editor, keeping it out of the initial bundle.
const JsonEditor = defineAsyncComponent(() => import("./JsonEditor.vue"));

const { t } = useI18n();

const props = defineProps<{
  selectedPath: string | null;
  content: FileContent | null;
  contentError: string | null;
  contentLoading: boolean;
  isMarkdown: boolean;
  isHtml: boolean;
  isJson: boolean;
  isJsonl: boolean;
  mdRawMode: boolean;
  sandboxedHtml: string;
  htmlPreviewUrl: string | null;
  jsonTokens: JsonToken[];
  jsonlLines: JsonlLine[];
  mdFrontmatter: MarkdownDocView | null;
  rawSaveError: string | null;
}>();

const emit = defineEmits<{
  markdownLinkClick: [event: MouseEvent];
  updateSource: [newSource: string];
}>();

const systemDescriptor = computed(() => (props.selectedPath ? descriptorForPath(props.selectedPath) : null));

const { packing, packFailed, downloadZip, reset: resetSharePack } = useSharePack();
// `htmlPreviewUrl` also matches `.htm`, but the pack route only accepts
// canonical `.html`, so gate the button on `.html` to match server policy.
const canDownloadZip = computed(() => Boolean(props.isHtml && props.htmlPreviewUrl && props.selectedPath?.toLowerCase().endsWith(".html")));
function downloadHtmlZip() {
  if (props.selectedPath) void downloadZip(props.selectedPath);
}
// Drop a stale error banner when the user navigates to another file.
watch(
  () => props.selectedPath,
  () => resetSharePack(),
);

const marpMode = computed(() => Boolean(props.mdFrontmatter && isMarpDocument(props.mdFrontmatter.meta)));

const marpBaseDir = computed(() => {
  const path = props.selectedPath;
  if (!path) return undefined;
  const idx = path.lastIndexOf("/");
  // Root-level markdown (no "/") → "" so server-side inlineImages()
  // resolves relative `<img>` refs against the workspace root instead
  // of falling back to the legacy `markdowns/` sourceDir (codex review).
  return idx < 0 ? "" : path.slice(0, idx);
});

const marpPdfFilename = computed(() => {
  const path = props.selectedPath ?? "";
  const lastSlash = path.lastIndexOf("/");
  const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return buildPdfFilename({ name: stem, fallback: "slides" });
});

// ── Office preview (#1985) ───────────────────────────────────────

// Which xlsx sheet the user picked from the selector. Auto-resets to
// the first sheet whenever a new xlsx file loads so the tabs don't
// stick on a sheet name that doesn't exist in the new workbook.
const activeXlsxSheet = ref<string>("");
watch(
  () => props.content,
  (loaded) => {
    if (loaded && loaded.kind === "office-xlsx") activeXlsxSheet.value = loaded.sheets[0]?.name ?? "";
  },
  { immediate: true },
);
// Parse the selected sheet's CSV into rows of cell strings. CSV comes
// from SheetJS (`sheet_to_csv`) which uses `,` separators and quotes
// only when needed — a minimal RFC 4180 tokeniser covers it.
const currentXlsxRows = computed<string[][]>(() => {
  if (props.content?.kind !== "office-xlsx") return [];
  const sheet = props.content.sheets.find((entry) => entry.name === activeXlsxSheet.value) ?? props.content.sheets[0];
  return sheet ? parseCsv(sheet.csv) : [];
});
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuote = false;
  for (let idx = 0; idx < text.length; idx++) {
    const char = text[idx];
    if (inQuote) {
      if (char === '"' && text[idx + 1] === '"') {
        cell += '"';
        idx++;
      } else if (char === '"') {
        inQuote = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuote = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      // \r on its own is dropped; the paired \n commits the row.
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// "Open in OS" button on the binary/unsupported fallback (and any
// preview surface where the user wants the native app). Fire-and-
// forget — success just means the server spawned the OS handler.
const openInOsBusy = ref(false);
const openInOsError = ref<string | null>(null);
async function openInOs(): Promise<void> {
  if (!props.selectedPath) return;
  openInOsBusy.value = true;
  openInOsError.value = null;
  try {
    // Send path in BOTH the body and the query — the server accepts
    // either. Defensive against a proxy/middleware chain that swallows
    // the JSON body (#1985 initial bug report: "path required" on a
    // request whose body should have carried the path).
    const url = `${API_ROUTES.files.open}?path=${encodeURIComponent(props.selectedPath)}`;
    const result = await apiPost<{ ok: boolean }>(url, { path: props.selectedPath });
    if (!result.ok) openInOsError.value = result.error || t("fileContentRenderer.openInOsFailed");
  } finally {
    openInOsBusy.value = false;
  }
}

// Inline JSON editor (#833 Phase 1). Available only for policy-editable
// JSON config files; the read-only pretty-print stays the default.
const jsonEditing = ref(false);
const jsonDraft = ref("");

const jsonEditable = computed(() => props.isJson && props.selectedPath !== null && props.content?.kind === "text" && jsonEditableByPolicy(props.selectedPath));

// Client-side guard: block Save when the draft isn't valid JSON, so
// the user gets immediate feedback instead of a server round-trip
// ending in a 400. The server check stays as defence in depth.
const jsonDraftValid = computed(() => {
  try {
    JSON.parse(jsonDraft.value);
    return true;
  } catch {
    return false;
  }
});

function startJsonEdit(): void {
  if (props.content?.kind !== "text") return;
  jsonDraft.value = props.content.content;
  jsonEditing.value = true;
}

function cancelJsonEdit(): void {
  jsonEditing.value = false;
}

function saveJsonEdit(): void {
  emit("updateSource", jsonDraft.value);
}

// Inline Marp source editor (#1651). Mirrors the JSON edit flow:
// `marpEditing` flips the marp branch into split mode, `marpDraft`
// holds the unsaved buffer that drives the live preview, Save emits
// `updateSource`. Leaving edit mode on content change handles both
// the success path (parent swaps content + clears rawSaveError) and
// navigation to another file.
const marpEditing = ref(false);
const marpDraft = ref("");

function startMarpEdit(): void {
  if (props.content?.kind !== "text") return;
  marpDraft.value = props.content.content;
  marpEditing.value = true;
}

function cancelMarpEdit(): void {
  marpEditing.value = false;
}

function saveMarpEdit(): void {
  emit("updateSource", marpDraft.value);
}

// Leave edit mode whenever the underlying content changes — that's
// either a successful save (parent swaps in the new content + clears
// rawSaveError) or navigation to another file. A failed save leaves
// content untouched and sets rawSaveError, so we stay in edit mode
// with the error banner visible.
watch(
  () => props.content,
  () => {
    jsonEditing.value = false;
    marpEditing.value = false;
  },
);

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
  // The displayed text strips frontmatter (rendered separately as a
  // metadata bar above) — but the PDF source must keep the original
  // markdown so the server can decide what to keep / strip via the
  // `pdfStripFrontmatter` flag. Otherwise non-wiki files with
  // frontmatter would silently lose it from the PDF too.
  const fullSource = props.content?.kind === "text" ? props.content.content : text;
  // Strip frontmatter from the PDF whenever the UI shows it as a
  // separate metadata panel — otherwise the YAML duplicates as plain
  // text on page 1 of the PDF.
  const hasFrontmatter = props.mdFrontmatter !== null;
  return {
    uuid: "files-preview",
    toolName: "text-response",
    message: rewritten,
    title: props.selectedPath ?? "",
    data: {
      text: rewritten,
      role: "assistant",
      transportKind: "text-rest",
      // `pdfSourceText`: un-rewritten markdown so the server-side
      // image inliner resolves against on-disk paths, not the
      // `/api/files/raw?…` URLs the display layer produces.
      pdfSourceText: fullSource,
      // Pass basePath as-is (including empty string for top-level
      // files like README.md). The server distinguishes empty
      // (= workspace root) from undefined (= legacy default).
      pdfBaseDir: basePath,
      pdfStripFrontmatter: hasFrontmatter,
    },
  };
}
</script>
