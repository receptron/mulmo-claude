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
      </div>
      <div class="ml-4 shrink-0 flex gap-2">
        <!-- Generate / Download Movie -->
        <a
          v-if="moviePath"
          :href="`/api/mulmo-script/download-movie?moviePath=${encodeURIComponent(moviePath)}`"
          download
          class="px-3 py-1.5 text-xs rounded border border-green-400 text-green-600 hover:bg-green-50"
        >
          Download Movie
        </a>
        <button
          v-else
          class="px-3 py-1.5 text-xs rounded border flex items-center gap-1.5"
          :class="
            movieGenerating
              ? 'border-gray-200 text-gray-400 cursor-not-allowed'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          "
          :disabled="movieGenerating"
          @click="generateMovie"
        >
          <svg
            v-if="movieGenerating"
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
          {{ movieGenerating ? "Generating…" : "Generate Movie" }}
        </button>

        <button
          class="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
          @click="downloadJson"
        >
          Download JSON
        </button>
      </div>
    </div>

    <!-- Beat list -->
    <div class="flex-1 overflow-y-auto p-2 space-y-1.5">
      <div
        v-for="(beat, index) in beats"
        :key="index"
        class="rounded-lg border border-gray-200 overflow-hidden"
      >
        <!-- Beat body: thumbnail + narration side by side -->
        <div class="flex gap-3 items-stretch">
          <!-- Thumbnail -->
          <div class="shrink-0 w-[45%] overflow-hidden bg-gray-50">
            <img
              v-if="renderedImages[index]"
              :src="renderedImages[index]"
              class="w-full object-contain"
              :alt="`Beat ${index + 1}`"
            />
            <div
              v-else
              class="w-full aspect-video flex flex-col items-center justify-center gap-1 p-2"
            >
              <template v-if="renderState[index] === 'rendering'">
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
                <span class="text-xs text-gray-300">{{
                  beat.image?.type ?? "—"
                }}</span>
              </template>
            </div>
          </div>

          <!-- Narration text -->
          <div class="flex flex-col flex-1 min-w-0 px-2 py-1.5">
            <span class="text-sm text-gray-800 leading-relaxed">{{
              effectiveBeat(index).text
            }}</span>
            <div class="flex justify-end mt-auto pt-1">
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { MulmoScriptData } from "./index";
import { mulmoBeatSchema } from "@mulmocast/types";

interface Beat {
  speaker?: string;
  text?: string;
  id?: string;
  image?: { type: string; [key: string]: unknown };
}

interface MulmoScript {
  title?: string;
  description?: string;
  lang?: string;
  beats?: Beat[];
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
  } catch (err) {
    renderErrors[index] = err instanceof Error ? err.message : String(err);
    renderState[index] = "error";
  }
}

onMounted(() => {
  beats.value.forEach((beat, index) => {
    const AUTO_RENDER_TYPES = [
      "textSlide",
      "markdown",
      "chart",
      "mermaid",
      "html_tailwind",
    ];
    if (beat.image?.type && AUTO_RENDER_TYPES.includes(beat.image.type)) {
      renderBeat(index);
    }
  });
});

async function generateMovie() {
  movieGenerating.value = true;
  try {
    const res = await fetch("/api/mulmo-script/generate-movie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: filePath.value }),
    });
    const json = await res.json();
    if (!res.ok || json.error)
      throw new Error(json.error ?? "Generation failed");
    moviePath.value = json.moviePath;
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  } finally {
    movieGenerating.value = false;
  }
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(script.value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = filePath.value.split("/").pop() ?? "script.json";
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
</script>
