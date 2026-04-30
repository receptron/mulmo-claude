<template>
  <div class="border-t border-gray-200" @dragover.prevent @drop="onDropFile">
    <SuggestionsPanel
      v-model:expanded="suggestionsExpanded"
      :queries="queries"
      :trigger-ref="suggestionsBtnRef"
      @send="onSuggestionSend"
      @edit="onSuggestionEdit"
    />
    <div class="p-2">
      <div v-if="fileError" class="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5" data-testid="file-error">
        {{ fileError }}
      </div>
      <ChatAttachmentPreview
        v-if="pastedFile"
        :data-url="pastedFile.dataUrl"
        :filename="pastedFile.name"
        :mime="pastedFile.mime"
        @remove="emit('update:pastedFile', null)"
      />
      <div class="flex gap-2" :class="{ 'mt-2': pastedFile }">
        <textarea
          ref="textarea"
          :value="modelValue"
          data-testid="user-input"
          :placeholder="t('chatInput.placeholder')"
          rows="2"
          class="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
          :disabled="isRunning"
          @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
          @compositionstart="imeEnter.onCompositionStart"
          @compositionend="imeEnter.onCompositionEnd"
          @keydown="imeEnter.onKeydown"
          @blur="imeEnter.onBlur"
          @paste="onPasteFile"
        />
        <div class="flex flex-col gap-1">
          <button
            ref="suggestionsBtnRef"
            data-testid="suggestions-btn"
            class="rounded w-8 h-8 flex items-center justify-center"
            :class="suggestionsExpanded ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600'"
            :title="t('suggestionsPanel.tooltip')"
            :aria-label="t('suggestionsPanel.tooltip')"
            @click="suggestionsExpanded = !suggestionsExpanded"
          >
            <span class="material-icons text-base leading-none">lightbulb</span>
          </button>
          <button
            data-testid="send-btn"
            class="bg-blue-600 hover:bg-blue-700 text-white rounded w-8 h-8 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            :title="t('chatInput.send')"
            :aria-label="t('chatInput.send')"
            :disabled="isRunning"
            @click="emit('send')"
          >
            <span class="material-icons text-base leading-none">send</span>
          </button>
          <button
            data-testid="attach-file-btn"
            class="text-gray-400 hover:text-gray-600 rounded w-8 h-8 flex items-center justify-center"
            :title="t('chatInput.attachFile')"
            :aria-label="t('chatInput.attachFile')"
            @click="openFilePicker"
          >
            <span class="material-icons text-base leading-none">attach_file</span>
          </button>
        </div>
      </div>

      <!-- Hidden file input driven by the attach button. The `accept`
           filter matches ACCEPTED_MIME_PREFIXES/_EXACT below; the change
           handler routes through the same readAttachmentFile() used by
           drop + paste, so all three paths behave identically. -->
      <input ref="fileInput" type="file" class="hidden" :accept="fileInputAccept" data-testid="file-input" @change="onFilePicked" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import ChatAttachmentPreview from "./ChatAttachmentPreview.vue";
import SuggestionsPanel from "./SuggestionsPanel.vue";
import { useImeAwareEnter } from "../composables/useImeAwareEnter";
import type { PastedFile } from "../types/pastedFile";

export type { PastedFile };

const { t } = useI18n();

withDefaults(
  defineProps<{
    modelValue: string;
    pastedFile: PastedFile | null;
    isRunning: boolean;
    queries?: string[];
  }>(),
  { queries: () => [] },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:pastedFile": [file: PastedFile | null];
  send: [];
  "suggestion-send": [query: string];
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const fileError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const suggestionsExpanded = ref(false);
const suggestionsBtnRef = ref<HTMLButtonElement | null>(null);

const MAX_ATTACH_BYTES = 30 * 1024 * 1024;

const ACCEPTED_MIME_PREFIXES = ["image/", "text/"];
const ACCEPTED_MIME_EXACT = new Set([
  "application/pdf",
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/toml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// `accept` attribute for the hidden <input type="file"> that the
// paperclip button drives. Prefixes like `image/*` and `text/*` are
// expanded by the browser's native file picker; exact MIME entries
// are passed through. Drop + paste still accept the same set via the
// isAcceptedType() check below, so all three entry points stay in sync.
const fileInputAccept = [...ACCEPTED_MIME_PREFIXES.map((prefix) => `${prefix}*`), ...ACCEPTED_MIME_EXACT].join(",");

function isAcceptedType(mime: string): boolean {
  return ACCEPTED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) || ACCEPTED_MIME_EXACT.has(mime);
}

function readAttachmentFile(file: File): void {
  fileError.value = null;
  if (!isAcceptedType(file.type)) {
    // Previously returned silently. That left the user wondering whether
    // the drop/paste registered at all — #499.
    fileError.value = t("chatInput.unsupportedFileType");
    return;
  }
  if (file.size > MAX_ATTACH_BYTES) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    fileError.value = t("chatInput.fileTooLarge", { sizeMB });
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      emit("update:pastedFile", {
        dataUrl: reader.result,
        name: file.name,
        mime: file.type,
      });
    }
  };
  reader.readAsDataURL(file);
}

function onPasteFile(event: ClipboardEvent): void {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (isAcceptedType(item.type)) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        readAttachmentFile(file);
        return;
      }
    }
  }
}

function onDropFile(event: DragEvent): void {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) readAttachmentFile(file);
}

function openFilePicker(): void {
  fileInput.value?.click();
}

function onFilePicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) readAttachmentFile(file);
  // Reset so selecting the same file twice in a row still fires @change.
  input.value = "";
}

const imeEnter = useImeAwareEnter(() => emit("send"));

function onSuggestionSend(query: string): void {
  emit("suggestion-send", query);
}

function onSuggestionEdit(query: string): void {
  emit("update:modelValue", query);
  nextTick(() => textarea.value?.focus());
}

function focus(): void {
  textarea.value?.focus();
}

function collapseSuggestions(): void {
  suggestionsExpanded.value = false;
}

defineExpose({ focus, collapseSuggestions });
</script>
