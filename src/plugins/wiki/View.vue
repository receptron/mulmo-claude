<template>
  <div class="h-full bg-white flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <button
          v-if="action !== 'index'"
          class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          :title="t('pluginWiki.backToIndex')"
          @click="router.back()"
        >
          <span class="material-icons text-base">arrow_back</span>
        </button>
        <h2 class="text-lg font-semibold text-gray-800 truncate">{{ title }}</h2>
      </div>
      <div class="flex items-center gap-2">
        <template v-if="action === 'page' && content">
          <button
            class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            :disabled="pdfDownloading"
            @click="downloadPdf"
          >
            <span class="material-icons text-base">{{ pdfDownloading ? "hourglass_empty" : "download" }}</span>
            {{ t("pluginWiki.pdf") }}
          </button>
          <span v-if="pdfError" class="text-xs text-red-500" :title="pdfError">{{ t("pluginWiki.pdfFailed") }}</span>
        </template>
        <button
          v-if="action === 'index'"
          class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm transition-colors"
          data-testid="wiki-lint-chat-button"
          @click="startLintChat"
        >
          <span class="material-icons text-base">rule</span>
          {{ t("pluginWiki.lintChat") }}
        </button>
        <div class="flex border border-gray-300 rounded overflow-hidden">
          <button
            :class="[
              'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
              action === 'index' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
            ]"
            @click="navigate('index')"
          >
            <span class="material-icons text-sm">list</span>
            <span>{{ t("pluginWiki.tabIndex") }}</span>
          </button>
          <button
            :class="[
              'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
              action === 'log' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
            ]"
            @click="navigate('log')"
          >
            <span class="material-icons text-sm">history</span>
            <span>{{ t("pluginWiki.tabLog") }}</span>
          </button>
          <button
            :class="[
              'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
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

    <!-- Empty state: specific page (standalone /wiki route only — inside
         /chat tool results, spawning a fresh session is confusing, same
         rationale as the per-page chat composer below) -->
    <div v-if="!pageExists && !navError && action === 'page'" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
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

    <!-- Empty state: page file exists but has no content -->
    <div v-else-if="!content && !navError && action === 'page'" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
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

    <!-- Empty state: index or other -->
    <div v-else-if="!content && !navError" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
      <div class="text-center space-y-2">
        <span class="material-icons text-4xl text-gray-300">menu_book</span>
        <p>{{ t("pluginWiki.empty") }}</p>
      </div>
    </div>

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
          :active="true"
          :label="selectedTag"
          :count="1"
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
          class="flex items-baseline gap-2 px-4 py-1 cursor-pointer hover:bg-blue-50 transition-colors"
          :data-testid="`wiki-page-entry-${entry.slug || entry.title}`"
          @click="navigatePage(entry.slug || entry.title)"
        >
          <span class="font-medium text-sm text-gray-800 shrink-0">{{ entry.title }}</span>
          <span v-if="entry.description" class="text-xs text-gray-500 truncate">
            {{ entry.description }}
          </span>
          <span v-if="entry.tags && entry.tags.length > 0" class="flex gap-1 flex-wrap shrink-0">
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

    <!-- Markdown content -->
    <div
      v-else
      ref="scrollRef"
      class="flex-1 overflow-y-auto px-6 py-4 prose prose-sm max-w-none wiki-content"
      @click="handleContentClick"
      v-html="renderedContent"
    />

    <!-- Per-page chat composer (standalone /wiki route only). Sending
         spawns a fresh chat session with a prepended "read this page
         first" instruction — see AppApi.startNewChat. Hidden when
         WikiView is mounted as a manageWiki tool result inside /chat:
         the enclosing chat already has its own composer, and spawning
         a nested new session from there is confusing. -->
    <PageChatComposer
      v-if="action === 'page' && content && isStandaloneWikiRoute && currentSlug() !== null"
      :key="currentSlug() ?? ''"
      :placeholder="t('pluginWiki.chatPlaceholder')"
      :prepend-text="`Before answering, read the wiki page at data/wiki/pages/${currentSlug()}.md.`"
      test-id-prefix="wiki-page-chat"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WikiData, WikiPageEntry } from "./index";
