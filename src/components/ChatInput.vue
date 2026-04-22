<template>
  <div class="p-2 border-t border-gray-200" @dragover.prevent @drop="onDropFile">
    <div v-if="fileError" class="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5" data-testid="file-error">
      {{ fileError }}
    </div>
    <!-- Audio transcription panel — shown when an audio file is
         dropped/picked. Runs entirely in the browser via Whisper
         (Transformers.js); nothing is uploaded. -->
    <div v-if="transcribePanelOpen" class="mb-2 text-xs border border-gray-200 bg-gray-50 rounded px-3 py-2 space-y-2" data-testid="audio-transcribe-panel">
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium text-gray-700 truncate">
          <span class="material-icons text-sm align-middle mr-1">graphic_eq</span>
          {{ transcribeFilename }}
        </span>
        <button
          class="text-gray-400 hover:text-gray-600 shrink-0"
          :title="t('chatInput.audioPanel.discardButton')"
          data-testid="audio-transcribe-close"
          @click="discardTranscription"
        >
          <span class="material-icons text-sm">close</span>
        </button>
      </div>

      <!-- Progress states -->
      <div v-if="transcribeState.status === 'loading-model'" class="space-y-1">
        <div class="text-gray-600">{{ t("chatInput.audioPanel.preparing") }}</div>
        <div class="h-1.5 bg-gray-200 rounded overflow-hidden">
          <div class="h-full bg-blue-500 transition-[width] duration-150" :style="{ width: loadingPercent + '%' }"></div>
        </div>
      </div>
      <div v-else-if="transcribeState.status === 'decoding-audio'" class="flex items-center gap-2 text-gray-600">
        <svg class="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        {{ t("chatInput.audioPanel.decoding") }}
      </div>
      <div v-else-if="transcribeState.status === 'transcribing'" class="flex items-center gap-2 text-gray-600">
        <svg class="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        {{ t("chatInput.audioPanel.transcribing") }}
      </div>
      <div v-else-if="transcribeState.status === 'error'" class="text-red-600" data-testid="audio-transcribe-error">
        {{ t("chatInput.audioPanel.error", { error: transcribeState.error }) }}
      </div>
      <template v-else-if="transcribeState.status === 'done'">
        <pre class="max-h-40 overflow-auto text-[11px] font-mono text-gray-700 bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap">{{
          transcribeState.text
        }}</pre>
        <div class="flex gap-2 justify-end">
          <button
            class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
            data-testid="audio-transcribe-discard"
            @click="discardTranscription"
          >
            {{ t("chatInput.audioPanel.discardButton") }}
          </button>
          <button class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600" data-testid="audio-transcribe-paste" @click="pasteTranscription">
            {{ t("chatInput.audioPanel.pasteButton") }}
          </button>
        </div>
      </template>
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
          data-testid="send-btn"
          class="bg-blue-600 hover:bg-blue-700 text-white rounded w-8 h-8 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="isRunning"
          @click="emit('send')"
        >
          <span class="material-icons text-base leading-none">send</span>
        </button>
        <button
          data-testid="attach-file-btn"
          class="text-gray-400 hover:text-gray-600 rounded w-8 h-8 flex items-center justify-center"
          :title="t('chatInput.attachFile')"
          @click="openFilePicker"
        >
          <span class="material-icons text-base leading-none">attach_file</span>
        </button>
        <button
          data-testid="expand-input-btn"
          class="text-gray-400 hover:text-gray-600 rounded w-8 h-8 flex items-center justify-center"
          :title="t('chatInput.expandEditor')"
          @click="openExpandedEditor"
        >
          <span class="material-icons text-base leading-none">open_in_full</span>
        </button>
      </div>
    </div>

    <!-- Hidden file input driven by the attach button. The `accept`
         filter matches ACCEPTED_MIME_PREFIXES/_EXACT below; the change
         handler routes through the same readAttachmentFile() used by
         drop + paste, so all three paths behave identically. -->
    <input ref="fileInput" type="file" class="hidden" :accept="fileInputAccept" data-testid="file-input" @change="onFilePicked" />

    <div v-if="expandedEditorOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="closeExpandedEditor">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 flex flex-col" style="max-height: 80vh">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 class="text-sm font-semibold text-gray-700">{{ t("chatInput.composeMessage") }}</h3>
          <button class="text-gray-400 hover:text-gray-600" @click="closeExpandedEditor">
            <span class="material-icons text-base">close</span>
          </button>
        </div>
        <textarea
          ref="expandedTextarea"
          :value="modelValue"
          data-testid="expanded-input"
          :placeholder="t('chatInput.placeholder')"
          class="flex-1 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none"
          style="min-height: 300px"
          @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
          @keydown.meta.enter="sendFromExpanded"
          @keydown.ctrl.enter="sendFromExpanded"
        ></textarea>
        <div class="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <p class="text-xs text-gray-400">{{ t("chatInput.sendHint") }}</p>
          <div class="flex gap-2">
            <button class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" @click="closeExpandedEditor">
              {{ t("common.cancel") }}
            </button>
            <button
              class="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
              :disabled="isRunning"
              data-testid="expanded-send-btn"
              @click="sendFromExpanded"
            >
              {{ t("chatInput.send") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import ChatAttachmentPreview from "./ChatAttachmentPreview.vue";
import { useImeAwareEnter } from "../composables/useImeAwareEnter";
import { useWhisperTranscribe } from "../composables/useWhisperTranscribe";
import { isAudioFile, isVideoFile } from "../utils/audio/isAudioFile";

const { t } = useI18n();

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
const expandedEditorOpen = ref(false);
const fileError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

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
// `audio/*` is included so the picker lets the user select audio;
// the handler short-circuits to the transcription panel rather than
// attaching it. See startTranscription() below.
const fileInputAccept = [...ACCEPTED_MIME_PREFIXES.map((prefix) => `${prefix}*`), "audio/*", ...ACCEPTED_MIME_EXACT].join(",");

// ── Audio transcription path ───────────────────────────────────────
// Audio files don't go through readAttachmentFile (which converts to
// data URL for upload). Instead they feed Whisper in the browser and
// surface a preview + "Paste into message" button.
const { state: transcribeState, transcribe, reset: resetTranscribe } = useWhisperTranscribe();
const transcribePanelOpen = ref(false);
const transcribeFilename = ref("");

const loadingPercent = computed(() => {
  if (transcribeState.value.status !== "loading-model") return 0;
  return Math.round(transcribeState.value.progress * 100);
});

function startTranscription(file: File): void {
  fileError.value = null;
  transcribeFilename.value = file.name;
  transcribePanelOpen.value = true;
  void transcribe(file);
}

function pasteTranscription(): void {
  if (transcribeState.value.status !== "done") return;
  const appended = props.modelValue ? `${props.modelValue}\n\n${transcribeState.value.text}` : transcribeState.value.text;
  emit("update:modelValue", appended);
  discardTranscription();
  nextTick(() => textarea.value?.focus());
}

function discardTranscription(): void {
  transcribePanelOpen.value = false;
  transcribeFilename.value = "";
  resetTranscribe();
}

function isAcceptedType(mime: string): boolean {
  return ACCEPTED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) || ACCEPTED_MIME_EXACT.has(mime);
}

function readAttachmentFile(file: File): void {
  fileError.value = null;
  // Audio → route to the transcription panel instead of attaching.
  if (isAudioFile(file)) {
    startTranscription(file);
    return;
  }
  // Video — out of scope for v1, but we reject with a clear message
  // instead of silently falling through to the unsupported-type path.
  if (isVideoFile(file)) {
    fileError.value = t("chatInput.audioPanel.videoRejected");
    return;
  }
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
    // Audio types are also let through so a pasted audio clip opens
    // the transcription panel rather than getting silently dropped.
    if (isAcceptedType(item.type) || item.type.startsWith("audio/") || item.type.startsWith("video/")) {
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
