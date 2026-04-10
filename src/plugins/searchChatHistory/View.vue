<template>
  <div class="h-full flex flex-col bg-white">
    <div class="px-6 py-4 border-b border-gray-100 shrink-0">
      <h2 class="text-lg font-semibold text-gray-800">
        <span class="material-icons text-base align-middle mr-1">history</span>
        Search Chat History
      </h2>
      <p class="text-sm text-gray-500 mt-1">
        Query: <span class="font-mono">{{ query }}</span>
        ·
        {{ results.length }} result{{ results.length === 1 ? "" : "s" }}
      </p>
    </div>
    <div class="flex-1 overflow-y-auto min-h-0 p-4 space-y-2">
      <div
        v-if="results.length === 0"
        class="text-center text-gray-400 text-sm py-8"
      >
        No matching sessions.
      </div>
      <div
        v-for="result in results"
        :key="result.id"
        class="rounded-lg border border-gray-200 p-3 hover:border-blue-300 hover:bg-blue-50 cursor-pointer transition-colors"
        @click="loadSession(result.id)"
      >
        <div
          class="flex items-baseline justify-between gap-2 text-xs text-gray-500 mb-1"
        >
          <span class="font-mono">{{ formatDate(result.startedAt) }}</span>
          <span>score {{ result.score }}</span>
        </div>
        <div class="font-semibold text-gray-800 truncate">
          {{ result.title || "(untitled)" }}
        </div>
        <div
          v-if="result.summary"
          class="text-sm text-gray-600 mt-0.5 line-clamp-2"
        >
          {{ result.summary }}
        </div>
        <div
          v-if="result.keywords && result.keywords.length > 0"
          class="flex flex-wrap gap-1 mt-2"
        >
          <span
            v-for="kw in result.keywords"
            :key="kw"
            class="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200"
            >{{ kw }}</span
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ChatHistorySearchData } from "./index";

const props = defineProps<{
  selectedResult: ToolResultComplete<ChatHistorySearchData>;
}>();

const query = computed(() => props.selectedResult.data?.query ?? "");
const results = computed(() => props.selectedResult.data?.results ?? []);

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

// Click on a result row → ask the parent to switch to that session.
// Implemented as a window event so this View doesn't need to know
// about App.vue's session loading API or have that wired through props.
function loadSession(id: string): void {
  window.dispatchEvent(
    new CustomEvent("mulmo:load-session", { detail: { id } }),
  );
}
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
