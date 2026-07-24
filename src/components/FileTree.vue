<template>
  <div>
    <button
      v-if="node.type === 'dir'"
      class="w-full flex items-center gap-1 px-2 py-1 text-left text-sm rounded transition-colors"
      :class="isDropTarget ? 'bg-blue-100 ring-1 ring-blue-400' : 'hover:bg-gray-100'"
      :data-testid="`file-tree-dir-${node.name || 'root'}`"
      :data-drop-target="isDropTarget ? 'true' : undefined"
      :title="allowUpload ? t('fileTree.dropHint') : undefined"
      @click="onToggle"
      @contextmenu="onFolderContextMenu"
      @dragenter="onDropEnter"
      @dragover="onDropOver"
      @dragleave="onDropLeave"
      @drop="onDropFiles"
    >
      <span class="material-icons text-sm text-gray-400 shrink-0">{{ expanded ? "folder_open" : "folder" }}</span>
      <span class="text-gray-700 truncate">{{ node.name || t("fileTree.workspace") }}</span>
    </button>
    <button
      v-else
      class="w-full flex items-center gap-1 px-2 py-1 text-left text-sm rounded transition-colors"
      :class="selectedPath === node.path ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'"
      :data-testid="`file-tree-file-${node.name}`"
      :data-selected="selectedPath === node.path ? 'true' : undefined"
      :title="node.path"
      @click="emit('select', node.path)"
    >
      <span class="material-icons text-sm shrink-0" :class="iconColorClass">{{ fileIcon }}</span>
      <span class="truncate">{{ node.name }}</span>
      <span v-if="isRecent" class="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" :title="t('fileTree.recentlyChanged')" />
    </button>
    <div v-if="node.type === 'dir' && expanded" class="pl-4">
      <!-- New-file inline input (#1598). Shown when the user picked
           "New file" from the folder's context menu. Mounted as the
           first child so the new entry sits where the user expects
           it (top of the folder). Esc / blur close; Enter submits. -->
      <div v-if="createPending" class="flex items-center gap-1 px-2 py-1 text-sm" :data-testid="`file-tree-new-file-input-${node.name || 'root'}`">
        <span class="material-icons text-sm text-gray-400 shrink-0">description</span>
        <input
          ref="newFileInputRef"
          v-model="newFileSlug"
          type="text"
          class="flex-1 min-w-0 px-1 py-0.5 text-sm border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          :placeholder="placeholderText"
          :aria-label="t('fileTree.newFileInputAria')"
          data-testid="file-tree-new-file-input"
          @keydown="onInputKeydown"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @blur="onInputBlur"
        />
        <span class="text-xs text-gray-400 font-mono shrink-0 select-none">{{ createPolicy?.extension }}</span>
      </div>
      <div v-if="createError" class="px-2 py-1 text-xs text-red-600" data-testid="file-tree-new-file-error">{{ createError }}</div>
      <!-- Loading state: children not in the cache yet. Rendered
           once per dir so a slow network shows where the wait is,
           not as a global overlay. -->
      <div v-if="loadingChildren" class="px-2 py-1 text-xs text-gray-400">{{ t("common.loading") }}</div>
      <FileTree
        v-for="child in visibleChildren"
        :key="child.path"
        :node="child"
        :selected-path="selectedPath"
        :recent-paths="recentPaths"
        :children-by-path="childrenByPath"
        :sort-mode="sortMode"
        :show-hidden-system="showHiddenSystem"
        :allow-upload="allowUpload"
        @select="(p) => emit('select', p)"
        @load-children="(p) => emit('loadChildren', p)"
        @create-file="(args) => emit('createFile', args)"
        @upload-files="(args) => emit('uploadFiles', args)"
      />
    </div>
    <!-- Floating context menu (#1598). Position-fixed near the
         click point so it floats above the tree row regardless of
         the scrollable pane. One-shot; clicking the option starts
         the inline input flow above. -->
    <Teleport to="body">
      <div
        v-if="menuOpen"
        class="fixed z-50 min-w-32 bg-white border border-gray-200 rounded shadow-md py-1 text-sm"
        :style="{ top: `${menuY}px`, left: `${menuX}px` }"
        data-testid="file-tree-context-menu"
        @click.stop
      >
        <button
          type="button"
          class="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2"
          data-testid="file-tree-context-new-file"
          @click="onContextNewFile"
        >
          <span class="material-icons text-sm text-gray-400">note_add</span>
          {{ t("fileTree.newFileMenuItem") }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useExpandedDirs } from "../composables/useExpandedDirs";
import { useDragSessionEnd } from "../composables/useFileDropZone";
import { sortChildren } from "../utils/files/sortChildren";
import { descriptorForPath, EDIT_POLICY_ICON_COLOR } from "../config/systemFileDescriptors";
import { isVisibleTopLevel } from "../config/visibleWorkspaceDirs";
import { normaliseNewFileSlug, policyForFolder } from "../config/createFilePolicy";
import type { FileSortMode } from "../composables/useFileSortMode";
import type { TreeNode } from "../types/fileTree";

const DEFAULT_FILE_ICON_COLOR = "text-gray-400";

const { t } = useI18n();

// TreeNode lives in src/types/fileTree.ts so .ts composables can
// import it without depending on a .vue module. Re-export here so
// existing `import { TreeNode } from "./FileTree.vue"` keeps working.
export type { TreeNode } from "../types/fileTree";

const props = defineProps<{
  node: TreeNode;
  selectedPath: string | null;
  recentPaths: Set<string>;
  // Lazy-expand cache managed by the parent (FilesView). `undefined`
  // entry (not in the map) = not loaded yet → we emit `loadChildren`
  // so the parent kicks off the fetch. `null` = load in flight →
  // show spinner. Array = loaded.
  childrenByPath: Map<string, TreeNode[] | null>;
  sortMode: FileSortMode;
  // When false, top-level "system" dirs (`conversations/`, `feeds/`,
  // `.git/`, ad-hoc automation buckets) are filtered out — only
  // recognised user-content buckets (data / artifacts / config) stay
  // visible at the workspace root. Filter only fires when this
  // component IS the root (`node.path === ""`); nested instances
  // still receive the prop so the recursion carries it, but they
  // don't apply the filter themselves.
  showHiddenSystem: boolean;
  // Reference roots are read-only mounts, so they opt out of the
  // drop affordance entirely rather than offering a target that the
  // server would refuse (#2270).
  allowUpload: boolean;
}>();

const emit = defineEmits<{
  select: [path: string];
  loadChildren: [path: string];
  // Files dropped onto this folder row. Bubbled up to FilesView, which
  // performs the uploads and refreshes the folder — same shape of
  // hand-off as `createFile` below.
  uploadFiles: [args: { folder: string; files: File[] }];
  // Bubbled up to FilesView, which performs the PUT and refreshes
  // the tree. Per-instance FileTree state is reset by the parent
  // setting `childrenByPath` for this folder; the inline input here
  // closes itself when its commit resolves.
  createFile: [args: { folder: string; filename: string; resolve: (ok: boolean, error?: string) => void }];
}>();

// Expand/collapse state lives in a module-level singleton so every
// recursive FileTree instance shares it, and survives remounts (e.g.
// the agent-run refresh that bumps filesRefreshToken in FilesView).
// Default on first run: only the workspace root ("") is expanded.
const { isExpanded, toggle, expand } = useExpandedDirs();
const expanded = computed(() => isExpanded(props.node.path));

const cached = computed(() => props.childrenByPath.get(props.node.path));
// `cached === null` = load in flight. `undefined` = never requested.
// Array = loaded.
const loadingChildren = computed(() => cached.value === null);
const loadedChildren = computed(() => (Array.isArray(cached.value) ? sortChildren(cached.value, props.sortMode) : []));

// Root-only filter: hide non-whitelisted top-level dirs unless the
// user has toggled "show system files" on. Any depth other than
// the workspace root is a pass-through.
const isWorkspaceRoot = computed(() => props.node.path === "");
const visibleChildren = computed(() => {
  if (!isWorkspaceRoot.value) return loadedChildren.value;
  if (props.showHiddenSystem) return loadedChildren.value;
  return loadedChildren.value.filter((child) => child.type === "dir" && isVisibleTopLevel(child.name));
});

// Kick off a fetch if the dir is expanded but its children haven't
// been requested yet. Covers two scenarios:
//   1. User just toggled open → onToggle already emits, but watching
//      here makes the flow idempotent when the parent re-mounts the
//      component with expand state restored from localStorage.
//   2. Deep link: FilesView calls `expand(ancestor)` before children
//      arrive; this watcher catches that case too.
watch(
  [expanded, cached],
  ([isOpen, current]) => {
    if (!isOpen) return;
    if (props.node.type !== "dir") return;
    if (current !== undefined) return;
    emit("loadChildren", props.node.path);
  },
  { immediate: true },
);

function onToggle(): void {
  toggle(props.node.path);
  // When newly-opened, request children if cache miss. The watcher
  // above covers the reactive path but we also fire here so the
  // request is visibly tied to the click for network inspection.
  if (!isExpanded(props.node.path)) return;
  if (cached.value !== undefined) return;
  emit("loadChildren", props.node.path);
}

// --- Drop target (#2270) -------------------------------------------------
// Deliberately hand-rolled instead of `useFileDropZone`: that composable
// installs window listeners in `onMounted`, and this component is recursive
// (one instance per node), so a tree of 300 nodes would install 300 of them.
// The pane installs the shared window guard once instead.
const isDropTarget = ref(false);
// Browsers fire dragenter/dragleave for every child element the pointer
// crosses (the icon and label spans here), so a plain boolean flickers.
// Count depth and only release at zero.
let dragDepth = 0;

function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

function canAcceptDrop(event: DragEvent): boolean {
  return props.allowUpload && props.node.type === "dir" && isFileDrag(event);
}

function onDropEnter(event: DragEvent): void {
  if (!canAcceptDrop(event)) return;
  event.preventDefault();
  dragDepth += 1;
  isDropTarget.value = true;
}

function onDropOver(event: DragEvent): void {
  // WebKit suppresses `drop` unless `dragover` also preventDefaults.
  if (canAcceptDrop(event)) event.preventDefault();
}

function onDropLeave(): void {
  if (dragDepth === 0) return;
  dragDepth -= 1;
  if (dragDepth <= 0) resetDropState();
}

function onDropFiles(event: DragEvent): void {
  if (!canAcceptDrop(event)) return;
  event.preventDefault();
  // The row under the pointer owns the drop; don't let an ancestor
  // container claim it too.
  event.stopPropagation();
  resetDropState();
  const dropped = event.dataTransfer?.files;
  if (dropped && dropped.length > 0) emit("uploadFiles", { folder: props.node.path, files: Array.from(dropped) });
}

function resetDropState(): void {
  dragDepth = 0;
  isDropTarget.value = false;
}

// Safety net for drags that end without a matching `dragleave` on this row —
// released outside the tree, or cancelled with Escape. One shared window
// listener drives every row, so the highlight can't get stuck on.
watch(useDragSessionEnd(), resetDropState);

// Mirrors the server's AUDIO_EXTENSIONS in server/api/routes/files.ts
// so the tree icon agrees with how /api/files/content classifies the
// file. Keep these two lists in sync when adding new formats.
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".oga", ".flac", ".aac"]);

