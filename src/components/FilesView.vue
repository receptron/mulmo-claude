<template>
  <div class="h-full flex bg-white">
    <!-- Tree pane -->
    <div
      class="w-72 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-2 bg-gray-50"
    >
      <div v-if="treeError" class="p-2 text-xs text-red-600">
        {{ treeError }}
      </div>
      <div v-else-if="!tree" class="p-2 text-xs text-gray-400">Loading...</div>
      <FileTree
        v-else
        :node="tree"
        :selected-path="selectedPath"
        :recent-paths="recentPaths"
        @select="selectFile"
      />
    </div>
    <!-- Content pane -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div
        v-if="selectedPath"
        class="px-4 py-2 border-b border-gray-200 text-xs text-gray-500 font-mono shrink-0 flex items-center gap-2"
      >
        <span class="truncate min-w-0">{{ selectedPath }}</span>
        <span v-if="content" class="text-gray-400 shrink-0"
          >· {{ formatBytes(content.size) }}</span
        >
        <span v-if="content?.modifiedMs" class="text-gray-400 shrink-0"
          >· {{ formatTime(content.modifiedMs) }}</span
        >
        <button
          v-if="isMarkdown"
          class="ml-auto shrink-0 px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 font-sans"
          :title="mdRawMode ? 'Show rendered Markdown' : 'Show raw source'"
          @click="toggleMdRaw"
        >
          {{ mdRawMode ? "Rendered" : "Raw" }}
        </button>
      </div>
      <div class="flex-1 overflow-auto min-h-0">
        <div
          v-if="!selectedPath"
          class="h-full flex items-center justify-center text-gray-400 text-sm"
        >
          Select a file
        </div>
        <div v-else-if="contentError" class="p-4 text-sm text-red-600">
          {{ contentError }}
        </div>
        <div v-else-if="contentLoading" class="p-4 text-sm text-gray-400">
          Loading...
        </div>
        <template v-else-if="content">
          <template v-if="content.kind === 'text'">
            <!-- Scheduler items.json: render with the scheduler plugin's
                 calendar/list view by synthesizing a fake tool result. -->
            <div v-if="schedulerResult" class="h-full">
              <SchedulerView :selected-result="schedulerResult" />
            </div>
            <!-- Todos todos.json: full kanban / table / list explorer. -->
            <div v-else-if="todoExplorerResult" class="h-full">
              <TodoExplorer :selected-result="todoExplorerResult" />
            </div>
            <!-- Markdown rendered: frontmatter panel + body -->
            <div
              v-else-if="isMarkdown && !mdRawMode"
              class="h-full flex flex-col overflow-auto"
            >
              <div
                v-if="mdFrontmatter && mdFrontmatter.fields.length > 0"
                class="shrink-0 m-4 mb-0 rounded border border-gray-200 bg-gray-50 p-3 text-xs"
              >
                <div
                  v-for="field in mdFrontmatter.fields"
                  :key="field.key"
                  class="flex items-baseline gap-2 py-0.5"
                >
                  <span class="font-semibold text-gray-600 shrink-0"
                    >{{ field.key }}:</span
                  >
                  <template v-if="Array.isArray(field.value)">
                    <span class="flex flex-wrap gap-1">
                      <span
                        v-for="item in field.value"
                        :key="item"
                        class="rounded-full bg-white border border-gray-300 px-2 py-0.5 text-gray-700"
                      >
                        {{ item }}
                      </span>
                    </span>
                  </template>
                  <span v-else class="text-gray-800 break-words">{{
                    field.value
                  }}</span>
                </div>
              </div>
              <div
                class="flex-1 min-h-0"
                @click.capture="handleMarkdownLinkClick"
              >
                <TextResponseView
                  :selected-result="
                    markdownResult(
                      mdFrontmatter ? mdFrontmatter.body : content.content,
                    )
                  "
                />
              </div>
            </div>
            <!-- Markdown raw source (includes frontmatter) -->
            <pre
              v-else-if="isMarkdown && mdRawMode"
              class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800"
              >{{ content.content }}</pre
            >
            <!-- HTML: sandboxed iframe preview (scripts disabled) -->
            <iframe
              v-else-if="isHtml"
              :srcdoc="content.content"
              class="w-full h-full border-0"
              sandbox=""
              title="HTML preview"
            />
            <!-- JSON: pretty-printed with simple syntax coloring. Fall
                 back to raw content if the file is malformed. -->
            <pre
              v-else-if="isJson"
              class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800"
            ><span
              v-for="(tok, i) in jsonTokens"
              :key="i"
              :class="JSON_TOKEN_CLASS[tok.type]"
            >{{ tok.value }}</span></pre>
            <!-- JSONL / NDJSON: one pretty-printed + colored record per line -->
            <div v-else-if="isJsonl" class="p-4 space-y-2">
              <div
                v-for="(line, i) in jsonlLines"
                :key="i"
                class="rounded border bg-gray-50 p-3"
                :class="line.parseError ? 'border-red-300' : 'border-gray-200'"
              >
                <div
                  v-if="line.parseError"
                  class="text-xs text-red-600 mb-1 font-sans"
                >
                  parse error
                </div>
                <pre
                  class="text-xs font-mono text-gray-800 whitespace-pre-wrap"
                ><span
                  v-for="(tok, j) in line.tokens"
                  :key="j"
                  :class="JSON_TOKEN_CLASS[tok.type]"
                >{{ tok.value }}</span></pre>
              </div>
            </div>
            <!-- Plain text fallback -->
            <pre
              v-else
              class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800"
              >{{ content.content }}</pre
            >
          </template>
          <!-- Image -->
          <div
            v-else-if="content.kind === 'image'"
            class="h-full flex items-center justify-center p-4"
          >
            <img
              :src="rawUrl(selectedPath)"
              :alt="selectedPath"
              class="max-w-full max-h-full object-contain"
            />
          </div>
          <!-- PDF -->
          <iframe
            v-else-if="content.kind === 'pdf'"
            :src="rawUrl(selectedPath)"
            class="w-full h-full border-0"
            title="PDF preview"
          />
          <!-- Audio -->
          <div
            v-else-if="content.kind === 'audio'"
            class="h-full flex items-center justify-center p-4"
          >
            <audio
              :key="selectedPath"
              :src="rawUrl(selectedPath)"
              controls
              preload="metadata"
              class="w-full max-w-2xl"
            />
          </div>
          <!-- Video -->
          <div
            v-else-if="content.kind === 'video'"
            class="h-full flex items-center justify-center p-4 bg-black"
          >
            <video
              :key="selectedPath"
              :src="rawUrl(selectedPath)"
              controls
              preload="metadata"
              class="max-w-full max-h-full"
            />
          </div>
          <!-- Binary or too-large -->
          <div v-else class="p-4 text-sm text-gray-500">
            {{ content.message }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import FileTree, { type TreeNode } from "./FileTree.vue";
import TextResponseView from "../plugins/textResponse/View.vue";
import SchedulerView from "../plugins/scheduler/View.vue";
import TodoExplorer from "./TodoExplorer.vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "@gui-chat-plugin/text-response";
import type { SchedulerData, ScheduledItem } from "../plugins/scheduler/index";
import type { StatusColumn, TodoData, TodoItem } from "../plugins/todo/index";
import {
  tokenizeJson,
  tokenizeJsonl,
  prettyJson,
  JSON_TOKEN_CLASS,
} from "../utils/format/jsonSyntax";
import { extractFrontmatter } from "../utils/format/frontmatter";
import {
  isExternalHref,
  resolveWorkspaceLink,
  extractSessionIdFromPath,
} from "../utils/path/relativeLink";

const MD_RAW_STORAGE_KEY = "files_md_raw_mode";
const RECENT_THRESHOLD_MS = 60 * 1000;

const route = useRoute();
const router = useRouter();

// Validate a file path from the URL: reject traversal attempts and
// obviously invalid values. We don't check existence here — a 404 is
// handled gracefully by the content loader.
function isValidFilePath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.includes("..")) return false;
  if (p.startsWith("/")) return false;
  return true;
}

