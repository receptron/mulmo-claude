<template>
  <div v-if="selectedPath" class="px-4 py-2 border-b border-gray-200 text-xs text-gray-500 font-mono shrink-0 flex items-center gap-2">
    <span class="truncate min-w-0">{{ selectedPath }}</span>
    <span v-if="size !== null" class="text-gray-400 shrink-0">· {{ formatBytes(size) }}</span>
    <span v-if="modifiedMs !== null" class="text-gray-400 shrink-0">· {{ formatDateTime(modifiedMs) }}</span>
    <button
      v-if="isMarkdown"
      class="ml-auto shrink-0 px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 font-sans"
      :title="mdRawMode ? t('fileContentHeader.showRendered') : t('fileContentHeader.showRaw')"
      @click="emit('toggleMdRaw')"
    >
      {{ mdRawMode ? t("fileContentHeader.rendered") : t("fileContentHeader.raw") }}
    </button>
    <button
      type="button"
      class="shrink-0 px-1 py-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
      :class="{ 'ml-auto': !isMarkdown }"
      :title="t('fileContentHeader.closeFile')"
      :aria-label="t('fileContentHeader.closeFile')"
      data-testid="close-file-btn"
      @click="emit('deselect')"
    >
      <span class="material-icons text-base" aria-hidden="true">close</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { formatDateTime } from "../utils/format/date";

const { t } = useI18n();

defineProps<{
  selectedPath: string | null;
  size: number | null;
  modifiedMs: number | null;
  isMarkdown: boolean;
  mdRawMode: boolean;
}>();

const emit = defineEmits<{
  toggleMdRaw: [];
  deselect: [];
}>();

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>
