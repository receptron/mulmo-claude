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
          <span>{{ t("pluginMulmoScript.beatCount", beats.length, { named: { count: beats.length } }) }}</span>
          <span v-if="script.lang">{{ script.lang }}</span>
          <span v-if="filePath" class="truncate">{{ filePath }}</span>
        </div>
      </div>
      <div class="ml-4 shrink-0 flex items-center gap-2">
        <!-- Play presentation: opens the lightbox at beat 0 and starts
             audio. Same gating as Download Movie — only when a movie has
             been generated, which is our proxy for "every beat has both
             an image and audio on disk". Green outline + green icon
             share the visual idiom with the (filled) Download button so
             both completed-artifact actions read as the same family.
             `isPlayReady` ensures we don't open the lightbox before the
             first beat's image (and audio, if it has text) finish their
             async load — moviePath can be set while loadExistingBeatImage
             is still in flight. -->
        <button
          v-if="moviePath && !movieGenerating"
          class="h-8 w-8 flex items-center justify-center rounded border border-green-600 text-green-600 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :disabled="!isPlayReady"
          :title="t('pluginMulmoScript.playPresentation')"
          :aria-label="t('pluginMulmoScript.playPresentation')"
          @click="playPresentation"
        >
          <span class="material-icons text-base">play_arrow</span>
        </button>
        <!-- Download Movie: bearer-authenticated blob fetch, then a
             synthetic <a download> click. The natural <a href download>
             approach can't attach the Authorization header, which would
             have forced a bearer-auth exemption on the route — the
             reviewer's P1 was that any sibling process could then read
             a caller-controlled movie path. Going through apiFetchRaw
             (auto-attaches bearer) keeps the auth boundary intact. -->
        <button
          v-if="moviePath && !movieGenerating"
          class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          :disabled="movieDownloading"
          data-testid="mulmo-script-download-movie-button"
          @click="downloadMovie"
        >
          <span class="material-icons text-base">download</span>
          <span>{{ t("pluginMulmoScript.movie") }}</span>
        </button>
        <!-- Regenerate Movie (icon-only): collapses to a square once a
             movie exists — the adjacent Download / Play already make
             the subject clear, so the "Movie" label only adds noise. -->
        <button
          v-if="moviePath && !movieGenerating"
          class="h-8 w-8 flex items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
          :title="t('pluginMulmoScript.regenerateMovie')"
          :aria-label="t('pluginMulmoScript.regenerateMovie')"
          data-testid="mulmo-script-regenerate-movie-button"
          @click="generateMovie"
        >
          <span class="material-icons text-base">refresh</span>
        </button>
        <!-- Generate Movie (pill): no movie yet, or one is currently
             generating. Keeps the label so first-time users know what
             they're triggering. -->
        <button
          v-else
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :disabled="movieGenerating"
          data-testid="mulmo-script-generate-movie-button"
          @click="generateMovie"
        >
          <svg v-if="movieGenerating" class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span v-if="movieGenerating">{{ t("pluginMulmoScript.generating") }}</span>
          <template v-else>
            <span class="material-icons text-sm">refresh</span>
            <span>{{ t("pluginMulmoScript.movie") }}</span>
          </template>
        </button>
      </div>
    </div>

    <!-- Characters section -->
    <div v-if="characterKeys.length > 0" class="border-b border-gray-100 shrink-0 px-4 py-3">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t("pluginMulmoScript.characters") }}</span>
        <button
          class="px-2 py-0.5 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          :disabled="movieGenerating || anyBeatRendering || characterKeys.every((key) => charRenderState[key] === 'rendering')"
          @click="generateAllCharacters"
        >
          {{ t("pluginMulmoScript.generateAll") }}
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
              {{ t("pluginMulmoScript.orDropImage") }}
            </div>
            <!-- Drop overlay -->
            <div v-if="charDragOver[key]" class="absolute inset-0 flex items-center justify-center bg-blue-50/80 pointer-events-none">
              <span class="text-xs text-blue-500 font-medium">{{ t("pluginMulmoScript.drop") }}</span>
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
              <span v-else>{{ t("pluginMulmoScript.gen") }}</span>
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
                <span class="text-xs text-green-500">{{ t("pluginMulmoScript.rendering") }}</span>
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
              <span class="text-xs text-blue-500 font-medium">{{ t("pluginMulmoScript.drop") }}</span>
            </div>
            <div
              v-else-if="!renderedImages[index] && renderState[index] !== 'rendering'"
              class="absolute bottom-0 inset-x-0 text-center text-xs text-gray-400 bg-white/70 py-0.5 pointer-events-none"
            >
              {{ t("pluginMulmoScript.orDropImage") }}
            </div>
            <!-- Generate button for imagePrompt beats -->
            <button
              v-if="effectiveBeat(index).imagePrompt && !renderedImages[index] && renderState[index] !== 'rendering' && !movieGenerating"
              class="absolute top-1.5 right-1.5 flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-blue-400 text-blue-600 bg-white hover:bg-blue-50"
              @click="renderBeat(index)"
            >
              {{ t("pluginMulmoScript.generate") }}
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
                  {{ playingAudio?.index === index ? t("pluginMulmoScript.stop") : t("pluginMulmoScript.play") }}
                </button>
                <template v-else-if="audioErrors[index]">
                  <span class="text-xs text-red-400 truncate min-w-0 max-w-[20rem]" :title="audioErrors[index]">
                    {{ t("pluginMulmoScript.errPrefix") }} {{ audioErrors[index] }}
                  </span>
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
                  {{ t("pluginMulmoScript.generateAudio") }}
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
            <span v-if="beatSaveErrors[index]" class="text-xs text-red-600" role="alert">{{
              t(beatSaveErrors[index].kind === "invalidJson" ? "pluginMulmoScript.saveErrorInvalidJson" : "pluginMulmoScript.saveErrorSaveFailed", {
                error: beatSaveErrors[index].error,
              })
            }}</span>
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
              {{ beatSaving[index] ? t("pluginMulmoScript.saving") : t("pluginMulmoScript.update") }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="beats.length === 0" class="flex items-center justify-center h-32 text-gray-400 text-sm">{{ t("pluginMulmoScript.noBeats") }}</div>
    </div>

    <!-- Bottom bar: Edit Script Source + Copy -->
    <div class="bottom-bar-wrapper">
      <details ref="sourceDetails" class="script-source" @toggle="onSourceToggle(($event.target as HTMLDetailsElement).open)">
        <summary>{{ t("pluginMulmoScript.editSource") }}</summary>
        <textarea
          v-model="editableSource"
          class="script-editor"
          :class="{ 'script-editor-invalid': sourceChanged && !sourceValid }"
          spellcheck="false"
        ></textarea>
        <div class="editor-actions">
          <button class="apply-btn" :disabled="!sourceChanged || !sourceValid" @click="applySource">{{ t("pluginMulmoScript.applyChanges") }}</button>
          <button class="cancel-btn" @click="cancelSourceEdit">{{ t("common.cancel") }}</button>
        </div>
      </details>
      <button v-show="!editing" class="copy-btn" :title="copied ? 'Copied!' : 'Copy'" @click="copyText">
        <span class="material-icons">{{ copied ? "check" : "content_copy" }}</span>
      </button>
    </div>

    <!-- Lightbox -->
    <div v-if="lightbox" class="fixed inset-0 z-50 bg-black/80 overflow-y-auto" @click="closeLightbox">
      <button class="fixed top-2 right-4 z-10 text-white/60 hover:text-white text-3xl leading-none" :title="t('common.close')" @click.stop="closeLightbox">
        ✕
      </button>
      <div class="flex flex-col items-center gap-4 pt-4 pb-8" @click.stop>
        <div class="flex items-center gap-4">
          <button
            v-if="!lightbox.isCharacter"
            class="text-white/60 hover:text-white disabled:opacity-20 text-5xl leading-none"
            :disabled="!hasPrev"
            @click="lightboxMove(-1)"
          >
            ‹
          </button>
          <div class="flex flex-col items-center">
            <img :src="lightbox.src" class="max-w-[80vw] max-h-[85vh] object-contain rounded shadow-2xl" />
            <div v-if="!lightbox.isCharacter && beats.length > 1" class="relative w-full h-1">
              <div class="flex gap-1 h-full">
                <div
                  v-for="i in beats.length"
                  :key="i - 1"
                  class="group flex-1 cursor-pointer relative transition-colors"
                  :class="
                    i - 1 === lightbox.index
                      ? 'bg-white/80 hover:bg-white'
                      : i - 1 < lightbox.index
                        ? 'bg-white/40 hover:bg-white/60'
                        : 'bg-white/20 hover:bg-white/40'
                  "
                  @click="jumpToBeat(i - 1)"
                >
                  <span class="absolute -inset-y-3 inset-x-0" />
                  <div
                    v-if="beatTooltip(i - 1)"
                    class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 px-2 py-1 rounded bg-black/90 text-white text-xs leading-tight w-48 max-h-[53px] overflow-hidden opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity"
                  >
                    {{ beatTooltip(i - 1) }}
                  </div>
                </div>
              </div>
              <div
                v-if="playingAudio && playingAudio.index === lightbox.index"
                class="absolute top-1/2 w-3.5 h-3.5 rounded-full bg-white shadow ring-2 ring-black/30 -translate-y-1/2 -translate-x-1/2 pointer-events-none"
                :style="{ left: `${((lightbox.index + audioProgress) / beats.length) * 100}%` }"
              />
            </div>
          </div>
          <button
            v-if="!lightbox.isCharacter"
            class="text-white/60 hover:text-white disabled:opacity-20 text-5xl leading-none"
            :disabled="!hasNext"
            @click="lightboxMove(1)"
          >
            ›
          </button>
        </div>
        <div v-if="lightbox.text || beatAudios[lightbox.index]" class="relative w-screen flex justify-center px-16">
          <p v-if="lightbox.text" class="max-w-[80vw] text-center text-white leading-relaxed text-[clamp(0.8rem,1.76vw,1.6rem)]">
            {{ lightbox.text }}
          </p>
          <button
            v-if="beatAudios[lightbox.index]"
            class="absolute top-0 right-4 text-sm px-3 py-1 rounded border border-white/60 text-white/60 hover:bg-white/20"
            @click="playAudio(lightbox.index)"
          >
            {{ playingAudio?.index === lightbox.index ? t("pluginMulmoScript.stop") : t("pluginMulmoScript.play") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
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

const { t } = useI18n();

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

// Per-beat render state
type RenderState = "idle" | "rendering" | "done" | "error";
const renderState = reactive<Record<number, RenderState>>({});
const renderedImages = reactive<Record<number, string>>({});
const renderErrors = reactive<Record<number, string>>({});
const sourceOpen = reactive<Record<number, boolean>>({});
const sourceText = reactive<Record<number, string>>({});
// Surface POST /api/mulmo-script/update-beat failures inline next to
// the Update button. Cleared on next successful save or editor close.
// Store raw error + kind tag so the template picks a localized key,
// instead of pre-composing an English-prefixed string here.
interface BeatSaveError {
  kind: "invalidJson" | "saveFailed";
  error: string;
}
const beatSaveErrors = reactive<Record<number, BeatSaveError>>({});
const beatSaving = reactive<Record<number, boolean>>({});
const localOverrides = reactive<Record<number, Beat>>({});
const movieGenerating = ref(false);
const movieDownloading = ref(false);
const moviePath = ref<string | null>(null);
const beatAudios = reactive<Record<number, string>>({});
const audioState = reactive<Record<number, "generating" | "done" | "error">>({});
const audioErrors = reactive<Record<number, string>>({});
const playingAudio = ref<{ index: number; audio: HTMLAudioElement } | null>(null);
const audioProgress = ref(0);
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

const anyBeatRendering = computed(() => Object.values(renderState).some((state) => state === "rendering"));

const characterKeys = computed(() => {
  const imgs = script.value.imageParams?.images ?? {};
  return Object.keys(imgs).filter((key) => imgs[key]?.type === "imagePrompt");
});

// Session-scoped pending generations — lets spinners survive view
// unmount/remount and tags new generations on the correct session
// channel so the cross-session sidebar indicator stays lit.
const activeSessionRef = useActiveSession();
const chatSessionId = computed(() => activeSessionRef?.value?.id);

const pendingForThisScript = computed(() => {
  const out: Record<string, PendingGeneration> = {};
  const pending = activeSessionRef?.value?.pendingGenerations ?? {};
  const currentPath = filePath.value;
  if (!currentPath) return out;
  for (const [mapKey, entry] of Object.entries(pending)) {
    if (entry.filePath === currentPath) out[mapKey] = entry;
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

function stopPlayingAudio() {
  if (!playingAudio.value) return;
  playingAudio.value.audio.pause();
  playingAudio.value = null;
  audioProgress.value = 0;
}

function openLightbox(index: number) {
  stopPlayingAudio();
  lightbox.value = {
    src: renderedImages[index],
    text: effectiveBeat(index).text,
    index,
  };
}

// Backdrop click handler. Stops any in-flight narration so the audio
// doesn't keep playing after the lightbox is dismissed — without this,
// the HTMLAudioElement created by playAudio() outlives the modal and
// the user hears disembodied narration with no UI to stop it.
function closeLightbox() {
  stopPlayingAudio();
  lightbox.value = null;
}

// "Play presentation" toolbar action. Opens the lightbox at beat 0 and
// kicks off its narration audio; the existing on-ended hook then chains
// through the rest of the deck (lightboxMove(1) → playAudio if the next
// beat has audio), so one click runs the whole presentation. Only wired
// to the toolbar button when moviePath is set, which is our proxy for
// "every beat has both image and audio on disk".
//
// `moviePath` arrives synchronously from /movie-status, but the per-beat
// image and audio data URIs are populated asynchronously by
// loadExistingBeatImage / loadExistingBeatAudio in initializeScript().
// The Play button can therefore become visible before beat 0's assets
// hydrate — `isPlayReady` gates the click so the lightbox never opens
// with an undefined src or silent narration on a beat that does have
// text.
const isPlayReady = computed<boolean>(() => {
  if (beats.value.length === 0) return false;
  if (!renderedImages[0]) return false;
  // Audio is only required when the beat has text (the source of TTS).
  // Beats without text are valid; they just play silently.
  if (effectiveBeat(0).text && !beatAudios[0]) return false;
  return true;
});

function playPresentation() {
  if (!isPlayReady.value) return;
  openLightbox(0);
  if (beatAudios[0]) playAudio(0);
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

function jumpToBeat(index: number) {
  if (!lightbox.value) return;
  if (index === lightbox.value.index) return;
  if (!renderedImages[index]) return;
  const wasPlaying = playingAudio.value !== null;
  openLightbox(index);
  if (wasPlaying && beatAudios[index]) {
    playAudio(index);
  }
}

function beatTooltip(index: number): string {
  const text = effectiveBeat(index).text ?? "";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function lightboxMove(delta: number) {
  if (!lightbox.value) return;
  const total = beats.value.length;
  // If audio was playing when the user clicked the arrow, carry the
  // playback over to the next beat that has audio. openLightbox()
  // unconditionally stops any active audio, so we capture the flag
  // BEFORE that and replay AFTER. The on-ended auto-advance path
  // already nulls playingAudio before calling lightboxMove, so this
  // branch won't double-fire there.
  const wasPlaying = playingAudio.value !== null;
  let i = lightbox.value.index + delta;
  while (i >= 0 && i < total) {
    if (renderedImages[i]) {
      openLightbox(i);
      if (wasPlaying && beatAudios[i]) {
        playAudio(i);
      }
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
    Reflect.deleteProperty(beatSaveErrors, index);
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
    beatSaveErrors[index] = { kind: "invalidJson", error: errorMessage(err) };
    return;
  }
  const prevImage = JSON.stringify(effectiveBeat(index).image);

  Reflect.deleteProperty(beatSaveErrors, index);
  beatSaving[index] = true;
  const response = await apiPost<unknown>(API_ROUTES.mulmoScript.updateBeat, {
    filePath: filePath.value,
    beatIndex: index,
    beat,
  });
  Reflect.deleteProperty(beatSaving, index);
  if (!response.ok) {
    beatSaveErrors[index] = { kind: "saveFailed", error: response.error };
    return;
  }

  localOverrides[index] = beat;
  sourceOpen[index] = false;

  if (JSON.stringify(beat.image) !== prevImage) {
    Reflect.deleteProperty(renderedImages, index);
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
  Reflect.deleteProperty(renderedImages, index);
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
  Reflect.deleteProperty(audioErrors, index);
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
  audioProgress.value = 0;
  audio.addEventListener("timeupdate", () => {
    if (playingAudio.value?.index !== index) return;
    if (audio.duration > 0) audioProgress.value = audio.currentTime / audio.duration;
  });
  audio.addEventListener("ended", () => {
    if (playingAudio.value?.index !== index) return;
    playingAudio.value = null;
    audioProgress.value = 0;
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
  Reflect.deleteProperty(renderErrors, index);
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
  Reflect.deleteProperty(charErrors, key);
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
  getMissingCharacterKeys(characterKeys.value, charImages, charRenderState).forEach((key) => loadExistingCharacterImage(key));
}

async function renderCharacter(key: string, force: boolean) {
  charRenderState[key] = "rendering";
  Reflect.deleteProperty(charErrors, key);
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
  await Promise.all(characterKeys.value.filter((key) => charRenderState[key] !== "rendering").map((key) => renderCharacter(key, false)));
}

// Probe the server for an existing beat PNG before triggering any
// generation. Only auto-renders when the disk is empty AND the beat
// is a deterministic type — imagePrompt beats are left empty so the
// user clicks Generate explicitly (avoids surprise paid text2image
// calls on every page refresh).
async function hydrateBeatImage(beat: Beat, index: number, hasCharacters: boolean, autoRenderTypes: readonly string[]): Promise<void> {
  await loadExistingBeatImage(index);
  if (renderedImages[index]) return;
  if (shouldAutoRenderBeat(beat, hasCharacters, autoRenderTypes)) {
    await renderBeat(index);
  }
}

async function initializeScript() {
  // Reset scroll position so new results start at the top
  if (beatListEl.value) beatListEl.value.scrollTop = 0;
  // Reset per-script state
  Object.keys(renderState).forEach((key) => Reflect.deleteProperty(renderState, key));
  Object.keys(renderedImages).forEach((key) => Reflect.deleteProperty(renderedImages, key));
  Object.keys(renderErrors).forEach((key) => Reflect.deleteProperty(renderErrors, key));
  Object.keys(sourceOpen).forEach((key) => Reflect.deleteProperty(sourceOpen, key));
  Object.keys(sourceText).forEach((key) => Reflect.deleteProperty(sourceText, key));
  Object.keys(beatSaveErrors).forEach((key) => Reflect.deleteProperty(beatSaveErrors, key));
  Object.keys(beatSaving).forEach((key) => Reflect.deleteProperty(beatSaving, key));
  Object.keys(localOverrides).forEach((key) => Reflect.deleteProperty(localOverrides, key));
  Object.keys(beatAudios).forEach((key) => Reflect.deleteProperty(beatAudios, key));
  Object.keys(audioState).forEach((key) => Reflect.deleteProperty(audioState, key));
  Object.keys(audioErrors).forEach((key) => Reflect.deleteProperty(audioErrors, key));
  Object.keys(charRenderState).forEach((key) => Reflect.deleteProperty(charRenderState, key));
  Object.keys(charImages).forEach((key) => Reflect.deleteProperty(charImages, key));
  Object.keys(charErrors).forEach((key) => Reflect.deleteProperty(charErrors, key));
  Object.keys(beatDragOver).forEach((key) => Reflect.deleteProperty(beatDragOver, key));
  moviePath.value = null;
  if (sourceDetails.value) sourceDetails.value.open = false;

  // Mount-time policy: prefer the existing PNG on the server. Every
  // beat — deterministic AND imagePrompt — first probes /beat-image,
  // and we only fall through to renderBeat() when the disk has nothing
  // yet AND the type is safe to auto-render (deterministic content,
  // no characters waiting). Without this probe a refresh would re-fire
  // generateBeatImage for every beat, and for imagePrompt beats that
  // means a paid text2image call against an image we already have.
  //
  // Stale-after-edit: if the user edits the script source the on-disk
  // PNG is no longer in sync with the new content, but we don't try to
  // detect that here — the per-beat ↺ button is one click away and a
  // page refresh re-runs this same probe, so the user can opt back into
  // a fresh render whenever they need to.
  const AUTO_RENDER_TYPES = ["textSlide", "markdown", "chart", "mermaid", "html_tailwind"] as const;
  const hasCharacters = characterKeys.value.length > 0;
  beats.value.forEach((beat, index) => {
    void hydrateBeatImage(beat, index, hasCharacters, AUTO_RENDER_TYPES);
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
    if (renderState[idx] === "rendering") Reflect.deleteProperty(renderState, idx);
  } else if (entry.kind === GENERATION_KINDS.beatAudio) {
    const idx = Number(entry.key);
    await loadExistingBeatAudio(idx);
    if (audioState[idx] === "generating") Reflect.deleteProperty(audioState, idx);
  } else if (entry.kind === GENERATION_KINDS.characterImage) {
    await loadExistingCharacterImage(entry.key);
    if (charRenderState[entry.key] === "rendering") {
      Reflect.deleteProperty(charRenderState, entry.key);
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

// Bearer-authenticated movie download. apiFetchRaw auto-attaches the
// Authorization header (which a plain `<a href download>` cannot), so
// the route stays behind the standard /api/* bearer guard. The blob
// is hooked to a synthetic anchor whose `download` attribute carries
// the filename — the browser still surfaces a native save dialog.
async function downloadMovie() {
  if (!moviePath.value || movieDownloading.value) return;
  movieDownloading.value = true;
  let objectUrl: string | null = null;
  try {
    const res = await apiFetchRaw(API_ROUTES.mulmoScript.downloadMovie, {
      method: "GET",
      query: { moviePath: moviePath.value },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);
    const filename = moviePath.value.split("/").pop() ?? "movie.mp4";
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (err) {
    alert(extractErrorMessage(err));
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    movieDownloading.value = false;
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