interface TextContent {
  kind: "text";
  path: string;
  content: string;
  size: number;
  modifiedMs: number;
}

interface MetaContent {
  kind: "image" | "pdf" | "audio" | "video" | "binary" | "too-large";
  path: string;
  size: number;
  modifiedMs: number;
  message?: string;
}

type FileContent = TextContent | MetaContent;

const props = defineProps<{
  refreshToken?: number;
}>();

const emit = defineEmits<{
  // Emitted when the user clicks a markdown link whose target is
  // a chat session jsonl; App.vue should load that session into
  // the active chat view rather than opening the raw jsonl.
  loadSession: [sessionId: string];
}>();

const tree = ref<TreeNode | null>(null);
const treeError = ref<string | null>(null);

// Seed selectedPath from URL query ?path=, falling back to
// localStorage. Same bidirectional-sync pattern as sessionId
// and canvasViewMode: ref is the source of truth for reads,
// router.push keeps the URL in sync, watcher handles external
// URL changes (back/forward).
const urlPath = route.query.path;
const selectedPath = ref<string | null>(
  isValidFilePath(urlPath) ? urlPath : null,
);

const content = ref<FileContent | null>(null);
const contentLoading = ref(false);
const contentError = ref<string | null>(null);

function hasExt(filePath: string | null, exts: string[]): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

const isMarkdown = computed(() =>
  hasExt(selectedPath.value, [".md", ".markdown"]),
);

