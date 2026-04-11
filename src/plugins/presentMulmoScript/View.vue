<template>
  <div class="h-full bg-white flex flex-col overflow-hidden">
    <!-- Header -->
    <div
      class="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0"
    >
      <div class="min-w-0 flex-1">
        <h2 class="text-lg font-semibold text-gray-800 truncate">
          {{ script.title || "Untitled Script" }}
        </h2>
        <p
          v-if="script.description"
          class="text-sm text-gray-500 mt-0.5 truncate"
        >
          {{ script.description }}
        </p>
        <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
          <span
            >{{ beats.length }} beat{{ beats.length !== 1 ? "s" : "" }}</span
          >
          <span v-if="script.lang">{{ script.lang }}</span>
          <span v-if="filePath" class="truncate">{{ filePath }}</span>
        </div>
        <button
          class="mt-2 px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 self-start"
          @click="toggleScriptSource"
        >
          {{ scriptSourceOpen ? "Hide Source <>" : "Show Source <>" }}
        </button>
      </div>
      <div class="ml-4 shrink-0 flex gap-2">
        <!-- Download Movie -->
        <a
          v-if="moviePath && !movieGenerating"
          :href="`/api/mulmo-script/download-movie?moviePath=${encodeURIComponent(moviePath)}`"
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
          <svg
            v-if="movieGenerating"
            class="animate-spin w-3 h-3 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            />
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          <span v-if="movieGenerating">Generating…</span>
          <template v-else>
            <span class="material-icons text-sm leading-none">refresh</span>
            <span>Movie</span>
          </template>
        </button>
      </div>
    </div>

    <!-- Source code panel -->
    <div v-if="scriptSourceOpen" class="border-b border-gray-100 shrink-0">
      <textarea
        :value="scriptSourceText"
        readonly
        class="w-full text-xs text-gray-600 bg-gray-50 p-3 font-mono resize-none outline-none"
        rows="16"
        spellcheck="false"
      />
    </div>

    <!-- Characters section -->
    <div
      v-if="characterKeys.length > 0"
      class="border-b border-gray-100 shrink-0 px-4 py-3"
    >
      <div class="flex items-center justify-between mb-2">
        <span
          class="text-xs font-semibold text-gray-500 uppercase tracking-wide"
          >Characters</span
        >
        <button
          class="px-2 py-0.5 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          :disabled="
            movieGenerating ||
            anyBeatRendering ||
            characterKeys.every((k) => charRenderState[k] === 'rendering')
          "
          @click="generateAllCharacters"
        >
          Generate All
        </button>
      </div>
      <div class="flex gap-3 flex-wrap">
        <div
          v-for="key in characterKeys"
          :key="key"
          class="flex flex-col items-center gap-1 w-36"
        >
          <!-- Character thumbnail -->
          <div
            class="relative w-36 h-36 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center transition-colors"
            :class="
              charDragOver[key]
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-200'
            "
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
              <svg
                class="animate-spin w-4 h-4 text-green-400"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
            </template>
            <template v-else-if="charRenderState[key] === 'error'">
              <span class="text-xs text-red-400 text-center px-1">{{
                charErrors[key]
              }}</span>
            </template>
            <template v-else>
              <span
                class="text-xs text-gray-300 text-center px-1 leading-tight"
                >{{ characterPrompt(key) }}</span
              >
            </template>
            <!-- Permanent drop hint -->
            <div
              v-if="!charDragOver[key]"
              class="absolute bottom-0 inset-x-0 text-center text-xs text-gray-400 bg-white/70 py-0.5 pointer-events-none"
            >
              or drop image
            </div>
            <!-- Drop overlay -->
            <div
              v-if="charDragOver[key]"
              class="absolute inset-0 flex items-center justify-center bg-blue-50/80 pointer-events-none"
            >
              <span class="text-xs text-blue-500 font-medium">Drop</span>
            </div>
            <!-- Regenerate button -->
            <button
              v-if="charImages[key] && charRenderState[key] !== 'rendering'"
              class="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded border bg-white"
              :class="
                movieGenerating || anyBeatRendering
                  ? 'border-yellow-400 text-yellow-500 cursor-not-allowed'
                  : 'border-gray-400 text-gray-600 hover:bg-gray-50'
              "
              :disabled="movieGenerating || anyBeatRendering"
              @click.stop="renderCharacter(key, true)"
            >
              <span
                v-if="movieGenerating || anyBeatRendering"
                class="inline-block animate-spin"
                >↺</span
              >
              <span v-else>↺</span>
            </button>
            <!-- Generate button -->
            <button
              v-else-if="
                !charImages[key] && charRenderState[key] !== 'rendering'
              "
              class="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded border bg-white"
              :class="
                movieGenerating || anyBeatRendering
                  ? 'border-yellow-400 text-yellow-500 cursor-not-allowed'
                  : 'border-blue-400 text-blue-600 hover:bg-blue-50'
              "
              :disabled="movieGenerating || anyBeatRendering"
              @click.stop="renderCharacter(key, false)"
            >
              <svg
                v-if="movieGenerating || anyBeatRendering"
                class="animate-spin w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span v-else>Gen</span>
            </button>
          </div>
          <span class="text-xs text-gray-600 text-center truncate w-full">{{
            key
          }}</span>
        </div>
      </div>
    </div>

    <!-- Beat list -->
    <div ref="beatListEl" class="flex-1 overflow-y-auto p-2 space-y-1.5">
      <div
        v-for="(beat, index) in beats"
        :key="index"
        class="rounded-lg border border-gray-200 overflow-hidden"
      >
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
            <div
              v-else-if="!renderedImages[index]"
              class="w-full aspect-video flex flex-col items-center justify-center gap-1 p-2"
            >
              <template
                v-if="
                  renderState[index] === 'rendering' ||
                  (movieGenerating &&
                    !renderedImages[index] &&
                    effectiveBeat(index).imagePrompt)
                "
              >
                <svg
                  class="animate-spin w-4 h-4 text-green-400"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  />
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                <span class="text-xs text-green-500">Rendering…</span>
              </template>
              <template v-else-if="renderState[index] === 'error'">
                <span class="text-xs text-red-400 text-center">{{
                  renderErrors[index]
                }}</span>
              </template>
              <template v-else>
                <span
                  v-if="effectiveBeat(index).imagePrompt"
                  class="text-xs text-gray-400 text-center italic leading-relaxed px-1"
                  >{{ effectiveBeat(index).imagePrompt }}</span
                >
                <span v-else class="text-xs text-gray-300">{{
                  beat.image?.type ?? "—"
                }}</span>
              </template>
            </div>
            <!-- Beat drop hint / overlay -->
            <div
              v-if="beatDragOver[index]"
              class="absolute inset-0 flex items-center justify-center bg-blue-50/80 pointer-events-none"
            >
              <span class="text-xs text-blue-500 font-medium">Drop</span>
            </div>
            <div
              v-else-if="
                !renderedImages[index] && renderState[index] !== 'rendering'
              "
              class="absolute bottom-0 inset-x-0 text-center text-xs text-gray-400 bg-white/70 py-0.5 pointer-events-none"
            >
              or drop image
            </div>
            <!-- Generate button for imagePrompt beats -->
            <button
              v-if="
                effectiveBeat(index).imagePrompt &&
                !renderedImages[index] &&
                renderState[index] !== 'rendering' &&
                !movieGenerating
              "
              class="absolute top-1.5 right-1.5 flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-blue-400 text-blue-600 bg-white hover:bg-blue-50"
              @click="renderBeat(index)"
            >
              Generate
            </button>
          </div>

          <!-- Narration text -->
          <div class="flex flex-col flex-1 min-w-0 px-2 py-1.5">
            <span class="text-sm text-gray-800 leading-relaxed">{{
              effectiveBeat(index).text
            }}</span>
            <div class="flex justify-between mt-auto pt-1">
              <!-- Audio controls -->
              <div class="flex items-center gap-1">
                <template
                  v-if="
                    audioState[index] === 'generating' ||
                    (movieGenerating &&
                      !beatAudios[index] &&
                      effectiveBeat(index).text)
                  "
                >
                  <svg
                    class="animate-spin w-3 h-3 text-green-400"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    />
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                </template>
                <button
                  v-else-if="beatAudios[index]"
                  class="text-xs px-2 py-0.5 rounded border"
                  :class="
                    playingAudio?.index === index
                      ? 'border-red-400 text-red-600 hover:bg-red-50'
                      : 'border-green-400 text-green-600 hover:bg-green-50'
                  "
                  @click="playAudio(index)"
                >
                  {{ playingAudio?.index === index ? "■ Stop" : "▶ Play" }}
                </button>
                <template v-else-if="audioErrors[index]">
                  <span class="text-xs text-red-400" :title="audioErrors[index]"
                    >⚠ Error</span
                  >
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
              <button
                class="text-gray-400 hover:text-gray-600"
                :title="sourceOpen[index] ? 'Hide source' : 'Show source'"
                @click="toggleSource(index)"
              >
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
            class="w-full text-xs text-gray-600 bg-gray-50 p-2 font-mono resize-none outline-none"
            rows="8"
            spellcheck="false"
          />
          <div class="flex justify-end px-2 pb-2">
            <button
              class="px-2 py-1 text-xs rounded border"
              :class="
                isValidBeat(index)
                  ? 'border-blue-400 text-blue-600 hover:bg-blue-50 cursor-pointer'
                  : 'border-gray-200 text-gray-300 cursor-not-allowed'
              "
              :disabled="!isValidBeat(index)"
              @click="updateBeat(index)"
            >
              Update
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="beats.length === 0"
        class="flex items-center justify-center h-32 text-gray-400 text-sm"
      >
        No beats found in script
      </div>
    </div>

    <!-- Lightbox -->
    <div
      v-if="lightbox"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      @click="lightbox = null"
    >
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
          <img
            :src="lightbox.src"
            class="max-w-[80vw] max-h-[80vh] object-contain rounded shadow-2xl"
          />
          <div class="flex items-center gap-4">
            <p
              v-if="lightbox.text"
              class="max-w-[80vw] text-center text-white text-2xl leading-relaxed"
            >
              {{ lightbox.text }}
            </p>
            <button
              v-if="beatAudios[lightbox.index]"
              class="shrink-0 text-sm px-3 py-1 rounded border"
              :class="
                playingAudio?.index === lightbox.index
                  ? 'border-red-400 text-red-400 hover:bg-red-400/20'
                  : 'border-white/60 text-white/60 hover:bg-white/20'
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
import { mulmoBeatSchema } from "@mulmocast/types";

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
const localOverrides = reactive<Record<number, Beat>>({});
const movieGenerating = ref(false);
const moviePath = ref<string | null>(null);
const beatAudios = reactive<Record<number, string>>({});
const audioState = reactive<Record<number, "generating" | "done" | "error">>(
  {},
);
const audioErrors = reactive<Record<number, string>>({});
const playingAudio = ref<{ index: number; audio: HTMLAudioElement } | null>(
  null,
);
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

