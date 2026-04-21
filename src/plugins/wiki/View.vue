<template>
  <div class="h-full bg-white flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
      <div class="flex items-center gap-3">
        <button v-if="action !== 'index'" class="text-gray-400 hover:text-gray-700" title="Back to index" @click="navigate('index')">
          <span class="material-icons text-base">arrow_back</span>
        </button>
        <h2 class="text-lg font-semibold text-gray-800">{{ title }}</h2>
      </div>
      <div class="flex gap-1 items-center">
        <template v-if="action === 'page' && content">
          <button
            class="px-3 py-1 text-xs rounded-full border transition-colors border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 w-16 flex items-center justify-center gap-1"
            :disabled="pdfDownloading"
            @click="downloadPdf"
          >
            <svg v-if="pdfDownloading" class="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span v-else>↓ PDF</span>
            <span v-if="pdfDownloading">PDF</span>
          </button>
          <span v-if="pdfError" class="text-xs text-red-500" :title="pdfError">⚠ PDF failed</span>
        </template>
        <button
          class="px-3 py-1 text-xs rounded-full border transition-colors"
          :class="action === 'index' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'"
          @click="navigate('index')"
        >
          Index
        </button>
        <button
          class="px-3 py-1 text-xs rounded-full border transition-colors"
          :class="action === 'log' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'"
          @click="navigate('log')"
        >
          Log
        </button>
        <button
          class="px-3 py-1 text-xs rounded-full border transition-colors"
          :class="action === 'lint_report' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'"
          @click="navigate('lint_report')"
        >
          Lint
        </button>
      </div>
    </div>

    <!-- Navigation error -->
    <div v-if="navError" class="mx-6 mt-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
      {{ navError }}
    </div>

    <!-- Empty state -->
    <div v-if="!content && !navError" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
      <div class="text-center space-y-2">
        <span class="material-icons text-4xl text-gray-300">menu_book</span>
        <p>Wiki is empty. Ask the Wiki Manager to ingest a source.</p>
      </div>
    </div>

    <!-- Index: page card list -->
    <div v-else-if="action === 'index' && pageEntries && pageEntries.length > 0" class="flex-1 overflow-y-auto p-4 space-y-2">
      <div
        v-for="entry in pageEntries"
        :key="entry.slug"
        class="rounded-lg border border-gray-200 p-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors"
        @click="navigatePage(entry.slug || entry.title)"
      >
        <div class="font-medium text-sm text-gray-800">{{ entry.title }}</div>
        <div v-if="entry.description" class="text-xs text-gray-500 mt-0.5">
          {{ entry.description }}
        </div>
      </div>
    </div>

    <!-- Markdown content -->
    <div v-else class="flex-1 overflow-y-auto px-6 py-4 prose prose-sm max-w-none wiki-content" @click="handleContentClick" v-html="renderedContent" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { marked } from "marked";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WikiData, WikiPageEntry } from "./index";
import { handleExternalLinkClick } from "../../utils/dom/externalLink";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import { renderWikiLinks } from "./helpers";
import { rewriteMarkdownImageRefs } from "../../utils/image/rewriteMarkdownImageRefs";
import { apiPost, apiFetchRaw } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { errorMessage } from "../../utils/errors";

