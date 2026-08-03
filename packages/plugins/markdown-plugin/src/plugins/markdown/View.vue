<template>
  <div class="markdown-container">
    <div v-if="loading" class="min-h-full p-8 flex items-center justify-center">
      <div class="text-gray-500">{{ t("pluginMarkdown.loading") }}</div>
    </div>
    <div v-else-if="loadError && !markdownContent" class="min-h-full p-8 flex items-center justify-center">
      <div class="load-error-banner" role="alert">{{ t("pluginMarkdown.loadFailed", { error: loadError }) }}</div>
    </div>
    <div v-else-if="!markdownContent" class="min-h-full p-8 flex items-center justify-center">
      <div class="text-gray-500">{{ t("pluginMarkdown.noContent") }}</div>
    </div>
    <template v-else-if="marpMode">
      <div v-if="loadError" class="load-error-banner shrink-0" role="alert">
        {{ t("pluginMarkdown.refreshFailed", { error: loadError }) }}
      </div>
      <!-- Split mode: live editor on the left, MarpView on the right
           driven by the unsaved buffer. Layout / inline-style
           rationale lives in `MarpSplitEditor.vue` (the shared
           50/50 split component). Toggles, Apply / Cancel, error
           banner are supplied here via slots. -->
      <MarpSplitEditor
        v-if="marpSplitMode"
        v-model="editableMarkdown"
        :pdf-filename="marpPdfFilename"
        :base-dir="marpBaseDir"
        :editor-label="t('pluginMarkdown.marpSplitEditorLabel')"
      >
        <template #actions>
          <button class="apply-btn" :disabled="!hasChanges || saving" @click="applyMarkdown">
            {{ saving ? t("pluginMarkdown.saving") : t("pluginMarkdown.applyChanges") }}
          </button>
          <button class="cancel-btn" @click="cancelMarpSplitEdit">{{ t("pluginMarkdown.cancel") }}</button>
        </template>
        <template #error>
          <p v-if="saveError" class="save-error mx-2 mt-1" role="alert">{{ t("pluginMarkdown.saveError", { error: saveError }) }}</p>
        </template>
        <template #preview-toolbar>
          <button
            class="h-8 px-2.5 flex items-center gap-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm"
            :title="t('pluginMarkdown.marpSplitExit')"
            :aria-label="t('pluginMarkdown.marpSplitExit')"
            @click="marpSplitMode = false"
          >
            <span class="material-icons text-base" aria-hidden="true">close_fullscreen</span>
          </button>
        </template>
      </MarpSplitEditor>
      <!-- Preview-only mode (default): single MarpView + bottom <details>. -->
      <template v-else>
        <div class="flex-1 min-h-0 overflow-y-auto flex flex-col">
          <div class="m-auto w-full">
            <MarpView :markdown="markdownContent" :pdf-filename="marpPdfFilename" :base-dir="marpBaseDir">
              <template #toolbar>
                <button
                  class="h-8 px-2.5 flex items-center gap-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm"
                  :title="t('pluginMarkdown.marpSplitEnter')"
                  :aria-label="t('pluginMarkdown.marpSplitEnter')"
                  @click="enterMarpSplitMode"
                >
                  <span class="material-icons text-base" aria-hidden="true">open_in_full</span>
                </button>
              </template>
            </MarpView>
          </div>
        </div>
        <div class="bottom-bar-wrapper">
          <details ref="sourceDetails" class="markdown-source" @toggle="onDetailsToggle">
            <summary>{{ t("pluginMarkdown.editSource") }}</summary>
            <textarea v-model="editableMarkdown" class="markdown-editor" spellcheck="false"></textarea>
            <div class="editor-actions">
              <button class="apply-btn" :disabled="!hasChanges || saving" @click="applyMarkdown">
                {{ saving ? t("pluginMarkdown.saving") : t("pluginMarkdown.applyChanges") }}
              </button>
              <button class="cancel-btn" @click="cancelEdit">{{ t("pluginMarkdown.cancel") }}</button>
            </div>
            <p v-if="saveError" class="save-error" role="alert">{{ t("pluginMarkdown.saveError", { error: saveError }) }}</p>
          </details>
        </div>
      </template>
    </template>
    <template v-else>
      <div class="flex items-center justify-end gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
        <button
          class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          :disabled="pdfDownloading"
          @click="downloadPdf"
        >
          <span class="material-icons text-base">{{ pdfDownloading ? "hourglass_empty" : "download" }}</span>
          {{ t("pluginMarkdown.pdf") }}
        </button>
        <span v-if="pdfError" class="text-xs text-red-500" :title="pdfError">{{ t("pluginMarkdown.pdfFailedShort") }}</span>
      </div>
      <div v-if="loadError" class="load-error-banner" role="alert">
        {{ t("pluginMarkdown.refreshFailed", { error: loadError }) }}
      </div>
      <div ref="previewScrollRef" class="markdown-content-wrapper">
        <div class="p-4">
          <!-- Frontmatter properties panel (FileContentRenderer-style)
               — only rendered when the file has a `---\n...\n---`
               header. Lazy-on-write means most existing files don't
               have one yet (#895). -->
          <div v-if="previewDoc.fields.length > 0" class="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-xs">
            <div v-for="field in previewDoc.fields" :key="field.key" class="flex items-baseline gap-2 py-0.5">
              <span class="font-semibold text-gray-600 shrink-0">{{ field.key }}:</span>
              <template v-if="Array.isArray(field.value)">
                <span class="flex flex-wrap gap-1">
                  <span
                    v-for="(item, idx) in field.value"
                    :key="String(idx) + ':' + formatScalarField(item)"
                    class="rounded-full bg-white border border-gray-300 px-2 py-0.5 text-gray-700"
                  >
                    {{ formatScalarField(item) }}
                  </span>
                </span>
              </template>
              <span v-else class="text-gray-800 break-words">{{ formatScalarField(field.value) }}</span>
            </div>
          </div>
          <!-- Click delegation: a single listener on the wrapper picks
               up every interactive checkbox inserted by v-html. We
               cannot bind @click directly on each `<input>` because
               v-html bypasses Vue's template compiler. -->
          <!-- eslint-disable-next-line vue/no-v-html -- DOMPurify-sanitised marked output (sanitizeMarkdownHtml). `path` can open any .md on disk, so this content is NOT app-owned. -->
          <div ref="markdownContainerRef" class="markdown-content prose prose-slate max-w-none" @click="onMarkdownClick" v-html="renderedHtml"></div>
        </div>
      </div>

      <div class="bottom-bar-wrapper">
        <!-- A plain div rather than <details>: a <summary> must be the first
             child, which forces a header row above the textarea, and this panel
             spends its one row on the toolbar UNDER the editor instead — where
             Apply / Cancel already are. `editing` is the open state. -->
        <div class="markdown-source">
          <button v-if="!editing" class="source-toggle" @click="openEditor">{{ t("pluginMarkdown.editSource") }}</button>
          <template v-else>
            <textarea ref="editorRef" v-model="editableMarkdown" class="markdown-editor" spellcheck="false" @scroll="onEditorScroll"></textarea>
            <div class="editor-actions">
              <div class="toggle-group">
                <label class="live-toggle">
                  <input v-model="livePreview" type="checkbox" />
                  {{ t("pluginMarkdown.livePreview") }}
                </label>
                <!-- Auto save rides on live preview: without it the viewer
                     already shows what is on disk, so writing behind the
                     user's back would buy nothing and cost the Cancel. -->
                <label v-if="livePreview && canPersist" class="live-toggle">
                  <input v-model="autoSave" type="checkbox" />
                  {{ t("pluginMarkdown.autoSave") }}
                </label>
              </div>
              <!-- Grouped so `.editor-actions` still sees two children and its
                   space-between keeps meaning what it does in the marp panel. -->
              <div class="action-buttons">
                <button class="apply-btn" :disabled="!hasChanges || saving" @click="applyMarkdown">
                  {{ saving ? t("pluginMarkdown.saving") : t("pluginMarkdown.applyChanges") }}
                </button>
                <button class="cancel-btn" @click="cancelEdit">{{ t("pluginMarkdown.cancel") }}</button>
              </div>
            </div>
            <p v-if="saveError" class="save-error" role="alert">{{ t("pluginMarkdown.saveError", { error: saveError }) }}</p>
          </template>
        </div>
        <button v-show="!editing" class="copy-btn" :title="copied ? t('pluginMarkdown.copiedLabel') : t('pluginMarkdown.copyLabel')" @click="copyText">
          <span class="material-icons">{{ copied ? "check" : "content_copy" }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { readDocContent } from "./contract";
import { marked } from "marked";
import { formatScalarField, sanitizeMarkdownHtml, useMarkdownDoc, useClipboardCopy, useFileWatch } from "@mulmoclaude/core/plugin-vue";
import type { ToolResult } from "gui-chat-protocol";
import { documentPathOf, type MarkdownToolData } from "./definition";
import { createAutoSaver } from "./autoSaver";
import { rewriteMarkdownImageRefs } from "@mulmoclaude/markdown-utils/image/rewriteMarkdownImageRefs";
import { findTaskLines, makeTasksInteractive, toggleTaskAt } from "@mulmoclaude/markdown-utils/markdown/taskList";
import { mermaidExtension } from "@mulmoclaude/markdown-utils/markdown/mermaidExtension";
import { useMermaidRenderer } from "../../utils/markdown/useMermaid";
import { usePdfExport } from "./usePdfExport";
import { handleExternalLinkClick } from "@mulmoclaude/markdown-utils/dom/externalLink";
import { buildPdfFilename } from "@mulmoclaude/markdown-utils/files/filename";
import { isMarpDocument } from "@mulmoclaude/markdown-utils/markdown/marpDetect";
import { useT } from "../../lang";
import MarpView from "./MarpView.vue";
import MarpSplitEditor from "./MarpSplitEditor.vue";

// Register the mermaid block extension once at module load. `marked`
// in this plugin is a bundled copy (not the host's global instance),
// so `.use()` is a plugin-local side effect — safe to call at import
// time, but idempotent-ish: registering the same extension twice
// would double-tokenise; module-level call fires exactly once per
// bundle load.
marked.use(mermaidExtension);

const t = useT();
const { dispatch } = useRuntime();

const props = defineProps<{
  selectedResult: ToolResult<MarkdownToolData>;
}>();

const emit = defineEmits<{
  updateResult: [result: ToolResult<MarkdownToolData>];
}>();

const loading = ref(false);
const saving = ref(false);
// Human-readable message shown next to the Save button when a PUT
// fails. null while the editor is idle or the last save succeeded.
const saveError = ref<string | null>(null);
// Error loading the markdown content from the server. Distinct from an
// intentionally empty document — we used to wipe `markdownContent` on
// failure, which made "fetch failed" look like "no content available".
const loadError = ref<string | null>(null);
// The actual markdown content (fetched from server or inline)
const markdownContent = ref("");
const editableMarkdown = ref("");

async function fetchMarkdownContent(): Promise<void> {
  loadError.value = null;
  const raw = props.selectedResult.data?.markdown;
  const filePath = documentPathOf(props.selectedResult.data);
  if (!raw && !filePath) {
    markdownContent.value = "";
    editableMarkdown.value = "";
    return;
  }
  if (filePath) {
    loading.value = true;
    try {
      const { content } = await dispatch({ kind: "loadDoc", path: filePath }, readDocContent);
      markdownContent.value = content ?? "";
    } catch (err) {
      // Preserve any previously-loaded content instead of wiping it —
      // the user sees the banner AND whatever they were reading, not
      // a blank canvas. editableMarkdown is left in sync so the editor
      // (if open) doesn't flip between states.
      loadError.value = err instanceof Error ? err.message : String(err);
      loading.value = false;
      return;
    }
    loading.value = false;
  } else {
    // Legacy inline content
    markdownContent.value = raw ?? "";
  }
  editableMarkdown.value = markdownContent.value;
}

// Fetch on mount
fetchMarkdownContent();

const hasChanges = computed(() => editableMarkdown.value !== markdownContent.value);

// Subscribe to per-file change events so any tab / browser / agent run
// that overwrites the file refreshes this view automatically. The path
// passed in is the workspace-relative `data.markdown` (only valid when
// `isFilePath` — inline legacy content has no on-disk twin).
const watchedPath = computed(() => documentPathOf(props.selectedResult.data));
const { version: fileVersion } = useFileWatch(watchedPath);

// Counter of in-flight / very-recent self-saves. Bumped before our
// own PUT lands, decremented when the resulting fileChange event
// arrives. The watcher below uses it to distinguish "the user just
// clicked Apply (same tab)" from "another tab / agent / browser
// rewrote the file". Without this, `useFileChange` would feed our
// own save back through the watcher and tear down split mode (and
// the bottom <details> editor) every time the user presses Apply
// (Codex review on PR #1658).
const pendingSelfSaves = ref(0);

// Declared early so the `fileVersion` watcher below can reach into the
// `<details>` element to close the editor when a remote write lands.
const sourceDetails = ref<HTMLDetailsElement>();

// Split-mode state (#1647). When true, the marp branch renders a
// 50/50 layout: textarea on the left feeds `editableMarkdown` live
// to the MarpView on the right, so the deck re-renders on every
// keystroke without going through Apply. Default false to preserve
// the preview-only landing experience from #1646. Declared up here
// (rather than alongside the other marp-* helpers) so the
// `fileVersion` watcher below can reset it on remote writes.
const marpSplitMode = ref(false);

// `editing` tracks whether the legacy bottom <details> editor is
// open. Hoisted above `enterMarpSplitMode` (which clears this on
// entry) and the click-delegation handler below; the toggle setter
// lives in `onDetailsToggle` further down.
const editing = ref(false);

// Remote write: refetch so the rendered view tracks disk. If the
// editor is open we close it first — `fileVersion` only fires once
// per remote write, so leaving the panel open and skipping the fetch
// would strand the view on stale content until the next write
// (#1001 P1). Discarding in-progress edits is rare enough to be
// acceptable; a "remote changed" banner is queued for a follow-up —
// see plans/done/feat-file-change-pubsub.md.
watch(fileVersion, (current, previous) => {
  if (current === 0 || current === previous) return;
  // Self-save: our own Apply / task-checkbox write feeds back here
  // through pubsub. Don't tear down the editor for our own writes.
  if (pendingSelfSaves.value > 0) {
    pendingSelfSaves.value -= 1;
    return;
  }
  if (editing.value) {
    closeEditor();
  }
  // Drop split mode on remote write — same discard-and-reload policy
  // as the bottom <details> editor (#1647).
  if (marpSplitMode.value) {
    marpSplitMode.value = false;
  }
  void fetchMarkdownContent();
});

// Frontmatter-aware view of the loaded content — separates the
// `---\n...\n---` header (rendered as a properties panel) from the
// markdown body (passed to marked). Without this split the header
// would render as a stray `<hr>` plus key:value plain text in
// every file the LLM saved with frontmatter (#895 PR A).
const mdDoc = useMarkdownDoc(markdownContent);

const marpMode = computed(() => isMarpDocument(mdDoc.value.meta));

// Live preview (opt-in, per session): while the bottom <details> editor is
// open, the viewer above renders the unsaved buffer instead of what is on
// disk, so a change shows up without going through Apply. Off by default —
// the panel is also used to read the saved source, and swapping the viewer
// under someone who only opened it to look would be a surprise.
const livePreview = ref(false);

// Debounced mirror of `editableMarkdown`. Undebounced, every keystroke re-runs
// marked + DOMPurify and re-renders every mermaid diagram in the document
// (`useMermaidRenderer` watches `renderedHtml` and has no throttle of its own)
// — unnoticeable on a short note, visibly janky on a long one with diagrams.
const LIVE_PREVIEW_DEBOUNCE_MS = 200;
const liveBuffer = ref("");
let liveTimer: ReturnType<typeof setTimeout> | undefined;

watch([editableMarkdown, livePreview, editing], ([text, live, open], previous) => {
  clearTimeout(liveTimer);
  if (!live || !open) return;
  // Entering live mode (or reopening the editor) publishes at once: waiting out
  // the debounce here would show a stale — on first use, empty — buffer for
  // 200ms before the document appeared.
  if (!previous || previous[1] !== live || previous[2] !== open) {
    liveBuffer.value = text;
    return;
  }
  liveTimer = setTimeout(() => {
    liveBuffer.value = text;
  }, LIVE_PREVIEW_DEBOUNCE_MS);
});

// Auto save (opt-in, only offered alongside live preview): the buffer is
// written to disk on a debounce so the document keeps up with the typing
// without an Apply. Off by default — a write is not undoable, and the panel
// is also used to try things out. Only file-backed documents can persist;
// inline legacy content has no on-disk twin to save to.
const AUTO_SAVE_DEBOUNCE_MS = 1500;
const canPersist = computed(() => documentPathOf(props.selectedResult.data) !== null);
const autoSave = ref(false);
const autoSaveActive = computed(() => autoSave.value && livePreview.value && editing.value && canPersist.value);
// Debounce, serialisation and the "is this write still wanted?" rule live in
// `createAutoSaver` (unit-tested there — the cancellation boundary is the part
// worth pinning down). This view supplies the two predicates.
const autoSaver = createAutoSaver<string | null>({
  delayMs: AUTO_SAVE_DEBOUNCE_MS,
  // Re-checked when a queued write finally runs, not just when it was queued:
  // a write already handed to the chain waits behind an in-flight PUT and would
  // otherwise still land — persisting text the user discarded with Cancel, or
  // asked to stop persisting by unticking a box. The path check covers the
  // other half: the user may have selected a different document meanwhile.
  isWanted: (path) => autoSaveActive.value && documentPathOf(props.selectedResult.data) === path,
  write: (text) => persistMarkdown(text),
});

watch([editableMarkdown, autoSaveActive], () => {
  autoSaver.cancel();
  // Closing the editor / unticking either box flips `autoSaveActive` and lands
  // here, so a pending write is dropped before Cancel discards the draft.
  if (!autoSaveActive.value || !hasChanges.value) return;
  // Snapshot what is being saved and where — by the time the write runs,
  // `editableMarkdown` and the selected document may both have moved on.
  autoSaver.schedule(editableMarkdown.value, documentPathOf(props.selectedResult.data));
});

onUnmounted(() => {
  clearTimeout(liveTimer);
  autoSaver.cancel();
});

// What the viewer renders. Deliberately NOT what `marpMode` and the
// task-checkbox walker read: those stay on `markdownContent`, so typing marp
// frontmatter can't flip the whole branch (unmounting the editor mid-keystroke)
// and a checkbox can never be toggled against a source that isn't on disk.
const previewSource = computed(() => (livePreview.value && editing.value ? liveBuffer.value : markdownContent.value));
const previewDoc = useMarkdownDoc(previewSource);

// Scroll sync, live mode only: the viewer follows the textarea's scroll
// fraction. Proportional rather than line-accurate — marked hands back no
// source-line map, and a source line's height in the output is not fixed (one
// line of fenced mermaid renders half a screen tall). So this keeps the region
// being typed roughly on screen; it lands exactly only at the two ends.
// One-way by design: driving it from both sides needs a re-entrancy guard, and
// the editor is the side with the cursor in it.
const previewScrollRef = ref<HTMLElement | null>(null);
const editorRef = ref<HTMLTextAreaElement | null>(null);

// Whether the textarea has been scrolled since the editor opened. Until it has,
// the viewer is left exactly where the reader put it: opening the editor shrinks
// the viewer, and the browser keeps its absolute scrollTop, so re-deriving that
// position from the editor's fraction against the new (shorter) range would
// nudge the text the reader is looking at for no reason. The sync starts the
// moment the editor actually becomes the side being driven.
const editorScrolled = ref(false);

// Set when we move the textarea ourselves (opening the editor at the viewer's
// position). The resulting scroll event is indistinguishable from the user's,
// and taking it as "the editor is being driven now" would trigger the very
// nudge this flag exists to prevent.
let suppressEditorScroll = false;

function onEditorScroll(): void {
  if (suppressEditorScroll) {
    suppressEditorScroll = false;
    return;
  }
  editorScrolled.value = true;
  syncPreviewScroll();
}

function syncPreviewScroll(): void {
  if (!livePreview.value || !editing.value || !editorScrolled.value) return;
  const editor = editorRef.value;
  const preview = previewScrollRef.value;
  if (!editor || !preview) return;
  const editorRange = editor.scrollHeight - editor.clientHeight;
  const previewRange = preview.scrollHeight - preview.clientHeight;
  // Nothing to map when either side fits without scrolling — the division
  // would be by zero, and there is no position to convey anyway.
  if (editorRange <= 0 || previewRange <= 0) return;
  preview.scrollTop = (editor.scrollTop / editorRange) * previewRange;
}

// Re-apply after each re-render and when live mode is switched on: new content
// changes the viewer's scrollHeight, so the fraction that was right a keystroke
// ago now points somewhere else.
watch([liveBuffer, livePreview], () => void nextTick(syncPreviewScroll));

// The same mapping the other way round, run once when the editor opens: the
// textarea starts at the viewer's scroll fraction, so opening the source after
// reading halfway down a document lands on the part being read rather than at
// the top. Same proportional caveat as above — close, not line-accurate.
// Returns null when the viewer isn't scrollable (or isn't mounted): there is no
// position to carry over, and dividing by that range would be a division by zero.
function previewScrollFraction(): number | null {
  const preview = previewScrollRef.value;
  if (!preview) return null;
  const range = preview.scrollHeight - preview.clientHeight;
  return range > 0 ? preview.scrollTop / range : null;
}

function applyEditorScrollFraction(fraction: number): void {
  const editor = editorRef.value;
  if (!editor) return;
  const range = editor.scrollHeight - editor.clientHeight;
  if (range <= 0) return;
  const target = fraction * range;
  // Only arm the suppression when the assignment will actually move the
  // element — a no-op assignment fires no scroll event, and the flag would
  // then swallow the user's first real scroll instead.
  if (Math.round(target) !== Math.round(editor.scrollTop)) suppressEditorScroll = true;
  editor.scrollTop = target;
}

function enterMarpSplitMode(): void {
  // Preserve any existing unsaved draft. The close (`close_fullscreen`)
  // button is labelled as "hide editor", not "discard" — silently
  // overwriting `editableMarkdown` with `markdownContent` on re-entry
  // would drop the user's in-flight edits without warning (Codex
  // review on PR #1658). `fetchMarkdownContent` already syncs the
  // buffer on fresh loads, and the remote-write watcher closes split
  // mode + reloads when disk diverges. Explicit discard stays on the
  // Cancel button.
  //
  // Tear down the legacy bottom <details> state in case it was open:
  // Vue's `v-else` unmounts that subtree without firing the
  // `@toggle` listener, leaving `editing` stuck on `true` — which
  // then reverts task-checkbox clicks (`onMarkdownClick`) and hides
  // the copy button (`v-show="!editing"`) for the rest of the
  // session (Codex review on PR #1658).
  if (sourceDetails.value?.open) sourceDetails.value.open = false;
  editing.value = false;
  saveError.value = null;
  marpSplitMode.value = true;
}

function cancelMarpSplitEdit(): void {
  // Discard the unsaved buffer and return to preview-only. Same
  // policy as `cancelEdit` for the bottom <details>.
  editableMarkdown.value = markdownContent.value;
  saveError.value = null;
  marpSplitMode.value = false;
}

/** The document's directory, for resolving its relative `<img>` refs.
 *  Separators are normalised first: a `path` argument may arrive in Windows
 *  spelling (`docs\\guide\\notes.md`), and splitting on "/" alone would call
 *  that a root-level file and resolve its images against the wrong directory.
 *  Root-level files legitimately return "" — the server's inlineImages() then
 *  uses the workspace root rather than the legacy `markdowns/` sourceDir. */
function documentDirOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? "" : normalized.slice(0, idx);
}

const marpBaseDir = computed(() => {
  const raw = documentPathOf(props.selectedResult.data);
  return raw === null ? undefined : documentDirOf(raw);
});

const marpPdfFilename = computed(() => {
  const prefix = props.selectedResult.data?.filenamePrefix;
  const rawName = prefix || props.selectedResult.title || "";
  return buildPdfFilename({
    name: rawName,
    fallback: "slides",
    timestampMs: Date.now(),
  });
});

const renderedHtml = computed(() => {
  if (!previewSource.value) return "";
  // Rewrite workspace-relative image refs BEFORE marked parses them —
  // same approach as wiki/View.vue and FilesView.vue. Markdown files
  // under `markdowns/<year>/foo.md` typically use `../images/x.png`,
  // so the basePath is the directory of the file; for inline legacy
  // content we have no path, so basePath is empty and only rooted
  // references get rewritten.
  const raw = documentPathOf(props.selectedResult.data);
  const basePath = raw !== null ? documentDirOf(raw) : "";
  const withImages = rewriteMarkdownImageRefs(previewDoc.value.body, basePath);
  // Strip the `disabled=""` attribute marked puts on GFM task
  // checkboxes and tag them so `onMarkdownClick` can find them
  // (#775). Inline content (no file backing) gets the same
  // treatment so non-file-backed sessions still feel responsive,
  // even though clicks there only update local state.
  // Sanitised BEFORE the task-list rewrite so the checkbox markup this view
  // inserts itself isn't what DOMPurify has to judge. The document may be any
  // `.md` on disk now (presentDocument's `path`), including a file that came
  // with a cloned repo, so raw HTML in it is untrusted input to this origin.
  return makeTasksInteractive(sanitizeMarkdownHtml(marked(withImages) as string));
});

const markdownContainerRef = ref<HTMLElement | null>(null);
useMermaidRenderer(markdownContainerRef, renderedHtml);

// Watch for scroll requests from viewState
watch(
  () => props.selectedResult?.viewState?.scrollToAnchor as string | undefined,
  (anchorId) => {
    if (!anchorId) return;
    nextTick(() => {
      const element = document.getElementById(anchorId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        console.warn(`Anchor element with id "${anchorId}" not found`);
      }
    });
  },
);

const { copied, copy } = useClipboardCopy();

function onDetailsToggle(event: Event) {
  const { open } = event.target as HTMLDetailsElement;
  editing.value = open;
  if (!open) {
    editableMarkdown.value = markdownContent.value;
    saveError.value = null;
  }
}

function openEditor(): void {
  // The draft survives a close/reopen, so don't touch `editableMarkdown` here
  // — only `closeEditor` (and Cancel, which is the same thing) discards it.
  saveError.value = null;
  // A fresh open is a fresh reader: the viewer keeps its position until this
  // editor is scrolled, however the previous one was left.
  editorScrolled.value = false;
  // Read the viewer's position BEFORE the editor mounts: opening it shrinks the
  // viewer, which moves its own scrollTop, so the fraction taken afterwards
  // would be the post-shrink one rather than what the user was looking at.
  const fraction = previewScrollFraction();
  editing.value = true;
  if (fraction === null) return;
  void nextTick(() => applyEditorScrollFraction(fraction));
}

// One teardown for both panels. The marp branch is still a <details>, and
// poking `open` fires @toggle, which runs the reset — doing it here as well
// would be the same work twice. The non-marp panel has no element to poke.
function closeEditor(): void {
  if (sourceDetails.value?.open) {
    sourceDetails.value.open = false;
    return;
  }
  editing.value = false;
  editableMarkdown.value = markdownContent.value;
  saveError.value = null;
}

function cancelEdit() {
  closeEditor();
}

async function copyText() {
  await copy(markdownContent.value);
}

const { pdfDownloading, pdfError, downloadPdf: rawDownloadPdf } = usePdfExport();

async function downloadPdf() {
  if (!markdownContent.value) return;
  const prefix = props.selectedResult.data?.filenamePrefix;
  const rawName = prefix || props.selectedResult.title || "";
  const filename = buildPdfFilename({
    name: rawName,
    fallback: "document",
    timestampMs: Date.now(),
  });
  await rawDownloadPdf({ markdown: markdownContent.value, filename });
}

// Shared write path for Apply and auto save. Returns false when nothing was
// written, so Apply can keep the panel open on failure while auto save just
// leaves the error banner up and retries on the next keystroke.
// The write itself. The path is sent verbatim — it is whatever the tool call
// named (an `artifacts/documents/YYYY/MM/…` doc this tool wrote, a repo file,
// an absolute path), and the host is the layer that decides what it will write.
async function writeDoc(filePath: string, text: string): Promise<boolean> {
  saving.value = true;
  pendingSelfSaves.value += 1;
  try {
    await dispatch({ kind: "saveDoc", path: filePath, markdown: text });
    return true;
  } catch (err) {
    // Roll back the self-save expectation — no pubsub event will
    // arrive for a failed save, so the counter would otherwise stay
    // high and silently absorb the next *remote* write.
    pendingSelfSaves.value = Math.max(0, pendingSelfSaves.value - 1);
    // Store the raw error; the template formats it via t() so locale
    // switches re-render without double-translating.
    saveError.value = err instanceof Error ? err.message : String(err);
    return false;
  } finally {
    saving.value = false;
  }
}

// What the parent is told after a successful write (pdfPath is cleared because
// the content it was rendered from is gone).
function buildUpdatedResult(filePath: string | null, text: string): ToolResult<MarkdownToolData> {
  return {
    ...props.selectedResult,
    data: {
      ...props.selectedResult.data,
      markdown: filePath ?? text,
      pdfPath: undefined,
    },
  };
}

async function persistMarkdown(text: string): Promise<boolean> {
  const raw = props.selectedResult.data?.markdown;
  const filePath = documentPathOf(props.selectedResult.data);
  if (!raw && !filePath) return false;

  saveError.value = null;

  if (filePath) {
    if (!(await writeDoc(filePath, text))) return false;
    // The user may have selected another document during the round trip. Every
    // state mutation below belongs to the document that was written, so
    // applying them now would put its content — and its path — on whatever is
    // on screen instead. Same guard as `persistTaskMarkdown`.
    if (documentPathOf(props.selectedResult.data) !== filePath) return false;
  }

  markdownContent.value = text;
  emit("updateResult", buildUpdatedResult(filePath, text));
  return true;
}

async function applyMarkdown() {
  if (await persistMarkdown(editableMarkdown.value)) {
    // Close the edit panel
    closeEditor();
  }
}

// ── Inline task-list checkbox toggle (#775) ──────────────────────
//
// Click delegation handler bound to the rendered viewer. When the
// user clicks a GFM task checkbox we:
//   1. compute the new source via `toggleTaskAt`
//   2. update local state optimistically (v-html re-renders to match)
//   3. for file-backed docs, queue a PUT through the existing
//      `/api/markdowns/update` route
//
// Skipped while the source editor is open — the textarea has its own
// edit/apply flow and a checkbox click would race with whatever the
// user is typing.

let taskPersistChain: Promise<unknown> = Promise.resolve();

async function persistTaskMarkdown(relativePath: string, markdown: string): Promise<void> {
  // Bail if the user navigated to a different result while this PUT
  // was queued — the snapshot belongs to a document that's no longer
  // on screen, and persisting it would clobber unrelated state.
  if (documentPathOf(props.selectedResult.data) !== relativePath) return;

  pendingSelfSaves.value += 1;
  let saveOk = true;
  let saveErrMsg = "";
  try {
    await dispatch({ kind: "saveDoc", path: relativePath, markdown });
  } catch (err) {
    saveOk = false;
    saveErrMsg = err instanceof Error ? err.message : String(err);
  }

  // The user may have switched results during the round-trip. Skip
  // every state mutation past this point — the watcher on
  // `selectedResult.data?.markdown` already loads the new document,
  // and writing `saveError` / triggering a refetch here would touch
  // unrelated state (or refetch the *new* doc, masking edits the
  // user just made there).
  if (documentPathOf(props.selectedResult.data) !== relativePath) return;

  if (!saveOk) {
    // Failed write — no pubsub event will land for it, so roll the
    // self-save counter back to keep the next genuine remote write
    // visible to the fileVersion watcher.
    pendingSelfSaves.value = Math.max(0, pendingSelfSaves.value - 1);
    saveError.value = saveErrMsg;
    // Refetch synchronously inside the chain so subsequent queued
    // clicks observe the canonical (server-side) markdown before
    // computing their own toggle. Detaching this with `void` could
    // let the refetch land after a newer click already wrote.
    await fetchMarkdownContent();
    return;
  }
  // Clear any stale error from a prior failed click.
  saveError.value = null;
}

function onMarkdownClick(event: MouseEvent): void {
  // External http(s) links: open in a new tab instead of letting the
  // SPA navigate away. Same handler the wiki / textResponse renders
  // use; without it, clicking an external link from a markdown file
  // tore the user out of MulmoClaude (#1221).
  if (handleExternalLinkClick(event)) return;
  const { target } = event;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== "checkbox") return;
  if (!target.classList.contains("md-task")) return;
  if (editing.value) {
    // Edit panel open — let the textarea own the source. Reverting
    // here keeps the visual in sync with the still-untouched markdown.
    target.checked = !target.checked;
    return;
  }

  const root = event.currentTarget as HTMLElement;
  const taskInputs = root.querySelectorAll<HTMLInputElement>("input.md-task");
  const taskIndex = Array.from(taskInputs).indexOf(target);
  if (taskIndex < 0) return;

  // Cross-check: if the source-side walker sees a different number
  // of tasks than `marked` rendered into the DOM, the index map
  // can't be trusted. The most common cause is a `- [ ]`-shaped line
  // inside a 4-space indented code block (the source walker treats
  // it as a task; marked treats it as code) — toggling source by
  // index would corrupt the file. Refuse all clicks when this
  // happens.
  // Walk only the body (the same source `marked` rendered) so
  // frontmatter contents containing `- [ ]`-shaped YAML never
  // collide with task counting (#895 PR A). The prefix is
  // preserved byte-for-byte and re-attached after the toggle.
  const { body } = mdDoc.value;
  const prefix = markdownContent.value.slice(0, markdownContent.value.length - body.length);
  const sourceTasks = findTaskLines(body);
  if (sourceTasks.length !== taskInputs.length) {
    target.checked = !target.checked;
    saveError.value = t("pluginMarkdown.taskCountMismatch");
    return;
  }

  const updatedBody = toggleTaskAt(body, taskIndex);
  if (updatedBody === null) {
    // Source/DOM drift — refuse to write something we can't trace.
    target.checked = !target.checked;
    return;
  }

  const updated = prefix + updatedBody;
  // Optimistic local update — v-html will re-render and the
  // textarea (if anyone opens it next) sees the same content.
  markdownContent.value = updated;
  editableMarkdown.value = updated;

  const filePath = documentPathOf(props.selectedResult.data);
  if (filePath !== null) {
    // Serialize PUTs so quick successive clicks don't race each
    // other on the wire — the chain captures `updated` per click.
    taskPersistChain = taskPersistChain.then(() => persistTaskMarkdown(filePath, updated));
  } else {
    // Inline content — emit so the parent stores the edit.
    emit("updateResult", {
      ...props.selectedResult,
      data: {
        ...props.selectedResult.data,
        markdown: updated,
        pdfPath: undefined,
      },
    });
  }
}