const anyBeatRendering = computed(() =>
  Object.values(renderState).some((s) => s === "rendering"),
);

const characterKeys = computed(() => {
  const imgs = script.value.imageParams?.images ?? {};
  return Object.keys(imgs).filter((k) => imgs[k]?.type === "imagePrompt");
});

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
const scriptSourceOpen = ref(false);
const scriptSourceText = computed(() => JSON.stringify(script.value, null, 2));

function toggleScriptSource() {
  scriptSourceOpen.value = !scriptSourceOpen.value;
}

function effectiveBeat(index: number): Beat {
  return localOverrides[index] ?? beats.value[index] ?? {};
}

function toggleSource(index: number) {
  if (!sourceOpen[index]) {
    sourceText[index] = JSON.stringify(effectiveBeat(index), null, 2);
  }
  sourceOpen[index] = !sourceOpen[index];
}

function isValidBeat(index: number): boolean {
  try {
    const parsed = JSON.parse(sourceText[index] ?? "");
    return mulmoBeatSchema.safeParse(parsed).success;
  } catch {
    return false;
  }
}

async function updateBeat(index: number) {
  const beat: Beat = JSON.parse(sourceText[index]);
  const prevImage = JSON.stringify(effectiveBeat(index).image);
  await fetch("/api/mulmo-script/update-beat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath: filePath.value, beatIndex: index, beat }),
  });
  localOverrides[index] = beat;

  if (JSON.stringify(beat.image) !== prevImage) {
    delete renderedImages[index];
    renderBeat(index);
  }
}

