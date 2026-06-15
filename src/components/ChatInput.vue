<template>
  <!-- File drop is handled at the chat panel level (#1289 Step 2)
       so the user can drop anywhere over the panel + messages, not
       just over the input box. ChatInput still owns `readFiles` for
       the dropped files — App.vue calls it via the exposed method
       once the panel-wide drop fires. Multi-attach was added in
       plans/feat-chat-input-multi-attach.md so a single turn can
       carry several screenshots / PDFs. -->
  <div class="border-t border-gray-200">
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
      <div v-if="pastedFiles.length > 0" data-testid="chat-attachment-list" class="flex flex-wrap gap-1.5 mb-2">
        <ChatAttachmentPreview
          v-for="(file, index) in pastedFiles"
          :key="`${file.name}-${index}`"
          :data-url="file.dataUrl"
          :filename="file.name"
          :mime="file.mime"
          @remove="removeAttachment(index)"
        />
      </div>
      <div class="flex gap-2">
        <!-- The textarea stays enabled even while a run is in flight so
             the user can compose the NEXT message ("multitask"). The
             send button used to be gated on `isRunning` to prevent a
             double-submit; that was relaxed in
             plans/feat-chat-input-queued-send.md so users can queue
             a follow-up while the current run is still streaming.
             App.vue's sendMessage() pushes onto a queue when running,
             and flushes once `activeSessionRunning` flips back to
             false. The textarea was always enabled (originally for
             IME-in-progress safety, #1289 follow-up). -->
        <textarea
          ref="textarea"
          :value="modelValue"
          data-testid="user-input"
          :placeholder="t('chatInput.placeholder')"
          rows="2"
          class="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none"
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
            :title="isRunning ? t('chatInput.queueWhileRunning') : t('chatInput.send')"
            :aria-label="isRunning ? t('chatInput.queueWhileRunning') : t('chatInput.send')"
            @click="emit('send')"
          >
            <span class="material-icons text-base leading-none">{{ isRunning ? "schedule_send" : "send" }}</span>
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
           filter matches ACCEPTED_MIME_PREFIXES/_EXACT below; `multiple`
           was added so the picker can return several files in one go.
           The change handler routes through the same readAttachmentFiles()
           used by drop + paste, so all three paths behave identically. -->
      <input ref="fileInput" type="file" multiple class="hidden" :accept="fileInputAccept" data-testid="file-input" @change="onFilePicked" />
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

const props = withDefaults(
  defineProps<{
    modelValue: string;
    pastedFiles: PastedFile[];
    isRunning: boolean;
    queries?: string[];
  }>(),
  { queries: () => [] },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:pastedFiles": [files: PastedFile[]];
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

function readSingleFile(file: File): Promise<PastedFile | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve({ dataUrl: reader.result, name: file.name, mime: file.type });
      } else {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function readAttachmentFiles(files: File[]): Promise<void> {
  fileError.value = null;
  const accepted: File[] = [];
  for (const file of files) {
    if (!isAcceptedType(file.type)) {
      // Previously returned silently. That left the user wondering whether
      // the drop/paste registered at all — #499.
      fileError.value = t("chatInput.unsupportedFileType");
      continue;
    }
    if (file.size > MAX_ATTACH_BYTES) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      fileError.value = t("chatInput.fileTooLarge", { sizeMB });
      continue;
    }
    accepted.push(file);
  }
  if (accepted.length === 0) return;
  const results = await Promise.all(accepted.map(readSingleFile));
  const ok = results.filter((entry): entry is PastedFile => entry !== null);
  if (ok.length === 0) return;
  emit("update:pastedFiles", [...props.pastedFiles, ...ok]);
}

function removeAttachment(index: number): void {
  emit(
    "update:pastedFiles",
    props.pastedFiles.filter((_, i) => i !== index),
  );
}

function onPasteFile(event: ClipboardEvent): void {
  const items = event.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (const item of items) {
    if (isAcceptedType(item.type)) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length === 0) return;
  // Stop the default paste only when we're actually capturing the
  // clipboard. Otherwise text-paste into the textarea would be eaten.
  event.preventDefault();
  void readAttachmentFiles(files);
}

function openFilePicker(): void {
  fileInput.value?.click();
}

function onFilePicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length > 0) void readAttachmentFiles(files);
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

defineExpose({ focus, collapseSuggestions, readFiles: readAttachmentFiles });
</script>