const fileIcon = computed(() => {
  if (props.node.type !== "file") return "description";
  const { name } = props.node;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "description";
  const ext = name.slice(dot).toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return "audiotrack";
  return "description";
});

const isRecent = computed(() => props.recentPaths.has(props.node.path));

// System-managed files get tinted by edit policy so the user can
// spot them in the tree before clicking. Folders and unrecognised
// files fall through to the default neutral gray.
const iconColorClass = computed(() => {
  if (props.node.type !== "file") return DEFAULT_FILE_ICON_COLOR;
  const descriptor = descriptorForPath(props.node.path);
  return descriptor ? EDIT_POLICY_ICON_COLOR[descriptor.editPolicy] : DEFAULT_FILE_ICON_COLOR;
});

// --- Context menu + inline new-file input (#1598) -------------------

const createPolicy = computed(() => (props.node.type === "dir" ? policyForFolder(props.node.path) : null));
const placeholderText = computed(() => (createPolicy.value ? t(createPolicy.value.placeholderKey) : ""));

const menuOpen = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const createPending = ref(false);
const newFileSlug = ref("");
const createError = ref<string | null>(null);
const newFileInputRef = ref<HTMLInputElement | null>(null);
// `blur` would close the input on every focus change. We mute it for
// a single tick when the user clicks the trailing extension label or
// re-focuses the field programmatically, so the cancel-on-blur path
// doesn't fight legitimate re-focus.
let suppressBlur = false;