import { handleExternalLinkClick } from "../../utils/dom/externalLink";
import { classifyWorkspacePath, resolveWikiHref } from "../../utils/path/workspaceLinkRouter";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import { usePdfDownload } from "../../composables/usePdfDownload";
import { useAppApi } from "../../composables/useAppApi";
import { buildPdfFilename } from "../../utils/files/filename";
import { renderWikiLinks } from "./helpers";
import PageChatComposer from "../../components/PageChatComposer.vue";
import { BUILTIN_ROLE_IDS } from "../../config/roles";
import { rewriteMarkdownImageRefs } from "../../utils/image/rewriteMarkdownImageRefs";
import { extractFrontmatter } from "../../utils/format/frontmatter";
import { findTaskLines, makeTasksInteractive, toggleTaskAt } from "../../utils/markdown/taskList";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { PAGE_ROUTES } from "../../router";
import { WIKI_ACTION, WIKI_ROUTE_SECTION, buildWikiRouteParams, isSafeWikiSlug, readWikiRouteTarget, wikiActionFor, type WikiTarget } from "./route";
import FilterChip from "../../components/FilterChip.vue";

type WikiTabView = typeof WIKI_ACTION.log | typeof WIKI_ACTION.lintReport;

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
const pageExists = ref(props.selectedResult?.data?.pageExists ?? true);
// View-local tag filter. Null = no filter. Not persisted to URL —
// kept intentionally ephemeral so it doesn't leak into bookmarks
// or the per-session stack history.
const selectedTag = ref<string | null>(null);
// Declared up here — not next to callApi — because the URL watcher
// below fires with `immediate: true`, which invokes callApi
// synchronously during setup. If this ref were declared after the
// watcher, callApi's `navError.value = null` would hit the TDZ on
// direct loads of /wiki and the fetch would never run.
const navError = ref<string | null>(null);

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
    return slug ? `${API_ROUTES.wiki.base}?slug=${encodeURIComponent(slug)}` : API_ROUTES.wiki.base;
  },
  extract: (json) => (json as { data?: WikiData }).data ?? null,
  apply: (data) => {
    action.value = data.action ?? "index";
    title.value = data.title ?? "Wiki";
    content.value = data.content ?? "";
    pageEntries.value = data.pageEntries ?? [];
    pageExists.value = data.pageExists ?? true;
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
      pageExists.value = data.pageExists ?? true;
    }
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
  () => (route.name === PAGE_ROUTES.wiki ? [route.params.section, route.params.slug] : null),
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

