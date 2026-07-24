<template>
  <div class="h-full flex bg-white" data-testid="files-view-root">
    <FileTreePane
      ref="treePaneRef"
      :root-node="rootNode"
      :ref-roots="refRoots"
      :children-by-path="childrenByPath"
      :tree-error="treeError"
      :selected-path="selectedPath"
      :recent-paths="recentPaths"
      :sort-mode="sortMode"
      :show-hidden-system="showHiddenSystem"
      @select="selectFile"
      @load-children="loadDirChildren"
      @update:sort-mode="setSortMode"
      @update:show-hidden-system="setShowHiddenSystem"
      @create-file="handleCreateFile"
      @upload-files="handleUploadFiles"
    />
    <!-- Drop-upload progress / failure banner (#2270). Fixed so it
         stays visible while the tree scrolls under it. -->
    <div
      v-if="uploadStatus"
      class="fixed bottom-4 left-4 z-50 px-3 py-2 rounded shadow-md text-sm"
      :class="uploadStatus.failed ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'"
      data-testid="file-upload-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ uploadStatus.message }}
    </div>
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
        :is-markdown="isMarkdown"
        :is-html="isHtml"
        :is-json="isJson"
        :is-jsonl="isJsonl"
        :md-raw-mode="mdRawMode"
        :sandboxed-html="sandboxedHtml"
        :html-preview-url="htmlPreviewUrl"
        :json-tokens="jsonTokens"
        :jsonl-lines="jsonlLines"
        :md-frontmatter="mdFrontmatter"
        :raw-save-error="rawSaveError"
        @markdown-link-click="handleMarkdownLinkClick"
        @update-source="saveRawMarkdown"
      />
      <!-- Per-file chat composer: spawns a fresh chat with a
           "take a look at this file first" instruction prepended.
           Mirrors the wiki per-page composer (see plugins/wiki/View.vue).
           No roleId is passed, so the new chat inherits the user's
           current role. -->
      <PageChatComposer
        v-if="selectedPath && !contentLoading && !contentError"
        :key="selectedPath"
        :placeholder="t('filesView.chatPlaceholder')"
        :prepend-text="`Before answering, take a look at the file at ${selectedPath}.`"
        test-id-prefix="files-page-chat"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import FileTreePane from "./FileTreePane.vue";
import FileContentHeader from "./FileContentHeader.vue";
import FileContentRenderer from "./FileContentRenderer.vue";
import PageChatComposer from "./PageChatComposer.vue";
import { useFileTree } from "../composables/useFileTree";
import { useFileSelection, isValidFilePath, readPathMatch } from "../composables/useFileSelection";
import { useMarkdownMode } from "../composables/useMarkdownMode";
import { useFileSortMode } from "../composables/useFileSortMode";
import { useShowHiddenSystemFiles } from "../composables/useShowHiddenSystemFiles";
import { useContentDisplay } from "../composables/useContentDisplay";
import { useMarkdownLinkHandler } from "../composables/useMarkdownLinkHandler";
import { apiPost, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const RECENT_THRESHOLD_MS = 60 * 1000;

const route = useRoute();
const { t } = useI18n();

const props = defineProps<{
  refreshToken?: number;
}>();

const emit = defineEmits<{
  // Emitted when the user clicks a markdown link whose target is
  // a chat session jsonl; App.vue should load that session into
  // the active chat view rather than opening the raw jsonl.
  loadSession: [sessionId: string];
}>();

const { rootNode, refRoots, childrenByPath, treeError, loadDirChildren, ensureAncestorsLoaded, reloadDirChildren, reloadRoot, loadRefRoots } = useFileTree();

const { selectedPath, content, contentLoading, contentError, loadContent, selectFile, deselectFile, abortContent } = useFileSelection();

const { mdRawMode, toggleMdRaw } = useMarkdownMode();

const { sortMode, setSortMode } = useFileSortMode();
const { showHiddenSystem, setShowHiddenSystem } = useShowHiddenSystemFiles();

const { isMarkdown, isHtml, isJson, isJsonl, sandboxedHtml, htmlPreviewUrl, jsonTokens, jsonlLines, mdFrontmatter } = useContentDisplay(selectedPath, content);

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

// #1598 — folder-row context menu → "New file" inline flow. The
// FileTree component handles input + slug validation; here we
// only do the conflict check + PUT + refresh. The callback shape
// lets the inline input close itself on success and stay open
// (with the error label) on failure.
async function handleCreateFile(args: { folder: string; filename: string; resolve: (ok: boolean, error?: string) => void }): Promise<void> {
  const { folder, filename, resolve } = args;
  const targetPath = folder ? `${folder}/${filename}` : filename;
  // Client-side conflict pre-check via the local cache — cheap and
  // matches what the user sees. The server's create endpoint also
  // refuses on conflict (#1598), so a tab racing with another that
  // already won would still get a 409 below — this just turns the
  // common case into a localised inline error without a round-trip.
  const cached = childrenByPath.value.get(folder);
  if (Array.isArray(cached) && cached.some((child) => child.name === filename)) {
    resolve(false, t("fileTree.newFileError.exists", { filename }));
    return;
  }
  const result = await apiPost<{ path: string; size: number; modifiedMs: number }>(API_ROUTES.files.create, {
    path: targetPath,
    content: "",
  });
  if (!result.ok) {
    // Map HTTP status to a localised message so the inline error
    // matches the rest of the menu's language. 409 = a race lost
    // to another tab/agent that just created the same file.
    if (result.status === 409) {
      resolve(false, t("fileTree.newFileError.exists", { filename }));
      await reloadDirChildren(folder);
      return;
    }
    resolve(false, t("fileTree.newFileError.saveFailed"));
    return;
  }
  resolve(true);
  await reloadDirChildren(folder);
  // Reveal the new file in the right-hand content pane so the user
  // can start editing immediately. selectFile() also drives the URL
  // bar + ancestor expansion via the existing watcher.
  selectFile(result.data.path);
}

// --- Drop-to-upload (#2270) ---------------------------------------------

/** How long the "done"/"failed" banner lingers before clearing itself. */
const UPLOAD_STATUS_CLEAR_MS = 4000;

interface UploadState {
  done: number;
  total: number;
  failed: number;
}

const uploadState = ref<UploadState | null>(null);
let uploadClearTimer: ReturnType<typeof setTimeout> | null = null;

const uploadStatus = computed<{ failed: boolean; message: string } | null>(() => {
  const state = uploadState.value;
  if (state === null) return null;
  if (state.done < state.total) return { failed: false, message: t("fileTree.upload.progress", { done: state.done, total: state.total }) };
  if (state.failed > 0) return { failed: true, message: t("fileTree.upload.failed", { count: state.failed }) };
  return { failed: false, message: t("fileTree.upload.done", { count: state.total }) };
});

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file read failed"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

async function uploadOne(folder: string, file: File): Promise<boolean> {
  try {
    const dataUrl = await readAsDataUrl(file);
    if (dataUrl === "") return false;
    const result = await apiPost<{ path: string }>(API_ROUTES.files.upload, { dir: folder, filename: file.name, dataUrl });
    return result.ok;
  } catch {
    return false;
  }
}

// Sequential on purpose: the banner reports "n of m", and a folder full of
// large drops shouldn't open one request per file at once.
async function handleUploadFiles(args: { folder: string; files: File[] }): Promise<void> {
  const { folder, files } = args;
  if (uploadClearTimer !== null) {
    clearTimeout(uploadClearTimer);
    uploadClearTimer = null;
  }
  // Fold this batch into any still-running one. Overwriting instead would let
  // a second drop reset the counters, and the first batch's clear-timer could
  // then null the state mid-flight — making the second batch abandon its
  // remaining files silently.
  const started: UploadState | null = uploadState.value;
  uploadState.value =
    started === null ? { done: 0, total: files.length, failed: 0 } : { done: started.done, total: started.total + files.length, failed: started.failed };

  for (const file of files) {
    const ok = await uploadOne(folder, file);
    const current: UploadState | null = uploadState.value;
    // Re-seed rather than bail if something cleared the banner underneath us.
    uploadState.value =
      current === null
        ? { done: 1, total: files.length, failed: ok ? 0 : 1 }
        : { done: current.done + 1, total: current.total, failed: current.failed + (ok ? 0 : 1) };
  }
  await reloadDirChildren(folder);

  // Only retire the banner once every in-flight batch has landed.
  const settled: UploadState | null = uploadState.value;
  if (settled !== null && settled.done >= settled.total) {
    uploadClearTimer = setTimeout(() => {
      uploadState.value = null;
    }, UPLOAD_STATUS_CLEAR_MS);
  }
}

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

// Keep the tree expanded down to the active selection regardless of
// how the selection changed (URL bar, back/forward, selectFile from a
// markdown link). selectFile() updates selectedPath synchronously
// before pushing the route, so a guard on the route watcher would
// miss in-app file→file navigation — we watch the source of truth
// directly. `immediate: true` covers the deep-link mount case, so
// onMounted doesn't need its own ensureAncestorsLoaded call.
// Idempotent: loadDirChildren and expand() both short-circuit when
// the cache/expand-state already has the ancestor.
watch(
  selectedPath,
  (newPath) => {
    if (newPath) ensureAncestorsLoaded(newPath);
  },
  { immediate: true },
);

// Reveal the selected file row in the tree pane. The tree grows
// incrementally on deep-link mount: ensureAncestorsLoaded fetches the
// direct ancestors, but sibling dirs whose `expanded` state was
// restored from localStorage lazy-load their children later via each
// FileTree's own watcher. Each of those loads pushes the selected
// row further down, so scrollIntoView must re-run whenever the tree
// grows, not just once on selection change. A pending-rAF guard
// coalesces a burst of childrenByPath updates into a single scroll.
// Scope the query to the FileTreePane's root via a template ref so
// it survives data-testid / DOM-structure changes elsewhere in
// FilesView.
const treePaneRef = ref<InstanceType<typeof FileTreePane> | null>(null);
let pendingRevealRaf = 0;
function revealSelectedInTree(): void {
  if (!selectedPath.value) return;
  if (pendingRevealRaf !== 0) return;
  pendingRevealRaf = requestAnimationFrame(() => {
    pendingRevealRaf = 0;
    const paneRoot = treePaneRef.value?.$el as HTMLElement | undefined;
    const button = paneRoot?.querySelector<HTMLElement>('button[data-selected="true"]');
    button?.scrollIntoView({ block: "nearest" });
  });
}

watch(selectedPath, revealSelectedInTree);
watch(childrenByPath, revealSelectedInTree);

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

  // Deep-link content load. The ancestor expansion + scroll reveal are
  // handled by the selectedPath watchers above (the ensureAncestorsLoaded
  // watcher runs with immediate: true).
  if (selectedPath.value) loadContent(selectedPath.value);
});

onUnmounted(() => {
  abortContent();
  if (pendingRevealRaf !== 0) cancelAnimationFrame(pendingRevealRaf);
});
</script>
