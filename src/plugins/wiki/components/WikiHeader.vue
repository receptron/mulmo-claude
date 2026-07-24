<template>
  <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
    <div class="flex items-center gap-2 min-w-0">
      <button
        v-if="action !== 'index' && isStandaloneWikiRoute"
        class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        :title="$t('pluginWiki.backToIndex')"
        @click="emit('back')"
      >
        <span class="material-icons text-base">arrow_back</span>
      </button>
      <h2 class="text-lg font-semibold text-gray-800 truncate">{{ displayTitle }}</h2>
    </div>
    <div class="flex items-center gap-2">
      <template v-if="(action === 'page' || action === 'page-edit') && hasContent">
        <button
          class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          :disabled="pdfDownloading"
          @click="emit('downloadPdf')"
        >
          <span class="material-icons text-base">{{ pdfDownloading ? "hourglass_empty" : "download" }}</span>
          {{ $t("pluginWiki.pdf") }}
        </button>
        <button
          class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          :disabled="zipDownloading"
          data-testid="wiki-zip-button"
          @click="emit('downloadZip')"
        >
          <span class="material-icons text-base">{{ zipDownloading ? "hourglass_empty" : "folder_zip" }}</span>
          {{ $t("common.downloadZip") }}
        </button>
        <span v-if="pdfError" class="text-xs text-red-500" :title="pdfError">{{ $t("pluginWiki.pdfFailed") }}</span>
        <span v-if="zipFailed" class="text-xs text-red-500">{{ $t("common.downloadFailed") }}</span>
      </template>
      <button
        v-if="action === 'index'"
        class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm transition-colors"
        data-testid="wiki-lint-chat-button"
        @click="emit('lintChat')"
      >
        <span class="material-icons text-base">rule</span>
        {{ $t("pluginWiki.lintChat") }}
      </button>
      <div class="flex border border-gray-300 rounded overflow-hidden">
        <button
          :class="[
            'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
            action === 'index' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
          ]"
          @click="emit('navigate', WIKI_ACTION.index)"
        >
          <span class="material-icons text-sm">list</span>
          <span>{{ $t("pluginWiki.tabIndex") }}</span>
        </button>
        <button
          :class="[
            'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
            action === 'log' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
          ]"
          @click="emit('navigate', WIKI_ACTION.log)"
        >
          <span class="material-icons text-sm">history</span>
          <span>{{ $t("pluginWiki.tabLog") }}</span>
        </button>
        <button
          :class="[
            'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
            action === 'lint_report' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
          ]"
          @click="emit('navigate', WIKI_ACTION.lintReport)"
        >
          <span class="material-icons text-sm">rule</span>
          <span>{{ $t("pluginWiki.tabLint") }}</span>
        </button>
        <button
          :class="[
            'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
            action === 'graph' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
          ]"
          data-testid="wiki-tab-graph"
          @click="emit('navigate', WIKI_ACTION.graph)"
        >
          <span class="material-icons text-sm">hub</span>
          <span>{{ $t("pluginWiki.tabGraph") }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { WIKI_ACTION } from "@mulmoclaude/core/wiki";
import type { WikiTabView } from "../composables/useWikiNavigation";

defineProps<{
  action: string;
  isStandaloneWikiRoute: boolean;
  displayTitle: string;
  hasContent: boolean;
  pdfDownloading: boolean;
  pdfError: string | null;
  zipDownloading: boolean;
  zipFailed: boolean;
}>();

const emit = defineEmits<{
  back: [];
  downloadPdf: [];
  downloadZip: [];
  lintChat: [];
  navigate: [action: typeof WIKI_ACTION.index | WikiTabView];
}>();
</script>
