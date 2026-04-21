<template>
  <div class="h-full bg-white flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
      <div class="min-w-0 flex-1">
        <h2 class="text-lg font-semibold text-gray-800 truncate">
          {{ script.title || "Untitled Script" }}
        </h2>
        <p v-if="script.description" class="text-sm text-gray-500 mt-0.5 truncate">
          {{ script.description }}
        </p>
        <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
          <span>{{ beats.length }} beat{{ beats.length !== 1 ? "s" : "" }}</span>
          <span v-if="script.lang">{{ script.lang }}</span>
          <span v-if="filePath" class="truncate">{{ filePath }}</span>
        </div>
      </div>
      <div class="ml-4 shrink-0 flex gap-2">
        <!-- Download Movie -->
        <a
          v-if="moviePath && !movieGenerating"
          :href="`${downloadMovieBase}?moviePath=${encodeURIComponent(moviePath)}`"
          download
          class="px-3 py-1 text-xs rounded-full border transition-colors border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center gap-1"
        >
          <span class="material-icons text-sm leading-none">download</span>
          <span>Movie</span>
        </a>
        <!-- Generate / Regenerate Movie -->
        <button
          class="px-3 py-1 text-xs rounded-full border transition-colors border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 flex items-center justify-center gap-1"
          :disabled="movieGenerating"
          @click="generateMovie"
        >
          <svg v-if="movieGenerating" class="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span v-if="movieGenerating">Generating…</span>
          <template v-else>
            <span class="material-icons text-sm leading-none">refresh</span>
            <span>Movie</span>
          </template>
        </button>
      </div>
    </div>

    <!-- Characters section -->
    <div v-if="characterKeys.length > 0" class="border-b border-gray-100 shrink-0 px-4 py-3">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Characters</span>
        <button
          class="px-2 py-0.5 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          :disabled="movieGenerating || anyBeatRendering || characterKeys.every((k) => charRenderState[k] === 'rendering')"
          @click="generateAllCharacters"
        >
          Generate All
        </button>
      </div>
      <div class="flex gap-3 flex-wrap">
        <div v-for="key in characterKeys" :key="key" class="flex flex-col items-center gap-1 w-36">
          <!-- Character thumbnail -->
          <div
            class="relative w-36 h-36 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center transition-colors"
            :class="charDragOver[key] ? 'border-blue-400 bg-blue-50' : 'border-gray-200'"
            @dragover="onCharDragOver($event, key)"
            @dragleave="onCharDragLeave(key)"
            @drop="onCharDrop($event, key)"
          >
            <img
              v-if="charImages[key]"
              :src="charImages[key]"
              class="w-full h-full object-cover cursor-zoom-in"
              :alt="key"
              @click="openCharacterLightbox(key)"
            />
            <template v-else-if="charRenderState[key] === 'rendering'">
              <svg class="animate-spin w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </template>
            <template v-else-if="charRenderState[key] === 'error'">
              <span class="text-xs text-red-400 text-center px-1">{{ charErrors[key] }}</span>
            </template>
            <template v-else>
              <span class="text-xs text-gray-300 text-center px-1 leading-tight">{{ characterPrompt(key) }}</span>
            </template>
            <!-- Permanent drop hint -->
            <div v-if="!charDragOver[key]" class="absolute bottom-0 inset-x-0 text-center text-xs text-gray-400 bg-white/70 py-0.5 pointer-events-none">
              or drop image
            </div>
            <!-- Drop overlay -->
            <div v-if="charDragOver[key]" class="absolute inset-0 flex items-center justify-center bg-blue-50/80 pointer-events-none">
              <span class="text-xs text-blue-500 font-medium">Drop</span>
            </div>
            <!-- Regenerate button -->
            <button
              v-if="charImages[key] && charRenderState[key] !== 'rendering'"
              class="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded border bg-white"
              :class="
                movieGenerating || anyBeatRendering ? 'border-yellow-400 text-yellow-500 cursor-not-allowed' : 'border-gray-400 text-gray-600 hover:bg-gray-50'
              "
              :disabled="movieGenerating || anyBeatRendering"
              @click.stop="renderCharacter(key, true)"
            >
              <span v-if="movieGenerating || anyBeatRendering" class="inline-block animate-spin">↺</span>
              <span v-else>↺</span>
            </button>
            <!-- Generate button -->
            <button
              v-else-if="!charImages[key] && charRenderState[key] !== 'rendering'"
              class="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded border bg-white"
              :class="
                movieGenerating || anyBeatRendering ? 'border-yellow-400 text-yellow-500 cursor-not-allowed' : 'border-blue-400 text-blue-600 hover:bg-blue-50'
              "
              :disabled="movieGenerating || anyBeatRendering"
              @click.stop="renderCharacter(key, false)"
            >
              <svg v-if="movieGenerating || anyBeatRendering" class="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span v-else>Gen</span>
            </button>
          </div>
          <span class="text-xs text-gray-600 text-center truncate w-full">{{ key }}</span>
        </div>
      </div>
    </div>

    <!-- Beat list -->
    <div ref="beatListEl" class="flex-1 overflow-y-auto p-2 space-y-1.5">
      <div v-for="(beat, index) in beats" :key="index" class="rounded-lg border border-gray-200 overflow-hidden">
        <!-- Beat body: thumbnail + narration side by side -->
        <div class="flex gap-3 items-stretch">
          <!-- Thumbnail -->
          <div
            class="relative shrink-0 w-[45%] overflow-hidden bg-gray-50 transition-colors"
            :class="beatDragOver[index] ? 'bg-blue-50' : ''"
            @dragover="onBeatDragOver($event, index)"
            @dragleave="onBeatDragLeave(index)"
            @drop="onBeatDrop($event, index)"
          >
            <img
              v-if="renderedImages[index]"
              :src="renderedImages[index]"
              class="w-full object-contain cursor-zoom-in"
              :alt="`Beat ${index + 1}`"
              @click="openLightbox(index)"
            />
            <button
              v-if="renderedImages[index] && renderState[index] !== 'rendering'"
              class="absolute top-1.5 right-1.5 flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-gray-400 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="movieGenerating"
              @click.stop="regenerateBeat(index)"
            >
              ↺
            </button>
            <div v-else-if="!renderedImages[index]" class="w-full aspect-video flex flex-col items-center justify-center gap-1 p-2">
              <template v-if="renderState[index] === 'rendering' || (movieGenerating && !renderedImages[index] && effectiveBeat(index).imagePrompt)">
                <svg class="animate-spin w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span class="text-xs text-green-500">Rendering…</span>
              </template>
              <template v-else-if="renderState[index] === 'error'">
                <span class="text-xs text-red-400 text-center">{{ renderErrors[index] }}</span>
              </template>
              <template v-else>
                <span v-if="effectiveBeat(index).imagePrompt" class="text-xs text-gray-400 text-center italic leading-relaxed px-1">{{
                  effectiveBeat(index).imagePrompt
                }}</span>
                <span v-else class="text-xs text-gray-300">{{ beat.image?.type ?? "—" }}</span>
              </template>
            </div>
            <!-- Beat drop hint / overlay -->
            <div v-if="beatDragOver[index]" class="absolute inset-0 flex items-center justify-center bg-blue-50/80 pointer-events-none">
              <span class="text-xs text-blue-500 font-medium">Drop</span>
            </div>
            <div
              v-else-if="!renderedImages[index] && renderState[index] !== 'rendering'"
              class="absolute bottom-0 inset-x-0 text-center text-xs text-gray-400 bg-white/70 py-0.5 pointer-events-none"
            >
              or drop image
            </div>
            <!-- Generate button for imagePrompt beats -->
            <button
              v-if="effectiveBeat(index).imagePrompt && !renderedImages[index] && renderState[index] !== 'rendering' && !movieGenerating"
              class="absolute top-1.5 right-1.5 flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-blue-400 text-blue-600 bg-white hover:bg-blue-50"
              @click="renderBeat(index)"
            >
              Generate
            </button>
          </div>

          <!-- Narration text -->
          <div class="flex flex-col flex-1 min-w-0 px-2 py-1.5">
            <span class="text-sm text-gray-800 leading-relaxed">{{ effectiveBeat(index).text }}</span>
            <div class="flex justify-between mt-auto pt-1">
              <!-- Audio controls -->
              <div class="flex items-center gap-1">
                <template v-if="audioState[index] === 'generating' || (movieGenerating && !beatAudios[index] && effectiveBeat(index).text)">
                  <svg class="animate-spin w-3 h-3 text-green-400" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </template>
                <button
                  v-else-if="beatAudios[index]"
                  class="text-xs px-2 py-0.5 rounded border"
                  :class="playingAudio?.index === index ? 'border-red-400 text-red-600 hover:bg-red-50' : 'border-green-400 text-green-600 hover:bg-green-50'"
                  @click="playAudio(index)"
                >
                  {{ playingAudio?.index === index ? "■ Stop" : "▶ Play" }}
                </button>
                <template v-else-if="audioErrors[index]">
                  <span class="text-xs text-red-400" :title="audioErrors[index]">⚠ Error</span>
                  <button
                    v-if="effectiveBeat(index).text"
                    class="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    :disabled="movieGenerating"
                    @click="generateAudio(index)"
                  >
                    ↺
                  </button>
                </template>
                <button
                  v-else-if="effectiveBeat(index).text"
                  class="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
                  @click="generateAudio(index)"
                >
                  ♪ Generate
                </button>
              </div>
              <button class="text-gray-400 hover:text-gray-600" :title="sourceOpen[index] ? 'Hide source' : 'Show source'" @click="toggleSource(index)">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Source editor -->
        <div v-if="sourceOpen[index]" class="border-t border-gray-100">
          <textarea
            v-model="sourceText[index]"
            class="w-full text-xs text-gray-600 bg-gray-50 p-2 font-mono resize-none"
            :class="isValidBeat(index) ? 'outline-none' : 'outline outline-2 outline-red-400'"
            rows="8"
            spellcheck="false"
          />
          <div class="flex items-center justify-end gap-2 px-2 pb-2">
            <span v-if="beatSaveErrors[index]" class="text-xs text-red-600" role="alert">⚠ {{ beatSaveErrors[index] }}</span>
            <button
              class="px-2 py-1 text-xs rounded border"
              :class="
                isValidBeat(index) && !beatSaving[index]
                  ? 'border-blue-400 text-blue-600 hover:bg-blue-50 cursor-pointer'
                  : 'border-gray-200 text-gray-300 cursor-not-allowed'
              "
              :disabled="!isValidBeat(index) || !!beatSaving[index]"
              @click="updateBeat(index)"
            >
              {{ beatSaving[index] ? "Saving…" : "Update" }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="beats.length === 0" class="flex items-center justify-center h-32 text-gray-400 text-sm">No beats found in script</div>
    </div>

    <!-- Bottom bar: Edit Script Source + Copy -->
    <div class="bottom-bar-wrapper">
      <details ref="sourceDetails" class="script-source" @toggle="onSourceToggle(($event.target as HTMLDetailsElement).open)">
        <summary>Edit Script Source</summary>
        <textarea
          v-model="editableSource"
          class="script-editor"
          :class="{ 'script-editor-invalid': sourceChanged && !sourceValid }"
          spellcheck="false"
        ></textarea>
        <div class="editor-actions">
          <button class="apply-btn" :disabled="!sourceChanged || !sourceValid" @click="applySource">Apply Changes</button>
          <button class="cancel-btn" @click="cancelSourceEdit">Cancel</button>
        </div>
      </details>
      <button v-show="!editing" class="copy-btn" :title="copied ? 'Copied!' : 'Copy'" @click="copyText">
        <span class="material-icons">{{ copied ? "check" : "content_copy" }}</span>
      </button>
    </div>

    <!-- Lightbox -->
    <div v-if="lightbox" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80" @click="lightbox = null">
      <div class="flex items-center gap-4" @click.stop>
        <button
          v-if="!lightbox.isCharacter"
          class="text-white/60 hover:text-white disabled:opacity-20 text-4xl leading-none"
          :disabled="!hasPrev"
          @click="lightboxMove(-1)"
        >
          ‹
        </button>
        <div class="flex flex-col items-center gap-3">
          <img :src="lightbox.src" class="max-w-[80vw] max-h-[80vh] object-contain rounded shadow-2xl" />
          <div class="flex items-center gap-4">
            <p v-if="lightbox.text" class="max-w-[80vw] text-center text-white text-2xl leading-relaxed">
              {{ lightbox.text }}
            </p>
            <button
              v-if="beatAudios[lightbox.index]"
              class="shrink-0 text-sm px-3 py-1 rounded border"
              :class="
                playingAudio?.index === lightbox.index ? 'border-red-400 text-red-400 hover:bg-red-400/20' : 'border-white/60 text-white/60 hover:bg-white/20'
              "
              @click="playAudio(lightbox.index)"
            >
              {{ playingAudio?.index === lightbox.index ? "■ Stop" : "▶ Play" }}
            </button>
          </div>
        </div>
        <button
          v-if="!lightbox.isCharacter"
          class="text-white/60 hover:text-white disabled:opacity-20 text-4xl leading-none"
          :disabled="!hasNext"
          @click="lightboxMove(1)"
        >
          ›
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { MulmoScriptData } from "./index";
import { mulmoBeatSchema, mulmoScriptSchema } from "@mulmocast/types";
import { extractErrorMessage, getMissingCharacterKeys, shouldAutoRenderBeat, streamMovieEvents, validateBeatJSON } from "./helpers";
import { apiGet, apiPost, apiFetchRaw } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { errorMessage } from "../../utils/errors";
import { useClipboardCopy } from "../../composables/useClipboardCopy";
import { useActiveSession } from "../../composables/useActiveSession";
import { GENERATION_KINDS, type PendingGeneration } from "../../types/events";

interface Beat {
  speaker?: string;
  text?: string;
  id?: string;
  imagePrompt?: string;
  image?: { type: string; [key: string]: unknown };
}

interface ImageEntry {
  type: string;
  prompt?: string;
  [key: string]: unknown;
}

interface MulmoScript {
  title?: string;
  description?: string;
  lang?: string;
  beats?: Beat[];
  imageParams?: {
    images?: Record<string, ImageEntry>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const props = defineProps<{
  selectedResult: ToolResultComplete<MulmoScriptData>;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const data = computed(() => props.selectedResult.data);
const script = computed<MulmoScript>(() => data.value?.script ?? {});
const filePath = computed(() => data.value?.filePath ?? "");
const beats = computed<Beat[]>(() => script.value.beats ?? []);

// Exposed to the template so the `<a :href="...">` download button
// can compose a query-string URL without inlining the API path.
const downloadMovieBase = API_ROUTES.mulmoScript.downloadMovie;

// Per-beat render state
type RenderState = "idle" | "rendering" | "done" | "error";
const renderState = reactive<Record<number, RenderState>>({});
const renderedImages = reactive<Record<number, string>>({});
const renderErrors = reactive<Record<number, string>>({});
const sourceOpen = reactive<Record<number, boolean>>({});
const sourceText = reactive<Record<number, string>>({});
// Surface POST /api/mulmo-script/update-beat failures inline next to
// the Update button. Cleared on next successful save or editor close.
const beatSaveErrors = reactive<Record<number, string>>({});
const beatSaving = reactive<Record<number, boolean>>({});
const localOverrides = reactive<Record<number, Beat>>({});
const movieGenerating = ref(false);
const moviePath = ref<string | null>(null);
const beatAudios = reactive<Record<number, string>>({});
const audioState = reactive<Record<number, "generating" | "done" | "error">>({});
const audioErrors = reactive<Record<number, string>>({});
const playingAudio = ref<{ index: number; audio: HTMLAudioElement } | null>(null);
const beatListEl = ref<HTMLElement | null>(null);
const lightbox = ref<{
  src: string;
  text?: string;
  index: number;
  isCharacter?: boolean;
} | null>(null);
// Character (imageParams.images) state
type CharRenderState = "idle" | "rendering" | "done" | "error";
const charRenderState = reactive<Record<string, CharRenderState>>({});
const charImages = reactive<Record<string, string>>({});
const charErrors = reactive<Record<string, string>>({});
const charDragOver = reactive<Record<string, boolean>>({});
const beatDragOver = reactive<Record<number, boolean>>({});

const anyBeatRendering = computed(() => Object.values(renderState).some((s) => s === "rendering"));

const characterKeys = computed(() => {
  const imgs = script.value.imageParams?.images ?? {};
  return Object.keys(imgs).filter((k) => imgs[k]?.type === "imagePrompt");
});

// Session-scoped pending generations — lets spinners survive view
// unmount/remount and tags new generations on the correct session
// channel so the cross-session sidebar indicator stays lit.
const activeSessionRef = useActiveSession();
const chatSessionId = computed(() => activeSessionRef?.value?.id);

const pendingForThisScript = computed(() => {
  const out: Record<string, PendingGeneration> = {};
  const pending = activeSessionRef?.value?.pendingGenerations ?? {};
  const fp = filePath.value;
  if (!fp) return out;
  for (const [mapKey, entry] of Object.entries(pending)) {
    if (entry.filePath === fp) out[mapKey] = entry;
  }
  return out;
});

// Local renderState / charRenderState / audioState / movieGenerating
// are kept in sync with `pendingForThisScript` by the watcher below
// and by `initializeScript`, so the template continues to read them
// without needing per-kind predicates here.

function characterPrompt(key: string): string {
  return (script.value.imageParams?.images?.[key]?.prompt as string) ?? "";
}

function openLightbox(index: number) {
  if (playingAudio.value) {
    playingAudio.value.audio.pause();
    playingAudio.value = null;
  }
  lightbox.value = {
    src: renderedImages[index],
    text: effectiveBeat(index).text,
    index,
  };
}

const hasPrev = computed(() => {
  if (!lightbox.value) return false;
  for (let i = lightbox.value.index - 1; i >= 0; i--) {
    if (renderedImages[i]) return true;
  }
  return false;
});

const hasNext = computed(() => {
  if (!lightbox.value) return false;
  for (let i = lightbox.value.index + 1; i < beats.value.length; i++) {
    if (renderedImages[i]) return true;
  }
  return false;
});

function lightboxMove(delta: number) {
  if (!lightbox.value) return;
  const total = beats.value.length;
  let i = lightbox.value.index + delta;
  while (i >= 0 && i < total) {
    if (renderedImages[i]) {
      openLightbox(i);
      return;
    }
    i += delta;
  }
}
const sourceDetails = ref<HTMLDetailsElement>();
const editing = ref(false);
const editableSource = ref("");
const { copied, copy } = useClipboardCopy();

// Beats may be edited in-place via `updateBeat()` and rendered through
// `effectiveBeat()`, so the Copy / source-view text must read the merged
// shape — otherwise the clipboard returns the original prop snapshot
// until the full result is reloaded.
const effectiveScript = computed<MulmoScript>(() => ({
  ...script.value,
  beats: beats.value.map((beat, i) => localOverrides[i] ?? beat),
}));
const scriptSourceText = computed(() => JSON.stringify(effectiveScript.value, null, 2));
const loadedSource = ref("");
const sourceChanged = computed(() => editableSource.value !== loadedSource.value);
const sourceValid = computed(() => {
  try {
    const parsed = JSON.parse(editableSource.value);
    return mulmoScriptSchema.safeParse(parsed).success;
  } catch {
    return false;
  }
});

async function onSourceToggle(open: boolean) {
  editing.value = open;
  if (open) {
    let text = scriptSourceText.value;
    // Read the current file from disk so beat-level edits are reflected
    if (filePath.value) {
      const response = await apiGet<{ content?: string }>(API_ROUTES.files.content, { path: filePath.value });
      if (response.ok && response.data.content) {
        text = response.data.content;
      }
      // fall through to in-memory script on failure
    }
    editableSource.value = text;
    loadedSource.value = text;
  }
}

function cancelSourceEdit() {
  if (sourceDetails.value) sourceDetails.value.open = false;
}

async function applySource() {
  let parsed: MulmoScript;
  try {
    parsed = JSON.parse(editableSource.value);
  } catch (err) {
    alert(extractErrorMessage(err));
    return;
  }
  const response = await apiPost<unknown>(API_ROUTES.mulmoScript.updateScript, {
    filePath: filePath.value,
    script: parsed,
  });
  if (!response.ok) {
    alert(response.error || "Update failed");
    return;
  }

  // Update the UI with the new script.
  // Note: the parent's handleUpdateResult uses Object.assign (in-place
  // mutation), so the watcher on props.selectedResult won't fire.
  // We emit first so the parent data is updated, then manually
  // re-initialize the view.
  emit("updateResult", {
    ...props.selectedResult,
    data: { ...props.selectedResult.data, script: parsed },
  });

  if (sourceDetails.value) sourceDetails.value.open = false;
  await initializeScript();
}

async function copyText() {
  await copy(scriptSourceText.value);
}

function effectiveBeat(index: number): Beat {
  return localOverrides[index] ?? beats.value[index] ?? {};
}

function toggleSource(index: number) {
  if (!sourceOpen[index]) {
    sourceText[index] = JSON.stringify(effectiveBeat(index), null, 2);
    delete beatSaveErrors[index];
  }
  sourceOpen[index] = !sourceOpen[index];
}

function isValidBeat(index: number): boolean {
  return validateBeatJSON(sourceText[index] ?? "", mulmoBeatSchema);
}

async function updateBeat(index: number) {
  let beat: Beat;
  try {
    beat = JSON.parse(sourceText[index]);
  } catch (err) {
    beatSaveErrors[index] = `Invalid JSON: ${errorMessage(err)}`;
    return;
  }
  const prevImage = JSON.stringify(effectiveBeat(index).image);

  delete beatSaveErrors[index];
  beatSaving[index] = true;
  const response = await apiPost<unknown>(API_ROUTES.mulmoScript.updateBeat, {
    filePath: filePath.value,
    beatIndex: index,
    beat,
  });
  delete beatSaving[index];
  if (!response.ok) {
    beatSaveErrors[index] = `Save failed: ${response.error}`;
    return;
  }

  localOverrides[index] = beat;
  sourceOpen[index] = false;

  if (JSON.stringify(beat.image) !== prevImage) {
    delete renderedImages[index];
    renderBeat(index);
  }
}

async function renderBeat(index: number) {
  renderState[index] = "rendering";
  const response = await apiPost<{ image?: string; error?: string }>(API_ROUTES.mulmoScript.renderBeat, {
    filePath: filePath.value,
    beatIndex: index,
    chatSessionId: chatSessionId.value,
  });
  if (!response.ok) {
    renderErrors[index] = response.error || "Render failed";
    renderState[index] = "error";
    return;
  }
  if (response.data.error) {
    renderErrors[index] = response.data.error;
    renderState[index] = "error";
    return;
  }
  renderedImages[index] = response.data.image ?? "";
  renderState[index] = "done";
  refreshMissingCharacterImages();
}

async function regenerateBeat(index: number) {
  delete renderedImages[index];
  renderState[index] = "rendering";
  const response = await apiPost<{ image?: string; error?: string }>(API_ROUTES.mulmoScript.renderBeat, {
    filePath: filePath.value,
    beatIndex: index,
    force: true,
    chatSessionId: chatSessionId.value,
  });
  if (!response.ok) {
    renderErrors[index] = response.error || "Render failed";
    renderState[index] = "error";
    return;
  }
  if (response.data.error) {
    renderErrors[index] = response.data.error;
    renderState[index] = "error";
    return;
  }
  renderedImages[index] = response.data.image ?? "";
  renderState[index] = "done";
}

async function loadExistingBeatImage(index: number) {
  const response = await apiGet<{ image?: string }>(API_ROUTES.mulmoScript.beatImage, { filePath: filePath.value, beatIndex: String(index) });
  // silently ignore errors — image simply hasn't been generated yet
  if (response.ok && response.data.image) {
    renderedImages[index] = response.data.image;
    renderState[index] = "done";
  }
}

async function loadExistingBeatAudio(index: number) {
  const response = await apiGet<{ audio?: string }>(API_ROUTES.mulmoScript.beatAudio, { filePath: filePath.value, beatIndex: String(index) });
  // silently ignore errors
  if (response.ok && response.data.audio) {
    beatAudios[index] = response.data.audio;
    audioState[index] = "done";
  }
}

async function generateAudio(index: number) {
  audioState[index] = "generating";
  delete audioErrors[index];
  const response = await apiPost<{ audio?: string; error?: string }>(API_ROUTES.mulmoScript.generateBeatAudio, {
    filePath: filePath.value,
    beatIndex: index,
    chatSessionId: chatSessionId.value,
  });
  if (!response.ok) {
    audioErrors[index] = response.error || "Audio generation failed";
    audioState[index] = "error";
    return;
  }
  if (response.data.error) {
    audioErrors[index] = response.data.error;
    audioState[index] = "error";
    return;
  }
  beatAudios[index] = response.data.audio ?? "";
  audioState[index] = "done";
}

function playAudio(index: number) {
  if (playingAudio.value) {
    playingAudio.value.audio.pause();
    const wasIndex = playingAudio.value.index;
    playingAudio.value = null;
    if (wasIndex === index) return;
  }
  const src = beatAudios[index];
  if (!src) return;
  const audio = new Audio(src);
  playingAudio.value = { index, audio };
  audio.addEventListener("ended", () => {
    if (playingAudio.value?.index !== index) return;
    playingAudio.value = null;
    if (lightbox.value?.index === index) {
      lightboxMove(1);
      const nextIndex = lightbox.value?.index;
      if (nextIndex !== undefined && nextIndex !== index && beatAudios[nextIndex]) {
        playAudio(nextIndex);
      }
    }
  });
  audio.play();
}

function onBeatDragOver(event: DragEvent, index: number) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  beatDragOver[index] = true;
}

function onBeatDragLeave(index: number) {
  beatDragOver[index] = false;
}

async function onBeatDrop(event: DragEvent, index: number) {
  event.preventDefault();
  beatDragOver[index] = false;
  const file = event.dataTransfer?.files[0];
  if (!file || !file.type.startsWith("image/")) return;

  renderState[index] = "rendering";
  delete renderErrors[index];
  let imageData: string;
  try {
    imageData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } catch (err) {
    renderErrors[index] = errorMessage(err);
    renderState[index] = "error";
    return;
  }
  const response = await apiPost<{ image?: string; error?: string }>(API_ROUTES.mulmoScript.uploadBeatImage, {
    filePath: filePath.value,
    beatIndex: index,
    imageData,
  });
  if (!response.ok) {
    renderErrors[index] = response.error || "Upload failed";
    renderState[index] = "error";
    return;
  }
  if (response.data.error) {
    renderErrors[index] = response.data.error;
    renderState[index] = "error";
    return;
  }
  renderedImages[index] = response.data.image ?? "";
  renderState[index] = "done";
}

function onCharDragOver(event: DragEvent, key: string) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  charDragOver[key] = true;
}

function onCharDragLeave(key: string) {
  charDragOver[key] = false;
}

async function onCharDrop(event: DragEvent, key: string) {
  event.preventDefault();
  charDragOver[key] = false;
  const file = event.dataTransfer?.files[0];
  if (!file || !file.type.startsWith("image/")) return;

  charRenderState[key] = "rendering";
  delete charErrors[key];
  let imageData: string;
  try {
    imageData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } catch (err) {
    charErrors[key] = errorMessage(err);
    charRenderState[key] = "error";
    return;
  }
  const response = await apiPost<{ image?: string; error?: string }>(API_ROUTES.mulmoScript.uploadCharacterImage, { filePath: filePath.value, key, imageData });
  if (!response.ok) {
    charErrors[key] = response.error || "Upload failed";
    charRenderState[key] = "error";
    return;
  }
  if (response.data.error) {
    charErrors[key] = response.data.error;
    charRenderState[key] = "error";
    return;
  }
  charImages[key] = response.data.image ?? "";
  charRenderState[key] = "done";
}

function openCharacterLightbox(key: string) {
  if (playingAudio.value) {
    playingAudio.value.audio.pause();
    playingAudio.value = null;
  }
  lightbox.value = {
    src: charImages[key],
    text: key,
    index: -1,
    isCharacter: true,
  };
}

async function loadExistingCharacterImage(key: string) {
  const response = await apiGet<{ image?: string }>(API_ROUTES.mulmoScript.characterImage, { filePath: filePath.value, key });
  // silently ignore errors
  if (response.ok && response.data.image) {
    charImages[key] = response.data.image;
    charRenderState[key] = "done";
  }
}

function refreshMissingCharacterImages() {
  getMissingCharacterKeys(characterKeys.value, charImages, charRenderState).forEach((k) => loadExistingCharacterImage(k));
}

async function renderCharacter(key: string, force: boolean) {
  charRenderState[key] = "rendering";
  delete charErrors[key];
  const response = await apiPost<{ image?: string; error?: string }>(API_ROUTES.mulmoScript.renderCharacter, {
    filePath: filePath.value,
    key,
    force,
    chatSessionId: chatSessionId.value,
  });
  if (!response.ok) {
    charErrors[key] = response.error || "Render failed";
    charRenderState[key] = "error";
    return;
  }
  if (response.data.error) {
    charErrors[key] = response.data.error;
    charRenderState[key] = "error";
    return;
  }
  charImages[key] = response.data.image ?? "";
  charRenderState[key] = "done";
}

async function generateAllCharacters() {
  await Promise.all(characterKeys.value.filter((k) => charRenderState[k] !== "rendering").map((k) => renderCharacter(k, false)));
}

async function initializeScript() {
  // Reset scroll position so new results start at the top
  if (beatListEl.value) beatListEl.value.scrollTop = 0;
  // Reset per-script state
  Object.keys(renderState).forEach((k) => delete renderState[+k]);
  Object.keys(renderedImages).forEach((k) => delete renderedImages[+k]);
  Object.keys(renderErrors).forEach((k) => delete renderErrors[+k]);
  Object.keys(sourceOpen).forEach((k) => delete sourceOpen[+k]);
  Object.keys(sourceText).forEach((k) => delete sourceText[+k]);
  Object.keys(beatSaveErrors).forEach((k) => delete beatSaveErrors[+k]);
  Object.keys(beatSaving).forEach((k) => delete beatSaving[+k]);
  Object.keys(localOverrides).forEach((k) => delete localOverrides[+k]);
  Object.keys(beatAudios).forEach((k) => delete beatAudios[+k]);
  Object.keys(audioState).forEach((k) => delete audioState[+k]);
  Object.keys(audioErrors).forEach((k) => delete audioErrors[+k]);
  Object.keys(charRenderState).forEach((k) => delete charRenderState[k]);
  Object.keys(charImages).forEach((k) => delete charImages[k]);
  Object.keys(charErrors).forEach((k) => delete charErrors[k]);
  Object.keys(beatDragOver).forEach((k) => delete beatDragOver[+k]);
  moviePath.value = null;
  if (sourceDetails.value) sourceDetails.value.open = false;

  const AUTO_RENDER_TYPES = ["textSlide", "markdown", "chart", "mermaid", "html_tailwind"] as const;
  const hasCharacters = characterKeys.value.length > 0;
  beats.value.forEach((beat, index) => {
    if (shouldAutoRenderBeat(beat, hasCharacters, AUTO_RENDER_TYPES)) {
      renderBeat(index);
    } else if (beat.imagePrompt) {
      loadExistingBeatImage(index);
    }
    if (beat.text) loadExistingBeatAudio(index);
  });

  characterKeys.value.forEach((key) => loadExistingCharacterImage(key));

  if (filePath.value) {
    const response = await apiGet<{ moviePath?: string }>(API_ROUTES.mulmoScript.movieStatus, { filePath: filePath.value });
    if (response.ok && response.data.moviePath) {
      moviePath.value = response.data.moviePath;
    }
    // ignore errors
  }

  // Reflect any generations that were already in flight when we
  // mounted (user switched away mid-generation and came back).
  for (const entry of Object.values(pendingForThisScript.value)) {
    reflectGenerationStart(entry);
  }
}

onMounted(initializeScript);
watch(() => props.selectedResult, initializeScript);

// Keep the view in sync with generations that started from a different
// view mount or a parallel tab. When a generation for this script
// disappears from session.pendingGenerations we reload the relevant
// artifact off disk; when one appears we mirror it into the local
// "rendering" state so spinners show even after a remount.
watch(pendingForThisScript, (now, prev = {}) => {
  for (const [mapKey, entry] of Object.entries(now)) {
    if (!(mapKey in prev)) reflectGenerationStart(entry);
  }
  for (const [mapKey, entry] of Object.entries(prev)) {
    if (!(mapKey in now)) {
      // Fire-and-forget: the watcher callback must stay sync so Vue
      // can batch multiple pendingGenerations updates. Swallow + log
      // so a failed reload doesn't surface as an unhandled rejection.
      reflectGenerationFinish(entry).catch((err) => {
        console.error("[presentMulmoScript] reload on finish failed:", err);
      });
    }
  }
});

function reflectGenerationStart(entry: PendingGeneration): void {
  if (entry.kind === GENERATION_KINDS.beatImage) {
    const idx = Number(entry.key);
    if (!renderedImages[idx]) renderState[idx] = "rendering";
  } else if (entry.kind === GENERATION_KINDS.beatAudio) {
    const idx = Number(entry.key);
    if (!beatAudios[idx]) audioState[idx] = "generating";
  } else if (entry.kind === GENERATION_KINDS.characterImage) {
    if (!charImages[entry.key]) charRenderState[entry.key] = "rendering";
  } else if (entry.kind === GENERATION_KINDS.movie) {
    movieGenerating.value = true;
  }
}

async function reflectGenerationFinish(entry: PendingGeneration): Promise<void> {
  if (entry.kind === GENERATION_KINDS.beatImage) {
    const idx = Number(entry.key);
    await loadExistingBeatImage(idx);
    if (renderState[idx] === "rendering") delete renderState[idx];
  } else if (entry.kind === GENERATION_KINDS.beatAudio) {
    const idx = Number(entry.key);
    await loadExistingBeatAudio(idx);
    if (audioState[idx] === "generating") delete audioState[idx];
  } else if (entry.kind === GENERATION_KINDS.characterImage) {
    await loadExistingCharacterImage(entry.key);
    if (charRenderState[entry.key] === "rendering") {
      delete charRenderState[entry.key];
    }
  } else if (entry.kind === GENERATION_KINDS.movie) {
    movieGenerating.value = false;
    await refreshMoviePath();
  }
}

async function refreshMoviePath(): Promise<void> {
  if (!filePath.value) return;
  const response = await apiGet<{ moviePath?: string }>(API_ROUTES.mulmoScript.movieStatus, { filePath: filePath.value });
  if (response.ok && response.data.moviePath) {
    moviePath.value = response.data.moviePath;
  }
}

async function generateMovie() {
  movieGenerating.value = true;
  try {
    const res = await apiFetchRaw(API_ROUTES.mulmoScript.generateMovie, {
      method: "POST",
      body: JSON.stringify({
        filePath: filePath.value,
        chatSessionId: chatSessionId.value,
      }),
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok || !res.body) throw new Error("Generation failed");
    await streamMovieEvents(res.body, {
      onBeatImageDone: (beatIndex) => {
        loadExistingBeatImage(beatIndex);
        refreshMissingCharacterImages();
      },
      onBeatAudioDone: (beatIndex) => loadExistingBeatAudio(beatIndex),
      onDone: (path) => {
        moviePath.value = path;
      },
    });
  } catch (err) {
    alert(extractErrorMessage(err));
  } finally {
    movieGenerating.value = false;
  }
}
</script>

<style scoped>
.bottom-bar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.script-source {
  padding: 0.5rem;
  background: #f5f5f5;
  border-top: 1px solid #e0e0e0;
  font-family: monospace;
  font-size: 0.85rem;
}

.script-source summary {
  cursor: pointer;
  user-select: none;
  padding: 0.5rem;
  background: #e8e8e8;
  border-radius: 4px;
  font-weight: 500;
  color: #333;
}

.script-source[open] summary {
  margin-bottom: 0.5rem;
}

.script-source summary:hover {
  background: #d8d8d8;
}

.script-editor {
  width: 100%;
  height: 40vh;
  padding: 1rem;
  background: #ffffff;
  border: 1px solid #ccc;
  border-radius: 4px;
  color: #333;
  font-family: "Courier New", monospace;
  font-size: 0.9rem;
  resize: vertical;
  margin-bottom: 0.5rem;
  line-height: 1.5;
}

.script-editor:focus {
  outline: none;
  border-color: #4caf50;
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.1);
}

.script-editor-invalid {
  border-color: #ef4444;
}

.script-editor-invalid:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.1);
}

.editor-actions {
  display: flex;
  justify-content: space-between;
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

.apply-btn:disabled {
  background: #cccccc;
  color: #666666;
  cursor: not-allowed;
  opacity: 0.6;
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
</style>
