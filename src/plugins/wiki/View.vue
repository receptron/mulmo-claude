<template>
  <div class="h-full bg-white flex flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0"
    >
      <div class="flex items-center gap-3">
        <button
          v-if="action !== 'index'"
          class="text-gray-400 hover:text-gray-700"
          title="Back to index"
          @click="navigate('index')"
        >
          <span class="material-icons text-base">arrow_back</span>
        </button>
        <h2 class="text-lg font-semibold text-gray-800">{{ title }}</h2>
      </div>
      <div class="flex gap-1">
        <button
          class="px-3 py-1 text-xs rounded-full border transition-colors"
          :class="
            action === 'index'
              ? 'border-blue-400 bg-blue-50 text-blue-700'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          "
          @click="navigate('index')"
        >
          Index
        </button>
        <button
          class="px-3 py-1 text-xs rounded-full border transition-colors"
          :class="
            action === 'log'
              ? 'border-blue-400 bg-blue-50 text-blue-700'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          "
          @click="navigate('log')"
        >
          Log
        </button>
        <button
          class="px-3 py-1 text-xs rounded-full border transition-colors"
          :class="
            action === 'lint_report'
              ? 'border-blue-400 bg-blue-50 text-blue-700'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          "
          @click="navigate('lint_report')"
        >
          Lint
        </button>
      </div>
    </div>

    <!-- Navigation error -->
    <div
      v-if="navError"
      class="mx-6 mt-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
    >
      {{ navError }}
    </div>

    <!-- Empty state -->
    <div
      v-if="!content && !navError"
      class="flex-1 flex items-center justify-center text-gray-400 text-sm"
    >
      <div class="text-center space-y-2">
        <span class="material-icons text-4xl text-gray-300">menu_book</span>
        <p>Wiki is empty. Ask the Wiki Manager to ingest a source.</p>
      </div>
    </div>

    <!-- Index: page card list -->
    <div
      v-else-if="action === 'index' && pageEntries && pageEntries.length > 0"
      class="flex-1 overflow-y-auto p-4 space-y-2"
    >
      <div
        v-for="entry in pageEntries"
        :key="entry.slug"
        class="rounded-lg border border-gray-200 p-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors"
        @click="navigatePage(entry.title)"
      >
        <div class="font-medium text-sm text-gray-800">{{ entry.title }}</div>
        <div v-if="entry.description" class="text-xs text-gray-500 mt-0.5">
          {{ entry.description }}
        </div>
      </div>
    </div>

    <!-- Markdown content -->
    <div
      v-else
      class="flex-1 overflow-y-auto px-6 py-4 prose prose-sm max-w-none wiki-content"
      v-html="renderedContent"
      @click="handleContentClick"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { marked } from "marked";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WikiData, WikiPageEntry } from "./index";

const props = defineProps<{
  selectedResult: ToolResultComplete<WikiData>;
  sendTextMessage?: (text: string) => void;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const action = computed(() => props.selectedResult.data?.action ?? "index");
const title = computed(() => props.selectedResult.data?.title ?? "Wiki");
const content = computed(() => props.selectedResult.data?.content ?? "");
const pageEntries = computed(
  (): WikiPageEntry[] => props.selectedResult.data?.pageEntries ?? [],
);

const renderedContent = computed(() => {
  if (!content.value) return "";
  // Replace [[wiki links]] with styled spans before parsing
  const withLinks = content.value.replace(
    /\[\[([^\]]+)\]\]/g,
    '<span class="wiki-link" data-page="$1">$1</span>',
  );
  return marked.parse(withLinks) as string;
});

const navError = ref<string | null>(null);

async function callApi(body: Record<string, unknown>) {
  navError.value = null;
  let response: Response;
  try {
    response = await fetch("/api/wiki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    navError.value = err instanceof Error ? err.message : String(err);
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    navError.value = `Wiki API error ${response.status}: ${text}`;
    return;
  }

  const result = await response.json();
  emit("updateResult", {
    ...props.selectedResult,
    ...result,
    toolName: "manageWiki",
    uuid: props.selectedResult.uuid,
  });
}

function navigate(newAction: string) {
  callApi({ action: newAction });
}

function navigatePage(pageName: string) {
  callApi({ action: "page", pageName });
}

function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const link = target.closest(".wiki-link") as HTMLElement | null;
  if (link?.dataset.page) {
    navigatePage(link.dataset.page);
  }
}
</script>

<style scoped>
.wiki-content :deep(.wiki-link) {
  color: #2563eb;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
}
.wiki-content :deep(.wiki-link:hover) {
  text-decoration-style: solid;
}
.wiki-content :deep(h1) {
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  color: #111827;
}
.wiki-content :deep(h2) {
  font-size: 1.2rem;
  font-weight: 600;
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  color: #1f2937;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.25rem;
}
.wiki-content :deep(h3) {
  font-size: 1rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  color: #374151;
}
.wiki-content :deep(p) {
  margin-bottom: 0.75rem;
  line-height: 1.6;
  color: #374151;
}
.wiki-content :deep(ul),
.wiki-content :deep(ol) {
  margin-left: 1.5rem;
  margin-bottom: 0.75rem;
}
.wiki-content :deep(li) {
  margin-bottom: 0.25rem;
  line-height: 1.5;
  color: #374151;
}
.wiki-content :deep(ul) {
  list-style-type: disc;
}
.wiki-content :deep(ol) {
  list-style-type: decimal;
}
.wiki-content :deep(hr) {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 1rem 0;
}
.wiki-content :deep(code) {
  background: #f3f4f6;
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
  font-family: monospace;
}
.wiki-content :deep(pre) {
  background: #f3f4f6;
  padding: 0.75rem;
  border-radius: 0.375rem;
  overflow-x: auto;
  margin-bottom: 0.75rem;
}
.wiki-content :deep(pre code) {
  background: none;
  padding: 0;
}
.wiki-content :deep(blockquote) {
  border-left: 3px solid #d1d5db;
  padding-left: 1rem;
  color: #6b7280;
  margin: 0.75rem 0;
}
.wiki-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
}
.wiki-content :deep(th),
.wiki-content :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 0.5rem 0.75rem;
  text-align: left;
}
.wiki-content :deep(th) {
  background: #f9fafb;
  font-weight: 600;
}
</style>
