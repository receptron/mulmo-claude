<template>
  <div class="h-full flex bg-white">
    <FileTreePane
      :root-node="rootNode"
      :ref-roots="refRoots"
      :children-by-path="childrenByPath"
      :tree-error="treeError"
      :selected-path="selectedPath"
      :recent-paths="recentPaths"
      @select="selectFile"
      @load-children="loadDirChildren"
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
import {
  useFileSelection,
  isValidFilePath,
} from "../composables/useFileSelection";
import { useMarkdownMode } from "../composables/useMarkdownMode";
import { useContentDisplay } from "../composables/useContentDisplay";
import { apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { WORKSPACE_FILES } from "../config/workspacePaths";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SchedulerData, ScheduledItem } from "../plugins/scheduler/index";
import type { StatusColumn, TodoData, TodoItem } from "../plugins/todo/index";
import {
  isExternalHref,
  resolveWorkspaceLink,
  extractSessionIdFromPath,
} from "../utils/path/relativeLink";

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

const {
  rootNode,
  refRoots,
  childrenByPath,
  treeError,
  loadDirChildren,
  ensureAncestorsLoaded,
  reloadRoot,
  loadRefRoots,
} = useFileTree();

const {
  selectedPath,
  content,
  contentLoading,
  contentError,
  loadContent,
  selectFile,
  deselectFile,
  abortContent,
} = useFileSelection();

const { mdRawMode, toggleMdRaw } = useMarkdownMode();

const {
  isMarkdown,
  isHtml,
  isJson,
  isJsonl,
  sandboxedHtml,
  jsonTokens,
  jsonlLines,
  mdFrontmatter,
} = useContentDisplay(selectedPath, content);

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

function isScheduledItem(x: unknown): x is ScheduledItem {
  if (typeof x !== "object" || x === null) return false;
  if (!("id" in x) || typeof x.id !== "string") return false;
  if (!("title" in x) || typeof x.title !== "string") return false;
  return true;
}

function isScheduledItemArray(x: unknown): x is ScheduledItem[] {
  return Array.isArray(x) && x.every(isScheduledItem);
}

// When the user opens the scheduler items file, render it with the
// scheduler plugin's calendar view instead of as a JSON blob. We
// synthesize a fake ToolResultComplete<SchedulerData> so the View
// component receives the same shape it normally gets in chat mode.
const schedulerResult = computed(
  (): ToolResultComplete<SchedulerData> | null => {
    if (selectedPath.value !== WORKSPACE_FILES.schedulerItems) return null;
    if (!content.value || content.value.kind !== "text") return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.value.content);
    } catch {
      return null;
    }
    if (!isScheduledItemArray(parsed)) return null;
    return {
      uuid: "files-scheduler-preview",
      toolName: "manageScheduler",
      message: WORKSPACE_FILES.schedulerItems,
      title: "Scheduler",
      data: { items: parsed },
    };
  },
);

// Same idea as schedulerResult: when the user opens the todos file
// we render it as a full TodoExplorer (kanban / table / list) instead
// of a raw JSON blob. The TodoExplorer fetches its own state from
// /api/todos so the data we synthesize here is just a starter — the
// columns array might be empty until the first refresh lands.
function isTodoItem(x: unknown): x is TodoItem {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o["id"] !== "string" || typeof o["text"] !== "string")
    return false;
  if (typeof o["completed"] !== "boolean") return false;
  if (typeof o["createdAt"] !== "number") return false;
  return true;
}

function isTodoItemArray(x: unknown): x is TodoItem[] {
  return Array.isArray(x) && x.every(isTodoItem);
}

const todoExplorerResult = computed((): ToolResultComplete<TodoData> | null => {
  if (selectedPath.value !== WORKSPACE_FILES.todosItems) return null;
  if (!content.value || content.value.kind !== "text") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.value.content);
  } catch {
    return null;
  }
  const items: TodoItem[] = isTodoItemArray(parsed) ? parsed : [];
  const columns: StatusColumn[] = [];
  return {
    uuid: "files-todo-preview",
    toolName: "manageTodoList",
    message: WORKSPACE_FILES.todosItems,
    title: "Todo",
    data: { items, columns },
  };
});

const recentPaths = computed(() => {
  const set = new Set<string>();
  const now = Date.now();
  // Walk every loaded directory in the cache — lazy-loaded children
  // may not be rooted under the ref we start from, so iterating the
  // cache directly is both cheaper and more complete.
  for (const children of childrenByPath.value.values()) {
    if (!children) continue;
    for (const node of children) {
      if (
        node.type === "file" &&
        node.modifiedMs &&
        now - node.modifiedMs < RECENT_THRESHOLD_MS
      ) {
        set.add(node.path);
      }
    }
  }
  return set;
});

// When the user clicks an <a> inside a rendered markdown body, check
// if it's a workspace-internal relative/absolute link. If so, resolve
// it against the current file and navigate inside FilesView instead
// of letting the browser follow the (meaningless) relative href.
//
// Uses click.capture so we intercept before TextResponseView's own
// handler (which only knows about absolute URLs) sees the event.
function handleMarkdownLinkClick(event: MouseEvent): void {
  if (event.button !== 0) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const anchor = target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href) return;
  // External URLs and mailto/tel: let TextResponseView's existing
  // handler open them in a new tab.
  if (isExternalHref(href)) return;
  // Anchor-only (#section): let the browser handle in-page scroll.
  if (href.startsWith("#")) return;
  if (!selectedPath.value) return;
  const resolved = resolveWorkspaceLink(selectedPath.value, href);
  if (!resolved) return;
  event.preventDefault();
  event.stopPropagation();
  // Chat session link: hand off to App.vue so the sidebar chat
  // switches to that session instead of opening the raw jsonl
  // as a file. Direct clicks in the file tree still open the
  // jsonl in raw view — only markdown link clicks route here.
  const sessionId = extractSessionIdFromPath(resolved);
  if (sessionId !== null) {
    emit("loadSession", sessionId);
    return;
  }
  selectFile(resolved);
}

// External URL changes (back/forward) → update selectedPath.
watch(
  () => route.query.path,
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
