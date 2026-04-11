<template>
  <div class="h-full flex flex-col">
    <div
      v-if="isAssistant"
      class="flex justify-end px-4 py-2 border-b border-gray-100 shrink-0"
    >
      <button
        class="px-3 py-1 text-xs rounded-full border transition-colors border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 flex items-center justify-center gap-1"
        :disabled="pdfDownloading"
        @click="downloadPdf"
      >
        <svg
          v-if="pdfDownloading"
          class="animate-spin w-3 h-3 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
        <template v-if="!pdfDownloading">
          <span class="material-icons text-sm leading-none">download</span>
          <span>PDF</span>
        </template>
        <span v-else>PDF</span>
      </button>
      <span
        v-if="pdfError"
        class="text-xs text-red-500 self-center ml-2"
        :title="pdfError"
        >⚠ PDF failed</span
      >
    </div>
    <div class="flex-1 overflow-hidden" @click.capture="openLinksInNewTab">
      <OriginalView
        :selected-result="selectedResult"
        @update-result="(r) => emit('updateResult', r as ToolResultComplete)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { View as OriginalView } from "@gui-chat-plugin/text-response/vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "@gui-chat-plugin/text-response";
import { handleExternalLinkClick } from "../../utils/dom/externalLink";

const props = defineProps<{
  selectedResult: ToolResultComplete<TextResponseData>;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const isAssistant = computed(
  () => (props.selectedResult.data?.role ?? "assistant") === "assistant",
);

// The shared helper returns a boolean indicating whether it
// consumed the click. In this component we don't have any other
// click behaviour to cascade to, so the return value is ignored —
// but we keep the helper call because it does the `event.preventDefault()`
// and `window.open()` internally.
function openLinksInNewTab(event: MouseEvent): void {
  handleExternalLinkClick(event);
}

const pdfDownloading = ref(false);
const pdfError = ref<string | null>(null);

async function downloadPdf() {
  pdfError.value = null;
  pdfDownloading.value = true;
  const text = props.selectedResult.data?.text ?? "";
  const filename = `${props.selectedResult.title ?? "response"}.pdf`;
  let response: Response;
  try {
    response = await fetch("/api/pdf/markdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: text, filename }),
    });
  } catch (err) {
    pdfError.value = err instanceof Error ? err.message : String(err);
    pdfDownloading.value = false;
    return;
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    pdfError.value = `PDF error ${response.status}: ${errText}`;
    pdfDownloading.value = false;
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  pdfDownloading.value = false;
}
</script>