// Watch for external changes to selectedResult (when user clicks different result)
watch(
  () => props.selectedResult.data?.markdown,
  () => {
    // Reset split mode so navigating from one Marp doc to another
    // doesn't carry the editor pane across (split mode is a
    // per-document opt-in; "状態の永続化: なし").
    marpSplitMode.value = false;
    // Same policy for the bottom panel: an editor left open would land the
    // NEW document in edit mode, and with live preview on it would render
    // the previous document's buffer until the debounce caught up. Closing
    // is the whole reset — `editing` false, the draft resynced. (The old
    // <details> was never closed here either; the comment that claimed
    // `fetchMarkdownContent` did it was describing the buffer resync.)
    closeEditor();
    // Drop any in-flight self-save expectation: `useFileChange`
    // rebinds to the new path and resets `version` to 0, so any
    // pubsub event we were waiting on for the *old* file will never
    // reach our watcher. Leaving the counter positive would let it
    // absorb the next genuine remote write on the new doc (Codex
    // review on PR #1658).
    pendingSelfSaves.value = 0;
    fetchMarkdownContent();
  },
);
</script>

<style scoped>
.markdown-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
}

.markdown-content-wrapper {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* Body styles for the rendered Markdown.
   The container carries `prose prose-slate`, but those classes have never
   done anything in either host — Tailwind Typography is not installed in
   MulmoClaude or in MulmoTerminal. What actually rendered paragraphs and
   bullets was MulmoClaude's hand-written global `.markdown-content` CSS
   (src/index.css), which MulmoTerminal does not have; and this View is
   mounted into a Shadow DOM there, so host global CSS could not reach it
   anyway. Worse, the Tailwind preflight bundled in this plugin's
   dist/style.css applies `ol,ul,menu{list-style:none}` and `*{margin:0}`
   inside that shadow root, so the defaults are actively removed rather
   than merely absent.

   So the rules below are NOT redundant with a host's stylesheet — they are
   what makes this plugin look the same in any host. Do not delete them on
   the assumption that installing Tailwind Typography would cover them.
   Values are copied verbatim from MulmoClaude's src/index.css so the
   appearance there is unchanged (a `:deep()` rule compiles to
   `.markdown-content[data-v-x] p` = specificity (0,2,1) and outranks the
   host's (0,1,1), so any mismatch would show up as a visual change). */

.markdown-content :deep(h1) {
  font-size: 2rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
  color: #111827;
}

.markdown-content :deep(h2) {
  font-size: 1.75rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
  color: #1f2937;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.25rem;
}

.markdown-content :deep(h3) {
  font-size: 1.5rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
  color: #374151;
}

.markdown-content :deep(h4) {
  font-size: 1.25rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
  color: #374151;
}

.markdown-content :deep(h5) {
  font-size: 1.125rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.markdown-content :deep(h6) {
  font-size: 1rem;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.markdown-content :deep(p) {
  margin-bottom: 0.75rem;
  line-height: 1.6;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-left: 1.5rem;
  margin-bottom: 0.75rem;
}

.markdown-content :deep(ul) {
  list-style-type: disc;
}

.markdown-content :deep(ol) {
  list-style-type: decimal;
}

.markdown-content :deep(li) {
  margin-bottom: 0.25rem;
  line-height: 1.5;
}

.markdown-content :deep(code) {
  background: #f3f4f6;
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
  font-family: ui-monospace, SFMono-Regular, Consolas, "MS Gothic", "BIZ UDGothic", monospace;
}

.markdown-content :deep(pre) {
  background: #f3f4f6;
  padding: 0.75rem;
  border-radius: 0.375rem;
  overflow-x: auto;
  margin-bottom: 0.75rem;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.85em;
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid #d1d5db;
  padding-left: 1rem;
  color: #6b7280;
  margin: 0.75rem 0;
}

.markdown-content :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 1rem 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 0.5rem 0.75rem;
  text-align: left;
}

.markdown-content :deep(th) {
  background: #f9fafb;
  font-weight: 600;
}

.bottom-bar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.copy-btn {
  position: absolute;
  bottom: 0.3rem;
  right: 0.65rem;
  padding: 0.4rem;
  background: none;
  border: none;
  color: #333;
  cursor: pointer;
  z-index: 1;
}

.copy-btn:hover {
  color: #000;
}

.copy-btn .material-icons {
  font-size: 1.15rem;
}

.markdown-source {
  padding: 0.5rem;
  background: #f5f5f5;
  border-top: 1px solid #e0e0e0;
  font-family: Consolas, "MS Gothic", "BIZ UDGothic", monospace;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.markdown-source summary {
  cursor: pointer;
  user-select: none;
  padding: 0.5rem;
  background: #e8e8e8;
  border-radius: 4px;
  font-weight: 500;
  color: #333;
}

/* Collapsed state of the non-marp panel: the same look the <summary> had, on a
   button, because there is no <details> here to own it. */
.source-toggle {
  width: 100%;
  text-align: left;
  cursor: pointer;
  user-select: none;
  padding: 0.5rem;
  background: #e8e8e8;
  border: none;
  border-radius: 4px;
  font: inherit;
  font-weight: 500;
  color: #333;
}

.source-toggle:hover {
  background: #d8d8d8;
}

.live-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 400;
  color: #333;
  cursor: pointer;
}

.toggle-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.action-buttons {
  display: flex;
  gap: 0.5rem;
}

.markdown-source[open] summary {
  margin-bottom: 0.5rem;
}

.markdown-source summary:hover {
  background: #d8d8d8;
}

.markdown-editor {
  width: 100%;
  height: 40vh;
  padding: 1rem;
  background: #333;
  border: 1px solid #ccc;
  border-radius: 4px;
  color: #ffffff;
  /* MulmoTerminal's xterm stack (TERMINAL_FONT_FAMILY_DEFAULT): Latin first, then the CJK tail
     with Japanese ahead of the other locales so kanji don't get mainland glyph shapes. Restated
     here rather than imported — the terminal's copy lives in another app. */
  font-family:
    "JetBrains Mono", "Fira Code", Menlo, Consolas, "Noto Sans Mono CJK JP", "Hiragino Sans", "BIZ UDGothic", "MS Gothic", IPAGothic, "Noto Sans Mono CJK KR",
    "Malgun Gothic", "Noto Sans Mono CJK SC", "Microsoft YaHei", "Noto Sans Mono CJK TC", "Microsoft JhengHei", monospace;
  font-size: 0.9rem;
  resize: vertical;
  margin-bottom: 0.5rem;
  line-height: 1.5;
}

.markdown-editor:focus {
  outline: none;
  border-color: #4caf50;
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.1);
}

.apply-btn {
  padding: 0.5rem 1rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s;
  font-weight: 500;
}

.apply-btn:hover {
  background: #45a049;
}

.apply-btn:active {
  background: #3d8b40;
}

.apply-btn:disabled {
  background: #cccccc;
  color: #666666;
  cursor: not-allowed;
  opacity: 0.6;
}

.apply-btn:disabled:hover {
  background: #cccccc;
}

.editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.save-error {
  margin: 0.5rem 0 0;
  padding: 0.4rem 0.6rem;
  background: #fdecea;
  color: #b71c1c;
  border: 1px solid #f5c2c7;
  border-radius: 4px;
  font-size: 0.85rem;
}

.load-error-banner {
  margin: 0.75rem 1rem;
  padding: 0.5rem 0.75rem;
  background: #fdecea;
  color: #b71c1c;
  border: 1px solid #f5c2c7;
  border-radius: 4px;
  font-size: 0.875rem;
}

.cancel-btn {
  padding: 0.5rem 1rem;
  background: #e0e0e0;
  color: #333;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s;
  font-weight: 500;
}

.cancel-btn:hover {
  background: #d0d0d0;
}
</style>