async function renderBeat(index: number) {
  renderState[index] = "rendering";
  try {
    const res = await fetch("/api/mulmo-script/render-beat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: filePath.value, beatIndex: index }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(json.error ?? "Render failed");
    }
    renderedImages[index] = json.image;
    renderState[index] = "done";
    refreshMissingCharacterImages();
  } catch (err) {
    renderErrors[index] = err instanceof Error ? err.message : String(err);
    renderState[index] = "error";
  }
}

async function regenerateBeat(index: number) {
  delete renderedImages[index];
  renderState[index] = "rendering";
  try {
    const res = await fetch("/api/mulmo-script/render-beat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: filePath.value,
        beatIndex: index,
        force: true,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error ?? "Render failed");
    renderedImages[index] = json.image;
    renderState[index] = "done";
  } catch (err) {
    renderErrors[index] = err instanceof Error ? err.message : String(err);
    renderState[index] = "error";
  }
}

async function loadExistingBeatImage(index: number) {
  try {
    const params = new URLSearchParams({
      filePath: filePath.value,
      beatIndex: String(index),
    });
    const res = await fetch(`/api/mulmo-script/beat-image?${params}`);
    const json = await res.json();
    if (json.image) {
      renderedImages[index] = json.image;
      renderState[index] = "done";
    }
  } catch {
    // silently ignore — image simply hasn't been generated yet
  }
}

