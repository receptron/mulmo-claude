<template>
  <div class="h-full flex flex-col">
    <div
      v-if="isAssistant"
      class="flex justify-end px-4 py-2 border-b border-gray-100 shrink-0"
    >
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
      ref="contentWrapper"
      class="flex-1 overflow-hidden relative"
      @click.capture="openLinksInNewTab"
    >
      <OriginalView
        :key="viewKey"
        :selected-result="selectedResult"
        @update-result="onApply"
      />
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
      <button v-show="editing" class="cancel-btn" @click="cancelEdit">
        Cancel
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onBeforeUnmount } from "vue";
import { View as OriginalView } from "@gui-chat-plugin/text-response/vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "@gui-chat-plugin/text-response";
import { handleExternalLinkClick } from "../../utils/dom/externalLink";
import { usePdfDownload } from "../../composables/usePdfDownload";

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

const {
  pdfDownloading,
  pdfError,
  downloadPdf: rawDownloadPdf,
} = usePdfDownload();

const contentWrapper = ref<HTMLElement>();
const editing = ref(false);
const viewKey = ref(0);

function attachToggleListener() {
  const details = contentWrapper.value?.querySelector("details");
  details?.addEventListener("toggle", onDetailsToggle);
}

function onDetailsToggle(e: Event) {
  const open = (e.target as HTMLDetailsElement).open;
  editing.value = open;
  if (!open) {
    // Re-mount OriginalView to discard textarea edits
    viewKey.value++;
    nextTick(attachToggleListener);
  }
}

onMounted(attachToggleListener);

onBeforeUnmount(() => {
  const details = contentWrapper.value?.querySelector("details");
  details?.removeEventListener("toggle", onDetailsToggle);
});

function cancelEdit() {
  const details = contentWrapper.value?.querySelector("details");
  if (details) details.open = false;
}

function onApply(r: unknown) {
  emit("updateResult", r as ToolResultComplete);
  const details = contentWrapper.value?.querySelector("details");
  if (details) details.open = false;
}

const copied = ref(false);

async function copyText() {
  const text = props.selectedResult.data?.text ?? "";
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // Fallback: clipboard API may be blocked in some contexts
  }
}

async function downloadPdf() {
  const text = props.selectedResult.data?.text ?? "";
  const filename = `${props.selectedResult.title ?? "response"}.pdf`;
  await rawDownloadPdf(text, filename);
}
</script>

<style scoped>
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

.cancel-btn {
  position: absolute;
  bottom: 0.5rem;
  right: 0.65rem;
  padding: 0.5rem 1rem;
  background: #e0e0e0;
  color: #333;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  z-index: 1;
}

.cancel-btn:hover {
  background: #d0d0d0;
}
</style>
