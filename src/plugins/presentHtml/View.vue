<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between">
      <span class="text-sm font-medium text-gray-700 truncate">{{ title ?? "HTML Page" }}</span>
      <div class="flex items-center gap-2">
        <button
          class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 shrink-0"
          title="Save as PDF (opens print dialog)"
          @click="printToPdf"
        >
          <span class="material-icons text-sm align-middle">picture_as_pdf</span>
          PDF
        </button>
        <button class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 shrink-0" @click="sourceOpen = !sourceOpen">
          {{ sourceOpen ? "Hide Source <>" : "Show Source <>" }}
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
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentHtmlData } from "./index";

const props = defineProps<{
  selectedResult: ToolResultComplete<PresentHtmlData>;
}>();

const PRINT_STYLE = `<style>@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { width: 100% !important; margin: 0 !important; padding: 8px !important; }
  @page { margin: 10mm; }
}</style>`;

const data = computed(() => props.selectedResult.data);
const rawHtml = computed(() => data.value?.html ?? "");
const html = computed(() => (rawHtml.value.includes("</head>") ? rawHtml.value.replace("</head>", `${PRINT_STYLE}</head>`) : `${PRINT_STYLE}${rawHtml.value}`));
const title = computed(() => data.value?.title);

const sourceOpen = ref(false);
const iframeRef = ref<HTMLIFrameElement | null>(null);

function printToPdf() {
  iframeRef.value?.contentWindow?.print();
}
</script>
