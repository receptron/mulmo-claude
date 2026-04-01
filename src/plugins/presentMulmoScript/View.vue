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
      <button
        class="ml-4 shrink-0 px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
        @click="downloadJson"
      >
        Download JSON
      </button>
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
          <div
            v-if="beat.text"
            class="flex flex-col flex-1 min-w-0 px-2 py-1.5"
          >
            <span class="text-sm text-gray-800 leading-relaxed">{{
              beat.text
            }}</span>
            <div class="flex justify-end mt-auto pt-1">
              <button
                class="text-gray-400 hover:text-gray-600"
                :title="sourceOpen[index] ? 'Hide source' : 'Show source'"
                @click="sourceOpen[index] = !sourceOpen[index]"
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

        <!-- Source view -->
        <div v-if="sourceOpen[index]" class="border-t border-gray-100">
          <pre
            class="text-xs text-gray-600 bg-gray-50 p-2 overflow-x-auto whitespace-pre-wrap break-all"
            >{{ JSON.stringify(beat, null, 2) }}</pre
          >
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
import { computed, onMounted, reactive } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { MulmoScriptData } from "./index";

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

const props = defineProps<{ selectedResult: ToolResultComplete }>();

const data = computed(
  () => props.selectedResult.data as MulmoScriptData | undefined,
);
const script = computed<MulmoScript>(
  () => (data.value?.script as MulmoScript) ?? {},
);
const filePath = computed(() => data.value?.filePath ?? "");
const beats = computed<Beat[]>(() => script.value.beats ?? []);

// Per-beat render state
type RenderState = "idle" | "rendering" | "done" | "error";
const renderState = reactive<Record<number, RenderState>>({});
const renderedImages = reactive<Record<number, string>>({});
const renderErrors = reactive<Record<number, string>>({});
const sourceOpen = reactive<Record<number, boolean>>({});

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