const props = defineProps<{
  selectedResult?: ToolResultComplete<WikiData>;
  sendTextMessage?: (text: string) => void;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const action = ref(props.selectedResult?.data?.action ?? "index");
const title = ref(props.selectedResult?.data?.title ?? "Wiki");
const content = ref(props.selectedResult?.data?.content ?? "");
const pageEntries = ref<WikiPageEntry[]>(props.selectedResult?.data?.pageEntries ?? []);

const { refresh } = useFreshPluginData<WikiData>({
  // Slug-aware: when the view is currently showing a specific page,
  // fetch that page by slug; otherwise fetch the index.
  endpoint: () => {
    const slug = action.value === "page" ? props.selectedResult?.data?.pageName : undefined;
    return slug ? `${API_ROUTES.wiki.base}?slug=${encodeURIComponent(slug)}` : API_ROUTES.wiki.base;
  },
  extract: (json) => (json as { data?: WikiData }).data ?? null,
  apply: (data) => {
    action.value = data.action ?? "index";
    title.value = data.title ?? "Wiki";
    content.value = data.content ?? "";
    pageEntries.value = data.pageEntries ?? [];
  },
});

watch(
  () => props.selectedResult?.uuid,
  () => {
    const d = props.selectedResult?.data;
    if (d) {
      action.value = d.action ?? "index";
      title.value = d.title ?? "Wiki";
      content.value = d.content ?? "";
      pageEntries.value = d.pageEntries ?? [];
    }
    void refresh();
  },
);

const renderedContent = computed(() => {
  if (!content.value) return "";
  // Rewrite workspace-relative image refs (`![alt](images/foo.png)`)
  // to `/api/files/raw?path=...` BEFORE marked parses them — without
  // this, the browser tries to fetch against the SPA route URL
  // (/chat/…/images/foo.png) and 404s. basePath = wiki/pages for
  // individual pages so `../images/foo.png` resolves correctly.
  const basePath = action.value === "page" ? "wiki/pages" : "wiki";
  const withImages = rewriteMarkdownImageRefs(content.value, basePath);
  return marked.parse(renderWikiLinks(withImages)) as string;
});

const navError = ref<string | null>(null);
const pdfDownloading = ref(false);
const pdfError = ref<string | null>(null);

async function callApi(body: Record<string, unknown>) {
  navError.value = null;
  const response = await apiPost<{
    data?: {
      action?: string;
      title?: string;
      content?: string;
      pageEntries?: WikiPageEntry[];
    };
  }>(API_ROUTES.wiki.base, body);
  if (!response.ok) {
    navError.value = response.status === 0 ? response.error : `Wiki API error ${response.status}: ${response.error}`;
    return;
  }
  const result = response.data;
  action.value = result.data?.action ?? "index";
  title.value = result.data?.title ?? "Wiki";
  content.value = result.data?.content ?? "";
  pageEntries.value = result.data?.pageEntries ?? [];
  if (props.selectedResult) {
    emit("updateResult", {
      ...props.selectedResult,
      ...result,
      toolName: "manageWiki",
      uuid: props.selectedResult.uuid,
    });
  }
}

function navigate(newAction: string) {
  callApi({ action: newAction });
}

function navigatePage(pageName: string) {
  callApi({ action: "page", pageName });
}

async function downloadPdf() {
  pdfError.value = null;
  pdfDownloading.value = true;
  let response: Response;
  try {
    response = await apiFetchRaw(API_ROUTES.pdf.markdown, {
      method: "POST",
      body: JSON.stringify({
        markdown: content.value,
        filename: `${title.value}.pdf`,
      }),
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    pdfError.value = errorMessage(err);
    pdfDownloading.value = false;
    return;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    pdfError.value = `PDF error ${response.status}: ${text}`;
    pdfDownloading.value = false;
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.value}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
  pdfDownloading.value = false;
}

function handleContentClick(e: MouseEvent) {
  // 1. Internal wiki links: `[[Page Name]]` was rewritten to a
  //    `<span class="wiki-link">` during markdown pre-processing,
  //    so it doesn't overlap with regular `<a>` handling.
  const target = e.target as HTMLElement;
  const link = target.closest(".wiki-link") as HTMLElement | null;
  if (link?.dataset.page) {
    navigatePage(link.dataset.page);
    return;
  }
  // 2. External http(s) links in the rendered markdown body: open
  //    in a new tab so clicking them doesn't navigate the whole
  //    SPA away from MulmoClaude. Same-origin and non-http links
  //    (mailto:, tel:, anchors) fall through to the browser default.
  handleExternalLinkClick(e);
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
