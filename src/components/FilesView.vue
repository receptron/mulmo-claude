<template>
  <div class="h-full flex bg-white">
    <FileTreePane
      :root-node="rootNode"
      :ref-roots="refRoots"
      :children-by-path="childrenByPath"
      :tree-error="treeError"
      :selected-path="selectedPath"
      :recent-paths="recentPaths"
      :sort-mode="sortMode"
      @select="selectFile"
      @load-children="loadDirChildren"
      @update:sort-mode="setSortMode"
    />
    <!-- Content pane -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <FileContentHeader
        :selected-path="selectedPath"
        :size="content?.size ?? null"
        :modified-ms="content?.modifiedMs ?? null"
        :is-markdown="isMarkdown"
        :md-raw-mode="mdRawMode"
        @toggle-md-raw="toggleMdRaw"
        @deselect="deselectFile"
      />
      <FileContentRenderer
        :selected-path="selectedPath"
        :content="content"
        :content-error="contentError"
        :content-loading="contentLoading"
        :scheduler-result="schedulerResult"
        :todo-explorer-result="todoExplorerResult"
        :is-markdown="isMarkdown"
        :is-html="isHtml"
        :is-json="isJson"
        :is-jsonl="isJsonl"
        :md-raw-mode="mdRawMode"
        :sandboxed-html="sandboxedHtml"
        :json-tokens="jsonTokens"
        :jsonl-lines="jsonlLines"
        :md-frontmatter="mdFrontmatter"
        :raw-save-error="rawSaveError"
        @markdown-link-click="handleMarkdownLinkClick"
        @update-source="saveRawMarkdown"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import FileTreePane from "./FileTreePane.vue";
import FileContentHeader from "./FileContentHeader.vue";
import FileContentRenderer from "./FileContentRenderer.vue";
import { useFileTree } from "../composables/useFileTree";
import { useFileSelection, isValidFilePath, readPathMatch } from "../composables/useFileSelection";
import { useMarkdownMode } from "../composables/useMarkdownMode";
import { useFileSortMode } from "../composables/useFileSortMode";
import { useContentDisplay } from "../composables/useContentDisplay";
import { useMarkdownLinkHandler } from "../composables/useMarkdownLinkHandler";
import { apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { toSchedulerResult } from "../utils/filesPreview/schedulerPreview";
import { toTodoExplorerResult } from "../utils/filesPreview/todoPreview";

const RECENT_THRESHOLD_MS = 60 * 1000;

const route = useRoute();

const props = defineProps<{
  refreshToken?: number;
}>();

const emit = defineEmits<{
  // Emitted when the user clicks a markdown link whose target is
  // a chat session jsonl; App.vue should load that session into
  // the active chat view rather than opening the raw jsonl.
  loadSession: [sessionId: string];
}>();

const { rootNode, refRoots, childrenByPath, treeError, loadDirChildren, ensureAncestorsLoaded, reloadRoot, loadRefRoots } = useFileTree();

const { selectedPath, content, contentLoading, contentError, loadContent, selectFile, deselectFile, abortContent } = useFileSelection();

const { mdRawMode, toggleMdRaw } = useMarkdownMode();

const { sortMode, setSortMode } = useFileSortMode();

const { isMarkdown, isHtml, isJson, isJsonl, sandboxedHtml, jsonTokens, jsonlLines, mdFrontmatter } = useContentDisplay(selectedPath, content);

// Save-error banner shown above the Rendered-mode markdown editor.
// Cleared on every new file load and on the next successful save.
const rawSaveError = ref<string | null>(null);

async function saveRawMarkdown(newSource: string): Promise<void> {
  if (!selectedPath.value) return;
  if (content.value?.kind !== "text") return;
  if (newSource === content.value.content) return;
  // Snapshot the target path so a late response from a PUT for file A
  // can't overwrite `content.value` after the user has navigated to
  // file B. Server-side the save still completes — we only suppress
  // the stale UI update.
  const pathAtSave = selectedPath.value;
  rawSaveError.value = null;
  const result = await apiPut<{
    path: string;
    size: number;
    modifiedMs: number;
  }>(API_ROUTES.files.content, {
    path: pathAtSave,
    content: newSource,
  });
  if (selectedPath.value !== pathAtSave) return;
  if (!result.ok) {
    rawSaveError.value = result.error;
    return;
  }
  // Reflect the saved state locally — size/modifiedMs come from the
  // server's post-write stat, and `content` is what we just sent. Avoid
  // a round-trip GET since the server has already confirmed the write.
  content.value = {
    kind: "text",
    path: result.data.path,
    content: newSource,
    size: result.data.size,
    modifiedMs: result.data.modifiedMs,
  };
}

// Clear any stale save error whenever a new file is loaded.
watch(content, () => {
  rawSaveError.value = null;
});

const schedulerResult = computed(() => toSchedulerResult(selectedPath.value, content.value?.kind === "text" ? content.value.content : null));

const todoExplorerResult = computed(() => toTodoExplorerResult(selectedPath.value, content.value?.kind === "text" ? content.value.content : null));

const recentPaths = computed(() => {
  const set = new Set<string>();
  const now = Date.now();
  // Walk every loaded directory in the cache — lazy-loaded children
  // may not be rooted under the ref we start from, so iterating the
  // cache directly is both cheaper and more complete.
  for (const children of childrenByPath.value.values()) {
    if (!children) continue;
    for (const node of children) {
      if (node.type === "file" && node.modifiedMs && now - node.modifiedMs < RECENT_THRESHOLD_MS) {
        set.add(node.path);
      }
    }
  }
  return set;
});

// Uses click.capture so we intercept before TextResponseView's own
// handler (which only knows about absolute URLs) sees the event.
const { handleMarkdownLinkClick } = useMarkdownLinkHandler(selectedPath, {
  onNavigate: selectFile,
  onLoadSession: (sessionId) => emit("loadSession", sessionId),
});

// External URL changes (back/forward) → update selectedPath. Reading
// from `route.params.pathMatch` after the query→params migration;
// see plans/done/feat-files-path-url.md.
watch(
  () => readPathMatch(route.params.pathMatch),
  (newPath) => {
    if (!isValidFilePath(newPath)) {
      if (selectedPath.value !== null) {
        selectedPath.value = null;
        content.value = null;
      }
      return;
    }
    if (newPath !== selectedPath.value) {
      selectedPath.value = newPath;
      loadContent(newPath);
    }
  },
);

watch(
  () => props.refreshToken,
  () => {
    reloadRoot();
    if (selectedPath.value) loadContent(selectedPath.value);
  },
);

onMounted(async () => {
  await loadDirChildren("");
  await loadRefRoots();

  // Deep-link: if the URL has a selected path, reveal its ancestors
  // by fetching each dir in sequence so the tree auto-expands to
  // the selection.
  if (selectedPath.value) {
    await ensureAncestorsLoaded(selectedPath.value);
    loadContent(selectedPath.value);
  }
});

onUnmounted(() => {
  abortContent();
});
</script>