async function loadExistingBeatAudio(index: number) {
  try {
    const params = new URLSearchParams({
      filePath: filePath.value,
      beatIndex: String(index),
    });
    const res = await fetch(`/api/mulmo-script/beat-audio?${params}`);
    const json = await res.json();
    if (json.audio) {
      beatAudios[index] = json.audio;
      audioState[index] = "done";
    }
  } catch {
    // silently ignore
  }
}

async function generateAudio(index: number) {
  audioState[index] = "generating";
  delete audioErrors[index];
  try {
    const res = await fetch("/api/mulmo-script/generate-beat-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: filePath.value, beatIndex: index }),
    });
    const json = await res.json();
    if (!res.ok || json.error)
      throw new Error(json.error ?? "Audio generation failed");
    beatAudios[index] = json.audio;
    audioState[index] = "done";
  } catch (err) {
    audioErrors[index] = err instanceof Error ? err.message : String(err);
    audioState[index] = "error";
  }
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
      if (
        nextIndex !== undefined &&
        nextIndex !== index &&
        beatAudios[nextIndex]
      ) {
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
  try {
    const imageData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const res = await fetch("/api/mulmo-script/upload-beat-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: filePath.value,
        beatIndex: index,
        imageData,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error ?? "Upload failed");
    renderedImages[index] = json.image;
    renderState[index] = "done";
  } catch (err) {
    renderErrors[index] = err instanceof Error ? err.message : String(err);
    renderState[index] = "error";
  }
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
  try {
    const imageData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const res = await fetch("/api/mulmo-script/upload-character-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: filePath.value, key, imageData }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error ?? "Upload failed");
    charImages[key] = json.image;
    charRenderState[key] = "done";
  } catch (err) {
    charErrors[key] = err instanceof Error ? err.message : String(err);
    charRenderState[key] = "error";
  }
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
  try {
    const params = new URLSearchParams({ filePath: filePath.value, key });
    const res = await fetch(`/api/mulmo-script/character-image?${params}`);
    const json = await res.json();
    if (json.image) {
      charImages[key] = json.image;
      charRenderState[key] = "done";
    }
  } catch {
    // silently ignore
  }
}

function refreshMissingCharacterImages() {
  characterKeys.value
    .filter((k) => !charImages[k] && charRenderState[k] !== "rendering")
    .forEach((k) => loadExistingCharacterImage(k));
}

async function renderCharacter(key: string, force: boolean) {
  charRenderState[key] = "rendering";
  delete charErrors[key];
  try {
    const res = await fetch("/api/mulmo-script/render-character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: filePath.value, key, force }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error ?? "Render failed");
    charImages[key] = json.image;
    charRenderState[key] = "done";
  } catch (err) {
    charErrors[key] = err instanceof Error ? err.message : String(err);
    charRenderState[key] = "error";
  }
}

async function generateAllCharacters() {
  await Promise.all(
    characterKeys.value
      .filter((k) => charRenderState[k] !== "rendering")
      .map((k) => renderCharacter(k, false)),
  );
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
  Object.keys(localOverrides).forEach((k) => delete localOverrides[+k]);
  Object.keys(beatAudios).forEach((k) => delete beatAudios[+k]);
  Object.keys(audioState).forEach((k) => delete audioState[+k]);
  Object.keys(audioErrors).forEach((k) => delete audioErrors[+k]);
  Object.keys(charRenderState).forEach((k) => delete charRenderState[k]);
  Object.keys(charImages).forEach((k) => delete charImages[k]);
  Object.keys(charErrors).forEach((k) => delete charErrors[k]);
  Object.keys(beatDragOver).forEach((k) => delete beatDragOver[+k]);
  moviePath.value = null;
  scriptSourceOpen.value = false;

  const AUTO_RENDER_TYPES = [
    "textSlide",
    "markdown",
    "chart",
    "mermaid",
    "html_tailwind",
  ];
  const hasCharacters = characterKeys.value.length > 0;
  beats.value.forEach((beat, index) => {
    if (
      !hasCharacters &&
      beat.image?.type &&
      AUTO_RENDER_TYPES.includes(beat.image.type)
    ) {
      renderBeat(index);
    } else if (beat.imagePrompt) {
      loadExistingBeatImage(index);
    }
    if (beat.text) loadExistingBeatAudio(index);
  });

  characterKeys.value.forEach((key) => loadExistingCharacterImage(key));

  if (filePath.value) {
    try {
      const params = new URLSearchParams({ filePath: filePath.value });
      const res = await fetch(`/api/mulmo-script/movie-status?${params}`);
      const json = await res.json();
      if (json.moviePath) moviePath.value = json.moviePath;
    } catch {
      // ignore
    }
  }
}

onMounted(initializeScript);
watch(() => props.selectedResult, initializeScript);

async function generateMovie() {
  movieGenerating.value = true;
  try {
    const res = await fetch("/api/mulmo-script/generate-movie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: filePath.value }),
    });
    if (!res.ok || !res.body) throw new Error("Generation failed");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "beat_image_done") {
          loadExistingBeatImage(event.beatIndex);
          refreshMissingCharacterImages();
        } else if (event.type === "beat_audio_done") {
          loadExistingBeatAudio(event.beatIndex);
        } else if (event.type === "done") {
          moviePath.value = event.moviePath;
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    }
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  } finally {
    movieGenerating.value = false;
  }
}
</script>