function onFolderContextMenu(event: MouseEvent): void {
  if (!createPolicy.value) return;
  event.preventDefault();
  menuX.value = event.clientX;
  menuY.value = event.clientY;
  menuOpen.value = true;
}

function closeMenu(): void {
  menuOpen.value = false;
}

function onContextNewFile(): void {
  closeMenu();
  if (!createPolicy.value) return;
  // Make sure the folder is open so the inline input is visible.
  if (!isExpanded(props.node.path)) expand(props.node.path);
  newFileSlug.value = "";
  createError.value = null;
  createPending.value = true;
  void nextTick(() => {
    newFileInputRef.value?.focus();
  });
}

function cancelCreate(): void {
  createPending.value = false;
  newFileSlug.value = "";
  createError.value = null;
}

function onInputBlur(): void {
  if (suppressBlur) {
    suppressBlur = false;
    return;
  }
  // Cancel on blur — matches Finder/VSCode's "click away to discard"
  // behaviour. Submit still happens on Enter explicitly.
  cancelCreate();
}

const composingFlag = ref(false);
function onCompositionStart(): void {
  composingFlag.value = true;
}
function onCompositionEnd(): void {
  // Defer clearing so a keydown Enter that fires immediately after
  // compositionend (Chromium IME-commit behaviour) still sees the
  // flag true and is suppressed.
  setTimeout(() => {
    composingFlag.value = false;
  }, 0);
}

