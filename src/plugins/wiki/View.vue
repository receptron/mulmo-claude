<template>
  <div class="h-full bg-white flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
      <div class="flex items-center gap-3">
        <button v-if="action !== 'index'" class="text-gray-400 hover:text-gray-700" :title="t('pluginWiki.backToIndex')" @click="router.back()">
          <span class="material-icons text-base">arrow_back</span>
        </button>
        <h2 class="text-lg font-semibold text-gray-800">{{ title }}</h2>
      </div>
      <div class="flex gap-1 items-center">
        <template v-if="action === 'page' && content">
          <div class="button-group">
            <button class="download-btn download-btn-green" :disabled="pdfDownloading" @click="downloadPdf">
              <span class="material-icons">{{ pdfDownloading ? "hourglass_empty" : "download" }}</span>
              {{ t("pluginWiki.pdf") }}
            </button>
          </div>
          <span v-if="pdfError" class="text-xs text-red-500 self-center ml-2" :title="pdfError">{{ t("pluginWiki.pdfFailed") }}</span>
        </template>
        <div class="flex border border-gray-300 rounded overflow-hidden text-xs">
          <button
            :class="[
              'px-2.5 py-1 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
              action === 'index' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
            ]"
            @click="navigate('index')"
          >
            <span class="material-icons text-sm">list</span>
            <span>{{ t("pluginWiki.tabIndex") }}</span>
          </button>
          <button
            :class="[
              'px-2.5 py-1 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
              action === 'log' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
            ]"
            @click="navigate('log')"
          >
            <span class="material-icons text-sm">history</span>
            <span>{{ t("pluginWiki.tabLog") }}</span>
          </button>
          <button
            :class="[
              'px-2.5 py-1 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
              action === 'lint_report' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
            ]"
            @click="navigate('lint_report')"
          >
            <span class="material-icons text-sm">rule</span>
            <span>{{ t("pluginWiki.tabLint") }}</span>
          </button>
        </div>
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
        <p>{{ t("pluginWiki.empty") }}</p>
      </div>
    </div>

    <!-- Index: page card list -->
    <div v-else-if="action === 'index' && pageEntries && pageEntries.length > 0" class="flex-1 overflow-y-auto">
      <div
        v-for="entry in pageEntries"
        :key="entry.slug"
        class="flex items-baseline gap-2 px-4 py-1 cursor-pointer hover:bg-blue-50 transition-colors"
        :data-testid="`wiki-page-entry-${entry.slug || entry.title}`"
        @click="navigatePage(entry.slug || entry.title)"
      >
        <span class="font-medium text-sm text-gray-800 shrink-0">{{ entry.title }}</span>
        <span v-if="entry.description" class="text-xs text-gray-500 truncate">
          {{ entry.description }}
        </span>
      </div>
    </div>

    <!-- Markdown content -->
    <div v-else class="flex-1 overflow-y-auto px-6 py-4 prose prose-sm max-w-none wiki-content" @click="handleContentClick" v-html="renderedContent" />

    <!-- Per-page chat composer (standalone /wiki route only). Sending
         spawns a fresh chat session with a prepended "read this page
         first" instruction — see AppApi.startNewChat. Hidden when
         WikiView is mounted as a manageWiki tool result inside /chat:
         the enclosing chat already has its own composer, and spawning
         a nested new session from there is confusing. -->
    <div v-if="action === 'page' && content && isStandaloneWikiRoute" class="border-t border-gray-200 px-4 py-3 shrink-0 bg-gray-50">
      <div class="flex gap-2">
        <textarea
          v-model="chatDraft"
          data-testid="wiki-page-chat-input"
          :placeholder="t('pluginWiki.chatPlaceholder')"
          rows="2"
          class="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none"
          @compositionstart="imeEnter.onCompositionStart"
          @compositionend="imeEnter.onCompositionEnd"
          @keydown="imeEnter.onKeydown"
          @blur="imeEnter.onBlur"
        />
        <button
          data-testid="wiki-page-chat-send"
          class="bg-blue-600 hover:bg-blue-700 text-white rounded w-8 h-8 flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed self-start"
          :title="t('pluginWiki.chatSend')"
          :disabled="!canSendChat"
          @click="submitChat"
        >
          <span class="material-icons text-base leading-none">send</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, isNavigationFailure, type LocationQuery } from "vue-router";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WikiData, WikiPageEntry } from "./index";
import { handleExternalLinkClick } from "../../utils/dom/externalLink";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import { useImeAwareEnter } from "../../composables/useImeAwareEnter";
import { usePdfDownload } from "../../composables/usePdfDownload";
import { useAppApi } from "../../composables/useAppApi";
import { renderWikiLinks } from "./helpers";
import { rewriteMarkdownImageRefs } from "../../utils/image/rewriteMarkdownImageRefs";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { PAGE_ROUTES } from "../../router";

