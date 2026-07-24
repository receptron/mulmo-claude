<template>
  <div data-testid="wiki-page-tabs" class="shrink-0 border-b border-gray-100 px-3 py-2 flex items-center gap-2">
    <div class="flex border border-gray-300 rounded overflow-hidden">
      <button
        type="button"
        :class="[
          'h-8 px-2.5 flex items-center gap-1 transition-colors',
          pageTab === PAGE_TAB.content ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
        ]"
        data-testid="wiki-page-tab-content"
        @click="emit('select', PAGE_TAB.content)"
      >
        <span class="material-icons text-sm">article</span>
        <span>{{ $t("pluginWiki.history.tabContent") }}</span>
      </button>
      <button
        type="button"
        :class="[
          'h-8 px-2.5 flex items-center gap-1 border-l border-gray-200 transition-colors',
          pageTab === PAGE_TAB.history ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
        ]"
        data-testid="wiki-page-tab-history"
        @click="emit('select', PAGE_TAB.history)"
      >
        <span class="material-icons text-sm">history</span>
        <span>{{ $t("pluginWiki.history.tabHistory") }}</span>
      </button>
    </div>
    <!-- Restore success toast — transient banner emitted on the
         Content tab after a successful history restore (Q7=B). -->
    <span
      v-if="restoreToastVisible"
      data-testid="wiki-history-restore-toast"
      class="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1"
    >
      {{ $t("pluginWiki.history.restoreSuccessToast") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { PAGE_TAB, type PageTab } from "../pageTab";

defineProps<{
  pageTab: PageTab;
  restoreToastVisible: boolean;
}>();

const emit = defineEmits<{ select: [tab: PageTab] }>();
</script>