// Tag frequencies for the filter bar — sorted by count desc, then
// name asc so the most common tags appear first and equally-common
// tags stay in deterministic order. Singletons are dropped: a tag
// used on a single page adds no filtering value, just visual noise.
// Per-entry `#tag` chips still render every tag, so singletons stay
// clickable from the row itself.
const allTags = computed<[string, number][]>(() => {
  const counts = new Map<string, number>();
  for (const entry of pageEntries.value) {
    for (const tag of entry.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).sort(([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB));
});

const visibleEntries = computed(() =>
  selectedTag.value === null ? pageEntries.value : pageEntries.value.filter((entry) => (entry.tags ?? []).includes(selectedTag.value as string)),
);

function toggleTagFilter(tag: string) {
  selectedTag.value = selectedTag.value === tag ? null : tag;
}

// Per-entry tag chips set the filter unconditionally — clicking a
// `#javascript` chip on a page row should always filter the index to
// that tag, even when the user is already viewing the same filter.
// Using `toggleTagFilter` here was unintuitive: clicking a `#tag`
// chip on a row that's already in the active filter would clear the
// filter, surprising the user. The filter chips at the top of the
// list still toggle (so users have an obvious "click again to clear"
// affordance there).
function setTagFilter(tag: string) {
  selectedTag.value = tag;
}

// Spawn a new chat under the General role (which owns the wiki
// tooling) regardless of the role the user is currently viewing the
// wiki under. "lint my wiki" is a direct instruction to the agent,
// not a tool call — the agent decides how to run the lint and
// report back.
function startLintChat() {
  appApi.startNewChat("lint my wiki", BUILTIN_ROLE_IDS.general);
}

// Clear the filter whenever we leave the index view — otherwise
// switching to Log / Lint and back leaves a stale filter active,
// which feels like a bug.
watch(action, (next) => {
  if (next !== "index") selectedTag.value = null;
});

// The wiki view stays mounted across wiki navigations (the router
// just updates params and callApi swaps content.value), so the
// scrollable container would otherwise keep the previous page's
// scrollTop. Reset to the top whenever the rendered body changes.
const scrollRef = ref<HTMLElement | null>(null);
watch(content, async () => {
  await nextTick();
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
});

/** Base directory for wiki content, adjusted by the current view. */
const WIKI_BASE_DIR = computed(() => (action.value === "page" ? "data/wiki/pages" : "data/wiki"));

const renderedContent = computed(() => {
  if (!content.value) return "";
  // Strip YAML frontmatter before rendering — marked doesn't parse
  // it, so the `---` fences turn into <hr>s and the inner keys
  // render as plain text (title / created / updated / tags / source).
  const body = extractFrontmatter(content.value).body;
  if (!body) return "";
  // Rewrite workspace-relative image refs (`![alt](images/foo.png)`)
  // to `/api/files/raw?path=...` BEFORE marked parses them — without
  // this, the browser tries to fetch against the SPA route URL
  // (/chat/…/images/foo.png) and 404s. Reuse WIKI_BASE_DIR so a
  // page's `../images/foo.png` resolves under `data/wiki/`.
  const withImages = rewriteMarkdownImageRefs(body, WIKI_BASE_DIR.value);
  // Strip marked's `disabled=""` from GFM task checkboxes and tag
  // them with `class="md-task"` so `handleContentClick` can find
  // them via DOM delegation (#775). Other view modes (index / log /
  // lint_report) get the same transform — it's a no-op when no
  // checkboxes are present.
  return makeTasksInteractive(marked.parse(renderWikiLinks(withImages)) as string);
});

const { pdfDownloading, pdfError, downloadPdf: rawDownloadPdf } = usePdfDownload();

async function downloadPdf() {
  const uuid = props.selectedResult?.uuid;
  const filename = buildPdfFilename({
    name: title.value,
    fallback: "wiki",
    timestampMs: uuid ? appApi.getResultTimestamp(uuid) : undefined,
  });
  await rawDownloadPdf(content.value, filename);
}

async function callApi(body: Record<string, unknown>) {
  navError.value = null;
  const response = await apiPost<{
    data?: {
      action?: string;
      title?: string;
      content?: string;
      pageEntries?: WikiPageEntry[];
      pageExists?: boolean;
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
  pageExists.value = result.data?.pageExists ?? true;
  if (props.selectedResult) {
    emit("updateResult", {
      ...props.selectedResult,
      ...result,
      toolName: "manageWiki",
      uuid: props.selectedResult.uuid,
    });
  }
}

function pushWiki(target: WikiTarget) {
  router.push({ name: PAGE_ROUTES.wiki, params: buildWikiRouteParams(target) }).catch((err: unknown) => {
    if (!isNavigationFailure(err)) {
      console.error("[wiki] navigation failed:", err);
    }
  });
}

function navigate(newAction: typeof WIKI_ACTION.index | WikiTabView) {
  pushWiki(newAction === WIKI_ACTION.index ? { kind: "index" } : { kind: newAction });
}

function navigatePage(pageName: string) {
  pushWiki({ kind: "page", slug: pageName });
}

// --- Per-page chat composer ---
const appApi = useAppApi();

const isStandaloneWikiRoute = computed(() => route.name === PAGE_ROUTES.wiki);

// Always route wiki create/update CTAs through BUILTIN_ROLE_IDS.general
// (the wiki-capable role) so the new chat has the tools needed to
// actually write the page. Omitting the role would fall through to
// `currentRoleId`, which could be anything — including roles without
// wiki tooling — and silently produce useless sessions.
function requestCreatePage() {
  appApi.startNewChat(
    `Create a wiki page about ${JSON.stringify(title.value)}. Research the topic and write a comprehensive article in data/wiki/pages/.`,
    BUILTIN_ROLE_IDS.general,
  );
}

function requestUpdatePage() {
  appApi.startNewChat(
    `Update the existing wiki page about ${JSON.stringify(title.value)}. The page file exists but has no content. Research the topic and write a comprehensive article in data/wiki/pages/.`,
    BUILTIN_ROLE_IDS.general,
  );
}

function currentSlug(): string | null {
  // Prefer the URL on /wiki (source of truth for that route); fall
  // back to the tool-result payload when WikiView is mounted as a
  // manageWiki result inside /chat. `isSafeWikiSlug` guards against
  // traversal tokens — the router guard already strips these from
  // standalone /wiki URLs, but the tool-result payload arrives from
  // the server/agent and can't assume that upstream filter.
  const raw =
    route.name === PAGE_ROUTES.wiki && route.params.section === WIKI_ROUTE_SECTION.pages && typeof route.params.slug === "string"
      ? route.params.slug
      : (props.selectedResult?.data?.pageName ?? null);
  return isSafeWikiSlug(raw) ? raw : null;
}

// Serialised POST chain for rapid task-checkbox clicks (#775). Each
// click queues onto the previous so a slower network can't reorder
// writes. (The wire call is `POST /api/wiki { action: "save" }`, not
// PUT — the comment used to say PUT and contradicted the call site.)
//
// `saveQueueGeneration` invalidates older queued saves after a
// failure-triggered refresh: their captured snapshots were computed
// against the now-discarded optimistic state, so writing them would
// overwrite the canonical server content with stale data. We bump
// the generation on failure; queued saves whose generation no longer
// matches skip silently.
let taskPersistChain: Promise<unknown> = Promise.resolve();
let saveQueueGeneration = 0;

async function persistWikiPage(pageName: string, newContent: string, generation: number): Promise<void> {
  // Stale queued save (a previous save failed + refresh discarded
  // the optimistic state this snapshot was based on).
  if (generation !== saveQueueGeneration) return;
  // Bail if the page navigation has changed mid-flight — saving the
  // captured snapshot to a different page would clobber unrelated
  // state. The watchers on route / selectedResult already load the
  // new page; touching state here is wrong. `currentSlug()` returns
  // the right source for both the standalone /wiki view (route
  // params) and the tool-result-embedded view (selectedResult).
  if (currentSlug() !== pageName) return;

  const response = await apiPost<{ data?: { content?: string } }>(API_ROUTES.wiki.base, {
    action: WIKI_ACTION.save,
    pageName,
    content: newContent,
  });

  if (generation !== saveQueueGeneration) return;
  if (currentSlug() !== pageName) return;

  if (!response.ok) {
    navError.value = response.status === 0 ? response.error : `Wiki save failed (${response.status}): ${response.error}`;
    // Refresh resets local state to the canonical server content.
    // The generation bump must come AFTER refresh completes — clicks
    // arriving WHILE refresh is in flight capture the pre-bump
    // generation; bumping post-refresh invalidates them too. Bumping
    // pre-refresh would let those during-refresh clicks slip through
    // (they'd capture the new gen and persist a toggle computed
    // against the not-yet-reset DOM).
    await refresh();
    saveQueueGeneration += 1;
    return;
  }
  // Successful save — clear any stale error from a prior click.
  navError.value = null;
}

// Split the current content into the frontmatter prefix (delimiters
// + YAML) and the body marked actually renders. Reassembling
// `prefix + body` round-trips byte-for-byte regardless of
// frontmatter shape — the body length is always exact.
function splitFrontmatter(): { prefix: string; body: string } {
  const frontmatter = extractFrontmatter(content.value);
  const body = frontmatter.body;
  const prefix = content.value.slice(0, content.value.length - body.length);
  return { prefix, body };
}

// Compute the body-relative new content from a click. Returns null
// when the toggle should be refused (drift, navigation away,
// out-of-range index). The caller is responsible for reverting the
// visual state and surfacing any error.
function computeToggledContent(target: HTMLInputElement, root: HTMLElement): string | null {
  const taskInputs = root.querySelectorAll<HTMLInputElement>("input.md-task");
  const taskIndex = Array.from(taskInputs).indexOf(target);
  if (taskIndex < 0) return null;

  const { prefix, body } = splitFrontmatter();
  const sourceTasks = findTaskLines(body);
  if (sourceTasks.length !== taskInputs.length) {
    navError.value = t("pluginWiki.taskCountMismatch");
    return null;
  }
  const updatedBody = toggleTaskAt(body, taskIndex);
  if (updatedBody === null) return null;
  return prefix + updatedBody;
}

function onTaskCheckboxClick(event: MouseEvent, target: HTMLInputElement): void {
  // Only meaningful for the page view; everything else is read-only.
  if (action.value !== "page") {
    target.checked = !target.checked;
    return;
  }
  // `currentSlug()` covers both mount paths — standalone /wiki/<slug>
  // (route param) and tool-result-embedded WikiView (selectedResult).
  // The standalone path is the primary one; reading only from
  // selectedResult would silently no-op every click on /wiki/<slug>.
  const pageName = currentSlug();
  if (!pageName) {
    target.checked = !target.checked;
    return;
  }

  const root = event.currentTarget as HTMLElement;
  const newContent = computeToggledContent(target, root);
  if (newContent === null) {
    target.checked = !target.checked;
    return;
  }

  // Optimistic local update — re-render is driven by `content`'s
  // existing watcher.
  content.value = newContent;
  navError.value = null;

  // Capture the current generation so the queued save knows whether
  // the chain has been broken (by a prior failure) by the time it
  // runs. See `persistWikiPage` for the semantics.
  const generation = saveQueueGeneration;
  // `.catch` keeps the chain self-healing: if `persistWikiPage`
  // throws (e.g. its post-failure `refresh()` rejects with a network
  // error), an un-caught rejection would leave `taskPersistChain` in
  // a permanently-rejected state, and every subsequent click's
  // `.then()` would short-circuit silently — no more toggles ever
  // persist. Swallow the rejection here so the next click starts
  // from a fresh resolved chain. The error is already surfaced via
  // `navError` inside `persistWikiPage`'s `!response.ok` branch.
  taskPersistChain = taskPersistChain.then(() => persistWikiPage(pageName, newContent, generation)).catch(() => undefined);
}

function handleContentClick(event: MouseEvent) {
  // 0. GFM task checkbox toggle (#775). Tagged by `makeTasksInteractive`
  //    on the rendered HTML; only meaningful while we're showing a
  //    page body. Index / log / lint_report views never carry user
  //    content to write back.
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.type === "checkbox" && target.classList.contains("md-task")) {
    onTaskCheckboxClick(event, target);
    return;
  }
  // 1. Internal wiki links: `[[Page Name]]` was rewritten to a
  //    `<span class="wiki-link">` during markdown pre-processing,
  //    so it doesn't overlap with regular `<a>` handling.
  const link = target.closest(".wiki-link") as HTMLElement | null;
  if (link?.dataset.page) {
    navigatePage(link.dataset.page);
    return;
  }
  // 2. External http(s) links in the rendered markdown body: open
  //    in a new tab so clicking them doesn't navigate the whole
  //    SPA away from MulmoClaude. Same-origin and non-http links
  //    (mailto:, tel:, anchors) fall through to the browser default.
  if (handleExternalLinkClick(event)) return;
  // 3. Workspace-internal links: resolve relative paths against the
  //    wiki content's filesystem location and route to the appropriate view.
  //    Skip modifier-key clicks and middle clicks so the browser's
  //    "open in new tab" behaviour is preserved.
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const anchor = target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return;
  const resolved = resolveWikiHref(href, WIKI_BASE_DIR.value);
  if (classifyWorkspacePath(resolved)) {
    event.preventDefault();
    appApi.navigateToWorkspacePath(resolved);
  }
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
.wiki-content :deep(h1:first-child),
.wiki-content :deep(h2:first-child),
.wiki-content :deep(h3:first-child),
.wiki-content :deep(p:first-child) {
  margin-top: 0;
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