const mdRawMode = ref(localStorage.getItem(MD_RAW_STORAGE_KEY) === "true");

function toggleMdRaw(): void {
  mdRawMode.value = !mdRawMode.value;
  localStorage.setItem(MD_RAW_STORAGE_KEY, String(mdRawMode.value));
}
const isHtml = computed(() => hasExt(selectedPath.value, [".html", ".htm"]));
const isJson = computed(() => hasExt(selectedPath.value, [".json"]));
const isJsonl = computed(() =>
  hasExt(selectedPath.value, [".jsonl", ".ndjson"]),
);

const jsonTokens = computed(() => {
  if (!content.value || content.value.kind !== "text") return [];
  return tokenizeJson(prettyJson(content.value.content));
});

const jsonlLines = computed(() => {
  if (!content.value || content.value.kind !== "text") return [];
  return tokenizeJsonl(content.value.content);
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

// When the user opens scheduler/items.json, render it with the
// scheduler plugin's calendar view instead of as a JSON blob. We
// synthesize a fake ToolResultComplete<SchedulerData> so the View
// component receives the same shape it normally gets in chat mode.
const schedulerResult = computed(
  (): ToolResultComplete<SchedulerData> | null => {
    if (selectedPath.value !== "scheduler/items.json") return null;
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
      message: "scheduler/items.json",
      title: "Scheduler",
      data: { items: parsed },
    };
  },
);

// Same idea as schedulerResult: when the user opens todos/todos.json
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
  if (selectedPath.value !== "todos/todos.json") return null;
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
    message: "todos/todos.json",
    title: "Todo",
    data: { items, columns },
  };
});

const mdFrontmatter = computed(() => {
  if (!content.value || content.value.kind !== "text") return null;
  if (!isMarkdown.value) return null;
  return extractFrontmatter(content.value.content);
});

function markdownResult(text: string): ToolResultComplete<TextResponseData> {
  return {
    uuid: "files-preview",
    toolName: "text-response",
    message: text,
    title: selectedPath.value ?? "",
    // role: "user" hides the PDF download button in TextResponseView
    data: { text, role: "user", transportKind: "text-rest" },
  };
}

const recentPaths = computed(() => {
  const set = new Set<string>();
  const now = Date.now();
  function visit(node: TreeNode) {
    if (
      node.type === "file" &&
      node.modifiedMs &&
      now - node.modifiedMs < RECENT_THRESHOLD_MS
    ) {
      set.add(node.path);
    }
    if (node.children) node.children.forEach(visit);
  }
  if (tree.value) visit(tree.value);
  return set;
});

function rawUrl(filePath: string): string {
  return `/api/files/raw?path=${encodeURIComponent(filePath)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadTree(): Promise<void> {
  treeError.value = null;
  try {
    const res = await fetch("/api/files/tree");
    if (!res.ok) throw new Error(`tree: ${res.status}`);
    tree.value = await res.json();
  } catch (err) {
    treeError.value = err instanceof Error ? err.message : String(err);
  }
}

// Tracks the currently in-flight content fetch so a stale response from
// a previously-clicked file can't overwrite the latest selection.
let contentAbort: AbortController | null = null;

async function loadContent(filePath: string): Promise<void> {
  contentAbort?.abort();
  const controller = new AbortController();
  contentAbort = controller;

  contentLoading.value = true;
  contentError.value = null;
  content.value = null;
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(filePath)}`,
      { signal: controller.signal },
    );
    if (controller.signal.aborted) return;
    if (!res.ok) {
      const errBody: { error?: string } = await res.json().catch(() => ({}));
      throw new Error(errBody.error ?? `HTTP ${res.status}`);
    }
    const body: FileContent = await res.json();
    if (controller.signal.aborted) return;
    content.value = body;
  } catch (err) {
    if (controller.signal.aborted) return;
    if (err instanceof DOMException && err.name === "AbortError") return;
    contentError.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (contentAbort === controller) {
      contentLoading.value = false;
      contentAbort = null;
    }
  }
}

function selectFile(filePath: string): void {
  selectedPath.value = filePath;
  loadContent(filePath);
  // Push file path into the URL so it's bookmarkable / back-navigable.
  const { path: __path, ...restQuery } = route.query;
  router
    .push({ query: { ...restQuery, path: filePath } })
    .catch((err: unknown) => {
      if (!isNavigationFailure(err)) {
        console.error("[selectFile] navigation failed:", err);
      }
    });
}

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
    loadTree();
    if (selectedPath.value) loadContent(selectedPath.value);
  },
);

onMounted(async () => {
  await loadTree();
  // If the URL already has a ?path=, load that file. Otherwise
  // leave file-unselected (the "Select a file" placeholder shows).
  if (selectedPath.value) {
    loadContent(selectedPath.value);
  }
});

onUnmounted(() => {
  contentAbort?.abort();
});
</script>
