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
        <button class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 shrink-0" @click="sourceOpen = !sourceOpen">
          {{ sourceOpen ? t("pluginPresentHtml.hideSource") : t("pluginPresentHtml.showSource") }}
        </button>
      </div>
    </div>
    <div v-if="sourceOpen" class="border-b border-gray-100 shrink-0">
      <textarea :value="html" readonly class="w-full text-xs text-gray-600 bg-gray-50 p-3 font-mono resize-none outline-none" rows="16" />
    </div>
    <iframe ref="iframeRef" :srcdoc="html" sandbox="allow-scripts allow-same-origin allow-modals" class="flex-1 w-full border-0" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentHtmlData } from "./index";
import { rewriteHtmlImageRefs } from "../../utils/image/rewriteHtmlImageRefs";
import { IMAGE_REPAIR_INLINE_SCRIPT } from "../../composables/useImageErrorRepair";

const { t } = useI18n();

const props = defineProps<{
  selectedResult: ToolResultComplete<PresentHtmlData>;
}>();

const PRINT_STYLE = `<style>@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { width: 100% !important; margin: 0 !important; padding: 8px !important; }
  @page { margin: 10mm; }
}</style>`;

// Inline repair script: a 404 on a rewritten <img> inside the iframe
// retries against /artifacts/images/<rest> — same rule as
// useImageErrorRepair on the parent doc.
//
// The closing tag uses a Unicode-escape for the slash so the literal
// 9-char sequence does not appear in the source bytes — otherwise the
// Vue SFC HTML parser would treat it as the end of THIS file's
// <script setup> block.
const REPAIR_SCRIPT = `<script>${IMAGE_REPAIR_INLINE_SCRIPT}<\u002Fscript>`;

const data = computed(() => props.selectedResult.data);
// LLM-generated HTML often emits <img src="/artifacts/images/…"> using
// the web convention where `/` is the site root. Inside the iframe
// srcdoc that resolves to the SPA origin, which does not serve
// /artifacts. Route those through the workspace file server.
const rawHtml = computed(() => rewriteHtmlImageRefs(data.value?.html ?? ""));
const headInjection = `${PRINT_STYLE}${REPAIR_SCRIPT}`;
const html = computed(() =>
  rawHtml.value.includes("</head>") ? rawHtml.value.replace("</head>", `${headInjection}</head>`) : `${headInjection}${rawHtml.value}`,
);
const title = computed(() => data.value?.title);

const sourceOpen = ref(false);
const iframeRef = ref<HTMLIFrameElement | null>(null);

function printToPdf() {
  iframeRef.value?.contentWindow?.print();
}
</script>
