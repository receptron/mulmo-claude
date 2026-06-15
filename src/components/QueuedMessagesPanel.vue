<template>
  <!-- Inline panel that lists messages the user submitted while a
       previous run was still streaming. The submit-time snapshot is
       stored in App.vue's `queuedMessages` ref; once
       `activeSessionRunning` flips false the watcher shifts them off
       FIFO into sendMessage(). plans/feat-chat-input-queued-send.md
       for the rationale. -->
  <div v-if="messages.length > 0" data-testid="queued-messages-panel" class="border-t border-gray-100 bg-amber-50/60 px-3 py-2">
    <div class="text-[11px] font-medium text-amber-800 mb-1">
      {{ t("chatInput.queuedHeading", { count: messages.length }) }}
    </div>
    <ul class="flex flex-col gap-1">
      <li
        v-for="(entry, index) in messages"
        :key="index"
        data-testid="queued-message-item"
        class="flex items-start gap-2 text-xs text-gray-800 bg-white border border-amber-200 rounded px-2 py-1"
      >
        <span class="text-amber-700 leading-snug shrink-0 tabular-nums">{{ `#${index + 1}` }}</span>
        <span class="flex-1 whitespace-pre-wrap break-words leading-snug">{{ entry.text }}</span>
        <span v-if="entry.files.length > 0" class="shrink-0 text-[10px] text-amber-700">
          {{ t("chatInput.queuedAttachmentBadge", { count: entry.files.length }) }}
        </span>
        <button
          data-testid="queued-message-remove"
          class="shrink-0 text-gray-400 hover:text-gray-600 text-sm leading-none"
          :title="t('chatInput.queuedRemove')"
          :aria-label="t('chatInput.queuedRemove')"
          @click="emit('remove', index)"
        >
          ✕
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PastedFile } from "../types/pastedFile";

const { t } = useI18n();

defineProps<{
  messages: { text: string; files: PastedFile[] }[];
}>();

const emit = defineEmits<{ remove: [index: number] }>();
</script>
