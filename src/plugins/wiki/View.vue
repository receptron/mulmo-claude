<template>
  <div class="h-full bg-white flex flex-col">
    <!-- Header -->
    <WikiHeader
      :action="action"
      :is-standalone-wiki-route="isStandaloneWikiRoute"
      :display-title="displayTitle"
      :has-content="!!content"
      :pdf-downloading="pdfDownloading"
      :pdf-error="pdfError"
      :zip-downloading="zipDownloading"
      :zip-failed="zipFailed"
      @back="router.back()"
      @download-pdf="downloadPdf"
      @download-zip="downloadZipFile"
      @lint-chat="startLintChat"
      @navigate="navigate"
    />

    <!-- Navigation error -->
    <div v-if="navError" class="mx-6 mt-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
      {{ navError }}
    </div>

    <!-- Empty state: index / log / lint without content. The page
         action's empty states are rendered INSIDE the Content tab
         body below so the History tab stays reachable when the
         live page is missing or empty (codex review iter-2 #946 —
         history outlives the page). -->
    <div
      v-if="!content && !navError && action !== 'page' && action !== 'page-edit' && action !== 'graph'"
      class="flex-1 flex items-center justify-center text-gray-400 text-sm"
    >
      <div class="text-center space-y-2">
        <span class="material-icons text-4xl text-gray-300">menu_book</span>
        <p>{{ t("pluginWiki.empty") }}</p>
      </div>
    </div>

    <!-- Graph: force-directed map of the [[wiki-link]] network -->
    <WikiGraphTab v-else-if="action === 'graph'" :graph-data="graphData" :graph-error="graphError" @navigate="navigatePage" />

    <!-- Index: tag filter + page card list -->
    <div v-else-if="action === 'index' && pageEntries && pageEntries.length > 0" class="flex-1 flex flex-col overflow-hidden">
      <div v-if="allTags.length > 0 || selectedTag !== null" class="shrink-0 border-b border-gray-100 px-4 py-2 flex flex-wrap gap-1">
        <FilterChip :active="selectedTag === null" :label="t('pluginWiki.tagFilterAll')" data-testid="wiki-tag-filter-all" @click="selectedTag = null" />
        <FilterChip
          v-for="[tag, count] in allTags"
          :key="tag"
          :active="selectedTag === tag"
          :label="tag"
          :count="count"
          :data-testid="`wiki-tag-filter-${tag}`"
          @click="toggleTagFilter(tag)"
        />
        <FilterChip
          v-if="selectedTag !== null && !allTags.some(([tag]) => tag === selectedTag)"
          active
          :label="selectedTag"
          :count="tagCounts.get(selectedTag) ?? 1"
          :data-testid="`wiki-tag-filter-${selectedTag}`"
          @click="toggleTagFilter(selectedTag)"
        />
      </div>
      <div v-if="visibleEntries.length === 0 && selectedTag" class="flex-1 flex items-center justify-center text-gray-400 text-sm px-4 text-center">
        {{ t("pluginWiki.noMatches", { tag: selectedTag }) }}
      </div>
      <div v-else ref="scrollRef" class="flex-1 overflow-y-auto">
        <div
          v-for="entry in visibleEntries"
          :key="entry.slug"
          class="group flex items-baseline gap-2 px-4 py-1 cursor-pointer hover:bg-blue-50 transition-colors"
          :data-testid="`wiki-page-entry-${entry.slug || entry.title}`"
          @click="navigatePage(entry.slug || entry.title)"
        >
          <span class="font-medium text-sm text-gray-800 shrink-0">{{ entry.title }}</span>
          <span v-if="entry.description" class="text-xs text-gray-500 truncate">
            {{ entry.description }}
          </span>
          <span v-if="entry.tags && entry.tags.length > 0" class="flex gap-1 flex-wrap shrink-0 opacity-20 group-hover:opacity-100 transition-opacity">
            <button
              v-for="tag in entry.tags"
              :key="tag"
              class="entry-tag-chip"
              :data-testid="`wiki-entry-tag-${entry.slug}-${tag}`"
              @click.stop="setTagFilter(tag)"
            >
              {{ `#${tag}` }}
            </button>
          </span>
        </div>
      </div>
    </div>

    <!-- Markdown content (with optional metadata bar above) -->
    <template v-else>
      <!-- Metadata bar (#895 PR B). One thin row that surfaces
           `created` / `updated` / `editor` / `tags` from the page's
           frontmatter. Hidden when the page has no header — keeps
           the existing header-less content visually unchanged.
           Stays visible across both Content and History tabs (#944
           Q11=C). -->
      <WikiMetadataBar v-if="(action === 'page' || action === 'page-edit') && hasPageMeta" :meta="pageMeta" @tag-click="setTagFilterAndNavigate" />

      <!-- Per-page tab strip: Content | History (#763 PR 3 / #944).
           Mounted on every page view (including missing / empty
           pages) so history outlives the live page (codex iter-2
           #946). Log / lint reports keep the legacy single-pane
           layout — they have no per-page history concept. -->
      <WikiPageTabs
        v-if="action === 'page' && currentSlugReactive !== null"
        :page-tab="pageTab"
        :restore-toast-visible="restoreToastVisible"
        @select="pageTab = $event"
      />

      <!-- Content tab body. For pages, includes the empty-state
           fallbacks (deleted page / page with no body) so the
           History tab next to it stays reachable in those states. -->
      <template v-if="action === 'page'">
        <div v-show="pageTab === PAGE_TAB.content" ref="scrollRef" class="flex-1 overflow-y-auto flex flex-col">
          <!-- Empty state: page does not exist. -->
          <div v-if="!pageExists" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
            <div class="text-center space-y-4">
              <span class="material-icons text-4xl text-gray-300">article</span>
              <p>{{ t("pluginWiki.emptyPage", { title: title }) }}</p>
              <button
                v-if="isStandaloneWikiRoute"
                data-testid="wiki-create-page-button"
                class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                @click="requestCreatePage"
              >
                <span class="material-icons text-base">auto_fix_high</span>
                {{ t("pluginWiki.createPage") }}
              </button>
            </div>
          </div>
          <!-- Empty state: page exists but has no body. -->
          <div v-else-if="!content" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
            <div class="text-center space-y-4">
              <span class="material-icons text-4xl text-gray-300">article</span>
              <p>{{ t("pluginWiki.emptyContent", { title: title }) }}</p>
              <button
                v-if="isStandaloneWikiRoute"
                data-testid="wiki-update-page-button"
                class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                @click="requestUpdatePage"
              >
                <span class="material-icons text-base">auto_fix_high</span>
                {{ t("pluginWiki.updatePage") }}
              </button>
            </div>
          </div>
          <!-- Rendered markdown body + linked references panel. -->
          <template v-else>
            <WikiPageBody
              :body="mdDoc.body"
              :base-dir="WIKI_BASE_DIR"
              class="flex-1"
              @task-checkbox-click="onTaskCheckboxClick"
              @wiki-link-click="navigatePage"
              @workspace-link-click="(path) => appApi.navigateToWorkspacePath(path)"
            />
            <!-- Backlinks: other pages whose [[links]] point here.
                 Surfaces the dense cross-links Claude builds during
                 ingest (#wiki-backlinks-graph). -->
            <section v-if="linkedReferences.length > 0" data-testid="wiki-linked-references" class="shrink-0 border-t border-gray-100 px-6 py-4">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                {{ t("pluginWiki.linkedReferences") }}
              </h3>
              <ul class="space-y-1">
                <li v-for="backlink in linkedReferences" :key="backlink.slug">
                  <button
                    class="text-sm text-blue-600 hover:underline text-left"
                    :data-testid="`wiki-linked-reference-${backlink.slug}`"
                    @click="navigatePage(backlink.slug)"
                  >
                    {{ backlink.title }}
                  </button>
                </li>
              </ul>
            </section>
          </template>
        </div>
      </template>

      <!-- page-edit (#963) — single-pane snapshot render with
           optional "snapshot expired" banner and a "page deleted"
           placeholder when neither the snapshot nor the live page
           survives. -->
      <div v-else-if="action === 'page-edit'" ref="scrollRef" class="flex-1 overflow-y-auto">
        <div
          v-if="pageEditBanner"
          class="mx-6 mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700"
          data-testid="wiki-page-edit-banner"
        >
          {{ pageEditBanner }}
        </div>
        <div v-if="pageEditError" class="flex items-center justify-center text-gray-400 text-sm py-12" data-testid="wiki-page-edit-error">
          <div class="text-center space-y-2">
            <span class="material-icons text-4xl text-gray-300">cloud_off</span>
            <p>{{ pageEditError }}</p>
          </div>
        </div>
        <div v-else-if="pageEditDeleted" class="flex items-center justify-center text-gray-400 text-sm py-12" data-testid="wiki-page-edit-deleted">
          <div class="text-center space-y-2">
            <span class="material-icons text-4xl text-gray-300">delete</span>
            <p>{{ t("pluginWiki.pageDeleted") }}</p>
          </div>
        </div>
        <WikiPageBody
          v-else-if="content"
          :body="mdDoc.body"
          :base-dir="WIKI_BASE_DIR"
          @task-checkbox-click="onTaskCheckboxClick"
          @wiki-link-click="navigatePage"
          @workspace-link-click="(path) => appApi.navigateToWorkspacePath(path)"
        />
      </div>

      <!-- Non-page action: log / lint_report — single-pane render. -->
      <div v-else ref="scrollRef" class="flex-1 overflow-y-auto">
        <WikiPageBody
          :body="mdDoc.body"
          :base-dir="WIKI_BASE_DIR"
          @task-checkbox-click="onTaskCheckboxClick"
          @wiki-link-click="navigatePage"
          @workspace-link-click="(path) => appApi.navigateToWorkspacePath(path)"
        />
      </div>

      <!-- History tab body (kept mounted across tab toggles for state
           persistence, Q15=B). Mount whenever we have a slug — list /
           detail still work even if the live page was deleted. -->
      <HistoryTab
        v-if="action === 'page' && currentSlugReactive !== null"
        v-show="pageTab === PAGE_TAB.history"
        :slug="currentSlugReactive"
        :current-body="mdDoc.body"
        :current-meta="mdDoc.meta"
        @restored="handleRestored"
      />
    </template>

    <!-- Per-page chat composer (standalone /wiki route only). Sending
         spawns a fresh chat session with a prepended "read this page
         first" instruction — see AppApi.startNewChat. Hidden when
         WikiView is mounted as a manageWiki tool result inside /chat:
         the enclosing chat already has its own composer, and spawning
         a nested new session from there is confusing. Also hidden on
         the History tab (#944 Q11=C). -->
    <PageChatComposer
      v-if="action === 'page' && content && isStandaloneWikiRoute && currentSlugReactive !== null && pageTab === PAGE_TAB.content"
      :key="currentSlugReactive ?? ''"
      :placeholder="t('pluginWiki.chatPlaceholder')"
      :prepend-text="`Before answering, read the wiki page at ${WIKI_PAGES_DIR}/${currentSlugReactive}.md.`"
      test-id-prefix="wiki-page-chat"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WikiData, WikiPageEntry, WikiEndpoints } from "./index";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import { usePdfDownload } from "../../composables/usePdfDownload";
import { useMarkdownZip } from "../../composables/useMarkdownZip";
import { useAppApi } from "../../composables/useAppApi";
import { buildPdfFilename } from "@mulmoclaude/markdown-utils/files/filename";
import PageChatComposer from "../../components/PageChatComposer.vue";
import { pluginBuiltinRoleIds, pluginEndpoints, pluginPageRoute } from "../api";
import { useMarkdownDoc } from "@mulmoclaude/core/plugin-vue";
import { formatUpdated, metaString, metaStringArray } from "./helpers";
import { apiPost } from "../../utils/api";
import { WIKI_ACTION, readWikiRouteTarget, wikiActionFor } from "@mulmoclaude/core/wiki";
import FilterChip from "../../components/FilterChip.vue";
import HistoryTab from "./history/HistoryTab.vue";
import WikiPageBody from "./components/WikiPageBody.vue";
import WikiGraphTab from "./components/WikiGraphTab.vue";
import WikiHeader from "./components/WikiHeader.vue";
import WikiMetadataBar from "./components/WikiMetadataBar.vue";
import WikiPageTabs from "./components/WikiPageTabs.vue";
import { PAGE_TAB, type PageTab } from "./pageTab";
import { useWikiNavigation } from "./composables/useWikiNavigation";
import { useTagFilter } from "./composables/useTagFilter";
import { useWikiGraph } from "./composables/useWikiGraph";
import { useWikiPageSave } from "./composables/useWikiPageSave";
import { useWikiPageEdit } from "./composables/useWikiPageEdit";

const wikiEndpoints = pluginEndpoints<WikiEndpoints>("wiki");
const PAGE_WIKI = pluginPageRoute("wiki");

// Workspace-relative wiki dirs. Centralised so future layout shifts
// (e.g. the prior `wiki/` → `data/wiki/` move) only need to change
// these two literals — all callers (image-ref rewriter, wiki-link
// resolver, agent-prompt strings, the page-chat prepend-text in
// the template above) derive from them.
const WIKI_PAGES_DIR = "data/wiki/pages";
const WIKI_DATA_DIR = "data/wiki";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const appApi = useAppApi();

const props = defineProps<{
  selectedResult?: ToolResultComplete<WikiData>;
  sendTextMessage?: (text: string) => void;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const action = ref(props.selectedResult?.data?.action ?? "index");
const title = ref(props.selectedResult?.data?.title ?? "Wiki");
const content = ref(props.selectedResult?.data?.content ?? "");
// Frontmatter view of the loaded page content. Drives the
// metadata bar (Created / Updated / Editor / Tags) above the
// rendered body. `useMarkdownDoc` is reactive so editing or
// switching pages re-derives without manual recomputation.
const mdDoc = useMarkdownDoc(content);
const pageEntries = ref<WikiPageEntry[]>(props.selectedResult?.data?.pageEntries ?? []);
const pageExists = ref(props.selectedResult?.data?.pageExists ?? true);
// Declared up here — not next to callApi — because the URL watcher
// below fires with `immediate: true`, which invokes callApi
// synchronously during setup. If this ref were declared after the
// watcher, callApi's `navError.value = null` would hit the TDZ on
// direct loads of /wiki and the fetch would never run.
const navError = ref<string | null>(null);

// Per-page tab state for the Content / History switcher (#763 PR
// 3 / #944). Defaults to "content" on every page navigation
// (Q14=A) — the watcher on `currentSlugReactive` resets it. Within
// the same slug the History tab keeps its own selection state
// across toggles (Q15=B) because both tabs are kept mounted via
// v-show.
const pageTab = ref<PageTab>(PAGE_TAB.content);
const restoreToastVisible = ref(false);
const RESTORE_TOAST_MS = 4000;
let restoreToastTimer: ReturnType<typeof setTimeout> | null = null;

const { currentSlugReactive, currentSlug, isStandaloneWikiRoute, navigate, navigatePage } = useWikiNavigation({
  pageWikiRoute: PAGE_WIKI,
  pageNameFromResult: () => props.selectedResult?.data?.pageName ?? null,
});

const { selectedTag, tagCounts, allTags, visibleEntries, toggleTagFilter, setTagFilter } = useTagFilter(pageEntries, action);

const { graphData, graphError, loadGraph, syncGraphFromResult, linkedReferences } = useWikiGraph({
  action,
  pageExists,
  currentSlug: currentSlugReactive,
  endpointBase: wikiEndpoints.base,
});

const { pageEditTs, pageEditBanner, pageEditDeleted, pageEditError, loadPageEditData, resetPageEdit } = useWikiPageEdit({ content });

watch(currentSlugReactive, (next, prev) => {
  if (next === prev) return;
  pageTab.value = PAGE_TAB.content;
  // Drop any in-flight restore-success toast so it doesn't bleed
  // onto a different page (codex iter-1 #946).
  restoreToastVisible.value = false;
  if (restoreToastTimer !== null) {
    clearTimeout(restoreToastTimer);
    restoreToastTimer = null;
  }
});

// ── Metadata bar (#895 PR B) ──────────────────────────────────
//
// Derive `Created` / `Updated` / `Editor` / `Tags` from the page's
// frontmatter. `WikiMetadataBar` hides itself when none are present
// (header-less pages render unchanged so old wiki content keeps its
// current appearance).
const pageMeta = computed(() => ({
  created: metaString(mdDoc.value.meta.created),
  updated: metaString(mdDoc.value.meta.updated),
  editor: metaString(mdDoc.value.meta.editor),
  tags: metaStringArray(mdDoc.value.meta.tags),
}));

const hasPageMeta = computed(() => {
  const meta = pageMeta.value;
  return meta.created !== null || meta.updated !== null || meta.editor !== null || meta.tags.length > 0;
});

// Header subtitle for the page-edit action. "Wiki edit · {slug} ·
// {timestamp}" so the user immediately sees this is a moment-in-
// time view, not the live page. `formatUpdated` re-uses the same
// `YYYY-MM-DD HH:MM` shape as the metadata bar.
const displayTitle = computed(() => {
  if (action.value !== "page-edit") return title.value;
  const stamp = pageEditTs.value;
  const prefix = `${t("pluginWiki.pageEditHeader")} · ${title.value}`;
  return stamp ? `${prefix} · ${formatUpdated(stamp)}` : prefix;
});

const { pdfDownloading, pdfError, downloadPdf: rawDownloadPdf } = usePdfDownload();
const { zipDownloading, zipFailed, downloadZip: rawDownloadZip } = useMarkdownZip();

async function downloadPdf() {
  const uuid = props.selectedResult?.uuid;
  const filename = buildPdfFilename({
    name: title.value,
    fallback: "wiki",
    timestampMs: uuid ? appApi.getResultTimestamp(uuid) : undefined,
  });
  // Wiki pages live under data/wiki/pages/ — pass the source dir so
  // the server resolves relative `<img>` refs (`../../../artifacts/...`)
  // against the same base the browser uses. Wiki pages always carry
  // a frontmatter envelope (#895), so opt in to stripping it from the
  // PDF output.
  await rawDownloadPdf(content.value, filename, { baseDir: "data/wiki/pages", stripFrontmatter: true });
}

async function downloadZipFile() {
  const uuid = props.selectedResult?.uuid;
  const filename = buildPdfFilename({ name: title.value, fallback: "wiki", timestampMs: uuid ? appApi.getResultTimestamp(uuid) : undefined });
  await rawDownloadZip(content.value, filename, { baseDir: "data/wiki/pages", stripFrontmatter: true });
}

function applyWikiResult(data: Partial<WikiData> | undefined): void {
  action.value = data?.action ?? "index";
  title.value = data?.title ?? "Wiki";
  content.value = data?.content ?? "";
  pageEntries.value = data?.pageEntries ?? [];
  pageExists.value = data?.pageExists ?? true;
  syncGraphFromResult(data);
}

// Monotonic token so a slow POST for one navigation can't apply after the
// user has already navigated somewhere else (rapid page ↔ tab switching):
// the older response would otherwise render a body that disagrees with the
// URL until the next navigation.
let callApiSeq = 0;

async function callApi(body: Record<string, unknown>) {
  const seq = ++callApiSeq;
  navError.value = null;
  const response = await apiPost<{ data?: Partial<WikiData> }>(wikiEndpoints.base, body);
  if (seq !== callApiSeq) return;
  if (!response.ok) {
    navError.value = response.status === 0 ? response.error : `Wiki API error ${response.status}: ${response.error}`;
    return;
  }
  const result = response.data;
  applyWikiResult(result.data);
  if (props.selectedResult) {
    emit("updateResult", {
      ...props.selectedResult,
      ...result,
      toolName: "manageWiki",
      uuid: props.selectedResult.uuid,
    });
  }
}

const { refresh, abort: abortFreshFetch } = useFreshPluginData<WikiData>({
  // Slug-aware: when the view is currently showing a specific page,
  // fetch that page by slug; otherwise fetch the index. Reads the
  // slug via `currentSlug()` so both mount paths are covered —
  // standalone /wiki/<slug> via route params, embedded WikiView via
  // selectedResult. Reading only from selectedResult would make a
  // failed-save `refresh()` reload the index instead of the page
  // and clobber the user's view (#775 / codex iter 2).
  endpoint: () => {
    const slug = action.value === "page" ? currentSlug() : null;
    return slug ? `${wikiEndpoints.base}?slug=${encodeURIComponent(slug)}` : wikiEndpoints.base;
  },
  extract: (json) => (json as { data?: WikiData }).data ?? null,
  apply: (data) => {
    // The endpoint only fetches the correct payload for index / page
    // views; for log / lint_report / page-edit it returns the bare index,
    // which would clobber the embedded result. Skip those (mirrors the
    // guard Preview.vue carries — CodeRabbit V1 #6).
    if (action.value !== WIKI_ACTION.index && action.value !== WIKI_ACTION.page) return;
    action.value = data.action ?? "index";
    title.value = data.title ?? "Wiki";
    content.value = data.content ?? "";
    pageEntries.value = data.pageEntries ?? [];
    pageExists.value = data.pageExists ?? true;
  },
});

const { onTaskCheckboxClick } = useWikiPageSave({
  action,
  content,
  navError,
  currentSlug,
  endpointBase: wikiEndpoints.base,
  refresh,
});

onBeforeUnmount(() => {
  if (restoreToastTimer !== null) clearTimeout(restoreToastTimer);
});

function handleRestored(): void {
  pageTab.value = PAGE_TAB.content;
  restoreToastVisible.value = true;
  if (restoreToastTimer !== null) clearTimeout(restoreToastTimer);
  restoreToastTimer = setTimeout(() => {
    restoreToastVisible.value = false;
    restoreToastTimer = null;
  }, RESTORE_TOAST_MS);
  // Refresh the page content so the restored body shows up. Reload
  // the graph too — a restored version may add or drop `[[links]]`,
  // which changes this page's "Linked references".
  void refresh();
  void loadGraph();
}

onMounted(() => {
  // On /wiki, the route watcher below fires with `immediate: true` and
  // is the source of truth for the initial fetch (via POST callApi).
  // useFreshPluginData's mount fetch is GET-only and always returns
  // the index payload — if it resolves last, it clobbers log / lint /
  // page state. Cancel it here so the two can't race.
  if (route.name === PAGE_WIKI) abortFreshFetch();
  // page-edit toolResults source their content from the snapshot
  // endpoint via loadPageEditData. Cancel the mount fetch (which
  // targets /api/wiki) so it can't clobber state, and kick the
  // loader directly — the selectedResult watcher only fires on
  // subsequent uuid changes, not on the initial mount, so this is
  // the only place to seed page-edit content (#963).
  const data = props.selectedResult?.data;
  if (data?.action === "page-edit") {
    abortFreshFetch();
    if (data.slug && data.stamp) {
      void loadPageEditData(data.slug, data.stamp);
    }
  }
});

watch(
  () => props.selectedResult?.uuid,
  () => {
    const data = props.selectedResult?.data;
    if (data) {
      action.value = data.action ?? "index";
      title.value = data.title ?? data.slug ?? "Wiki";
      content.value = data.content ?? "";
      pageEntries.value = data.pageEntries ?? [];
      pageExists.value = data.pageExists ?? true;
    }
    // page-edit (Stage 3a #963): the toolResult only carries
    // {slug, stamp, pagePath} pointers — fetch the snapshot body
    // separately. Skip the generic refresh() that targets /api/wiki
    // (it would overwrite the snapshot content with the live page).
    if (data?.action === "page-edit" && data.slug && data.stamp) {
      void loadPageEditData(data.slug, data.stamp);
      return;
    }
    resetPageEdit();
    void refresh();
  },
);

// URL is the single source of truth for wiki navigation. Button
// handlers push to the router; this watcher drives callApi(). Only
// runs when WikiView is mounted as the /wiki page — when mounted as
// a manageWiki tool-result inside /chat, the tool-result watcher
// above seeds state and this watcher does nothing. Unsafe params
// (e.g. `/wiki/pages/..%2Fsecrets` decoded to `slug === "../secrets"`)
// are already intercepted by the router guard in `router/guards.ts`
// and redirected to `/wiki`; by the time the watcher fires, the
// params are known-safe. `readWikiRouteTarget` returning `null` here
// therefore means an unexpected shape — fall back to the index view.
watch(
  () => (route.name === PAGE_WIKI ? [route.params.section, route.params.slug] : null),
  (params) => {
    if (!params) return;
    const target = readWikiRouteTarget({ section: params[0], slug: params[1] }) ?? { kind: "index" };
    if (target.kind === "page") {
      callApi({ action: WIKI_ACTION.page, pageName: target.slug });
    } else {
      callApi({ action: wikiActionFor(target) });
    }
  },
  { immediate: true },
);

/** Base directory for wiki content, adjusted by the current view. */
const WIKI_BASE_DIR = computed(() => (action.value === "page" || action.value === "page-edit" ? WIKI_PAGES_DIR : WIKI_DATA_DIR));

// The wiki view stays mounted across wiki navigations (the router
// just updates params and callApi swaps content.value), so the
// scrollable container would otherwise keep the previous page's
// scrollTop. Reset to the top whenever the rendered body changes.
const scrollRef = ref<HTMLElement | null>(null);
// Key the scroll reset on page identity, not raw `content`, so an in-place
// edit (e.g. a task-checkbox toggle) doesn't yank a scrolled-down reader
// back to the top.
watch([currentSlugReactive, action], async () => {
  await nextTick();
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
});

// Spawn a new chat under the General role (which owns the wiki
// tooling) regardless of the role the user is currently viewing the
// wiki under. "lint my wiki" is a direct instruction to the agent,
// not a tool call — the agent decides how to run the lint and
// report back.
function startLintChat() {
  appApi.startNewChat("lint my wiki", pluginBuiltinRoleIds().general);
}

// Tag chips on the page metadata bar (#895 PR B) live in the
// `action === 'page'` view. Clicking one should jump to the
// filtered index — both navigating away from the page and
// pre-selecting the tag the user wants to explore. Without the
// navigation step the user would need a separate Back-to-index
// click to see the filter take effect.
function setTagFilterAndNavigate(tag: string) {
  setTagFilter(tag);
  navigate("index");
}

// Always route wiki create/update CTAs through pluginBuiltinRoleIds().general
// (the wiki-capable role) so the new chat has the tools needed to
// actually write the page. Omitting the role would fall through to
// `currentRoleId`, which could be anything — including roles without
// wiki tooling — and silently produce useless sessions.
function requestCreatePage() {
  appApi.startNewChat(
    `Create a wiki page about ${JSON.stringify(title.value)}. Research the topic and write a comprehensive article in ${WIKI_PAGES_DIR}/.`,
    pluginBuiltinRoleIds().general,
  );
}

function requestUpdatePage() {
  appApi.startNewChat(
    `Update the existing wiki page about ${JSON.stringify(title.value)}. The page file exists but has no content. Research the topic and write a comprehensive article in ${WIKI_PAGES_DIR}/.`,
    pluginBuiltinRoleIds().general,
  );
}
</script>

<style scoped>
.entry-tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 0.375rem;
  font-size: 0.7rem;
  line-height: 1rem;
  border-radius: 9999px;
  background-color: #f3f4f6;
  color: #4b5563;
  border: 1px solid transparent;
  cursor: pointer;
}
.entry-tag-chip:hover {
  background-color: #dbeafe;
  color: #1d4ed8;
}
</style>