type WikiTabView = "log" | "lint_report";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const props = defineProps<{
  selectedResult?: ToolResultComplete<WikiData>;
  sendTextMessage?: (text: string) => void;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const action = ref(props.selectedResult?.data?.action ?? "index");
const title = ref(props.selectedResult?.data?.title ?? "Wiki");
const content = ref(props.selectedResult?.data?.content ?? "");
const pageEntries = ref<WikiPageEntry[]>(props.selectedResult?.data?.pageEntries ?? []);
// Declared up here — not next to callApi — because the URL watcher
// below fires with `immediate: true`, which invokes callApi
// synchronously during setup. If this ref were declared after the
// watcher, callApi's `navError.value = null` would hit the TDZ on
// direct loads of /wiki and the fetch would never run.
const navError = ref<string | null>(null);

const { refresh, abort: abortFreshFetch } = useFreshPluginData<WikiData>({
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

onMounted(() => {
  // On /wiki, the route watcher below fires with `immediate: true` and
  // is the source of truth for the initial fetch (via POST callApi).
  // useFreshPluginData's mount fetch is GET-only and always returns
  // the index payload — if it resolves last, it clobbers log / lint /
  // page state. Cancel it here so the two can't race.
  if (route.name === PAGE_ROUTES.wiki) abortFreshFetch();
});

watch(
  () => props.selectedResult?.uuid,
  () => {
    const data = props.selectedResult?.data;
    if (data) {
      action.value = data.action ?? "index";
      title.value = data.title ?? "Wiki";
      content.value = data.content ?? "";
      pageEntries.value = data.pageEntries ?? [];
    }
    void refresh();
  },
);

// URL is the single source of truth for wiki navigation. Button
// handlers push to the router; this watcher drives callApi(). Only
// runs when WikiView is mounted as the /wiki page — when mounted as
// a manageWiki tool-result inside /chat, the tool-result watcher
// above seeds state and this watcher does nothing.
watch(
  () => (route.name === PAGE_ROUTES.wiki ? [route.query.page, route.query.view] : null),
  (params) => {
    if (!params) return;
    const [page, view] = params;
    if (typeof page === "string" && page.length > 0) {
      callApi({ action: "page", pageName: page });
    } else if (view === "log" || view === "lint_report") {
      callApi({ action: view });
    } else {
      callApi({ action: "index" });
    }
  },
  { immediate: true },
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

const { pdfDownloading, pdfError, downloadPdf: rawDownloadPdf } = usePdfDownload();

async function downloadPdf() {
  await rawDownloadPdf(content.value, `${title.value}.pdf`);
}

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

function dropKeys(query: LocationQuery, keys: string[]): LocationQuery {
  const next: LocationQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (!keys.includes(key)) next[key] = value;
  }
  return next;
}

function pushWiki(query: LocationQuery) {
  const target = route.name === PAGE_ROUTES.wiki ? { query } : { name: PAGE_ROUTES.wiki, query };
  router.push(target).catch((err: unknown) => {
    if (!isNavigationFailure(err)) {
      console.error("[wiki] navigation failed:", err);
    }
  });
}

// Preserve siblings only when already on /wiki. Cross-route jumps
// (e.g. from /chat, where the URL may carry `?result=<uuid>`) start
// from a clean query so chat-specific params don't bleed into /wiki.
function currentWikiQuery(): LocationQuery {
  return route.name === PAGE_ROUTES.wiki ? route.query : {};
}

function navigate(newAction: "index" | WikiTabView) {
  const base = currentWikiQuery();
  const query = newAction === "index" ? dropKeys(base, ["page", "view"]) : { ...dropKeys(base, ["page"]), view: newAction };
  pushWiki(query);
}

function navigatePage(pageName: string) {
  pushWiki({ ...dropKeys(currentWikiQuery(), ["view"]), page: pageName });
}

// --- Per-page chat composer ---
const appApi = useAppApi();
const chatDraft = ref("");

const isStandaloneWikiRoute = computed(() => route.name === PAGE_ROUTES.wiki);
const canSendChat = computed(() => chatDraft.value.trim().length > 0 && currentSlug() !== null);

// Reject path-traversal tokens so `?page=../secrets` can't be
// interpolated into the prompt and escape `data/wiki/pages/`. Keeps
// non-ASCII slugs (e.g. Japanese titles like `さくらインターネット`)
// working — we only ban separators and `..`, not arbitrary unicode.
function isSafeSlug(slug: string): boolean {
  return slug.length > 0 && !slug.includes("/") && !slug.includes("\\") && !slug.includes("..");
}

function currentSlug(): string | null {
  // Prefer the URL on /wiki (source of truth for that route); fall
  // back to the tool-result payload when WikiView is mounted as a
  // manageWiki result inside /chat.
  const raw = route.name === PAGE_ROUTES.wiki && typeof route.query.page === "string" ? route.query.page : (props.selectedResult?.data?.pageName ?? null);
  if (!raw || !isSafeSlug(raw)) return null;
  return raw;
}

function submitChat() {
  const text = chatDraft.value.trim();
  const slug = currentSlug();
  if (!text || !slug) return;
  const prompt = `Before answering, read the wiki page at data/wiki/pages/${slug}.md.\n\n${text}`;
  chatDraft.value = "";
  appApi.startNewChat(prompt);
}

const imeEnter = useImeAwareEnter(submitChat);

function handleContentClick(event: MouseEvent) {
  // 1. Internal wiki links: `[[Page Name]]` was rewritten to a
  //    `<span class="wiki-link">` during markdown pre-processing,
  //    so it doesn't overlap with regular `<a>` handling.
  const target = event.target as HTMLElement;
  const link = target.closest(".wiki-link") as HTMLElement | null;
  if (link?.dataset.page) {
    navigatePage(link.dataset.page);
    return;
  }
  // 2. External http(s) links in the rendered markdown body: open
  //    in a new tab so clicking them doesn't navigate the whole
  //    SPA away from MulmoClaude. Same-origin and non-http links
  //    (mailto:, tel:, anchors) fall through to the browser default.
  handleExternalLinkClick(event);
}
</script>

<style scoped>
.button-group {
  display: flex;
  gap: 0.5em;
}
.download-btn {
  padding: 0.5em 1em;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 0.5em;
}
.download-btn-green {
  background-color: #4caf50;
}
.download-btn .material-icons {
  font-size: 1.2em;
}
.download-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
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
