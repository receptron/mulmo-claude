<template>
  <div class="p-4 border-t border-gray-200" @dragover.prevent @drop="onDropFile">
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
        placeholder="Type a task..."
        :rows="inputFocused ? 8 : 2"
        class="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed resize-none transition-all duration-200"
        :class="inputFocused ? 'ring-2 ring-blue-300' : ''"
        :disabled="isRunning"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        @focus="inputFocused = true"
        @compositionstart="imeEnter.onCompositionStart"
        @compositionend="imeEnter.onCompositionEnd"
        @keydown="imeEnter.onKeydown"
        @blur="onInputBlur"
        @paste="onPasteFile"
      />
      <div class="flex flex-col gap-1">
        <button
          data-testid="send-btn"
          class="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="isRunning"
          @click="emit('send')"
        >
          <span class="material-icons text-base">send</span>
        </button>
        <button
          data-testid="expand-input-btn"
          class="text-gray-400 hover:text-gray-600 rounded px-3 py-1 text-sm"
          title="Expand editor"
          @click="openExpandedEditor"
        >
          <span class="material-icons text-base">open_in_full</span>
        </button>
      </div>
    </div>

    <div v-if="expandedEditorOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="closeExpandedEditor">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 flex flex-col" style="max-height: 80vh">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 class="text-sm font-semibold text-gray-700">Compose message</h3>
          <button class="text-gray-400 hover:text-gray-600" @click="closeExpandedEditor">
            <span class="material-icons text-base">close</span>
          </button>
        </div>
        <textarea
          ref="expandedTextarea"
          :value="modelValue"
          data-testid="expanded-input"
          placeholder="Type a task..."
          class="flex-1 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none"
          style="min-height: 300px"
          @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
          @keydown.meta.enter="sendFromExpanded"
          @keydown.ctrl.enter="sendFromExpanded"
        ></textarea>
        <div class="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <p class="text-xs text-gray-400">Cmd+Enter to send</p>
          <div class="flex gap-2">
            <button class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" @click="closeExpandedEditor">Cancel</button>
            <button
              class="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
              :disabled="isRunning"
              data-testid="expanded-send-btn"
              @click="sendFromExpanded"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import ChatAttachmentPreview from "./ChatAttachmentPreview.vue";
import { useImeAwareEnter } from "../composables/useImeAwareEnter";

export interface PastedFile {
  dataUrl: string;
  name: string;
  mime: string;
}

const props = defineProps<{
  modelValue: string;
  pastedFile: PastedFile | null;
  isRunning: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:pastedFile": [file: PastedFile | null];
  send: [];
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const expandedTextarea = ref<HTMLTextAreaElement | null>(null);
const inputFocused = ref(false);
const expandedEditorOpen = ref(false);
const fileError = ref<string | null>(null);

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

function isAcceptedType(mime: string): boolean {
  return ACCEPTED_MIME_PREFIXES.some((p) => mime.startsWith(p)) || ACCEPTED_MIME_EXACT.has(mime);
}

function readAttachmentFile(file: File): void {
  fileError.value = null;
  if (!isAcceptedType(file.type)) return;
  if (file.size > MAX_ATTACH_BYTES) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    fileError.value = `File too large (${sizeMB} MB). Maximum is 30 MB.`;
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

function onPasteFile(e: ClipboardEvent): void {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (isAcceptedType(item.type)) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        readAttachmentFile(file);
        return;
      }
    }
  }
}

function onDropFile(e: DragEvent): void {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) readAttachmentFile(file);
}

const imeEnter = useImeAwareEnter(() => emit("send"));

function onInputBlur(): void {
  imeEnter.onBlur();
  setTimeout(() => {
    inputFocused.value = false;
  }, 150);
}

function openExpandedEditor(): void {
  expandedEditorOpen.value = true;
  nextTick(() => expandedTextarea.value?.focus());
}

function closeExpandedEditor(): void {
  expandedEditorOpen.value = false;
  nextTick(() => textarea.value?.focus());
}

function sendFromExpanded(): void {
  if (props.isRunning) return;
  closeExpandedEditor();
  emit("send");
}

function focus(): void {
  textarea.value?.focus();
}

defineExpose({ focus });
</script>