function onInputKeydown(event: KeyboardEvent): void {
  // Enter / Escape are wired here (not via Vue's `.enter` / `.esc`
  // modifiers) because those modifiers were not firing for the user
  // in #1598. Reading `event.key` directly matches the spec.
  //
  // IME guard: the Enter that commits a Japanese / Chinese / Korean
  // composition fires keydown with either `isComposing === true`
  // (Firefox) or `keyCode === 229` (Chrome / Safari). Without the
  // 229 fallback the user gets an empty-filename error the moment
  // they confirm an IME candidate. `composingFlag` covers the
  // "compositionend just fired but the trailing keyup hasn't" gap
  // some browsers expose.
  if (event.key === "Enter") {
    if (composingFlag.value || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    onNewFileSubmit();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancelCreate();
  }
}

function refocusInput(): void {
  // Arm `suppressBlur` for the SINGLE blur that the focus() call
  // may produce before settling, then clear it so the next real
  // click-away triggers cancel-on-blur as expected. Without the
  // post-focus clear the flag stays armed after a validation /
  // save failure and silently swallows the user's next blur
  // (CodeRabbit review on #1608).
  suppressBlur = true;
  void nextTick(() => {
    newFileInputRef.value?.focus();
    setTimeout(() => {
      suppressBlur = false;
    }, 0);
  });
}

function onNewFileSubmit(): void {
  if (!createPolicy.value) return;
  const result = normaliseNewFileSlug(newFileSlug.value, createPolicy.value);
  if (!result.ok) {
    createError.value = result.reason === "empty" ? t("fileTree.newFileError.empty") : t("fileTree.newFileError.unsafe");
    refocusInput();
    return;
  }
  // Keep the input open until the parent's PUT resolves so a save
  // failure leaves the user where they were typing. The parent
  // hands back ok / error via the `resolve` callback.
  suppressBlur = true;
  emit("createFile", {
    folder: props.node.path,
    filename: result.filename,
    resolve: (ok, error) => {
      if (ok) {
        cancelCreate();
        return;
      }
      createError.value = error ?? t("fileTree.newFileError.saveFailed");
      refocusInput();
    },
  });
}

// Global click closes the menu — Teleport puts it on body, so a
// click outside the menu but inside the tree pane will still trigger
// this. The Teleport's @click.stop above keeps clicks inside the
// menu from being treated as outside.
function onWindowClick(): void {
  if (menuOpen.value) closeMenu();
}
function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && menuOpen.value) closeMenu();
}
watch(menuOpen, (open) => {
  if (open) {
    window.addEventListener("click", onWindowClick);
    window.addEventListener("keydown", onWindowKeydown);
  } else {
    window.removeEventListener("click", onWindowClick);
    window.removeEventListener("keydown", onWindowKeydown);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("click", onWindowClick);
  window.removeEventListener("keydown", onWindowKeydown);
});
</script>
