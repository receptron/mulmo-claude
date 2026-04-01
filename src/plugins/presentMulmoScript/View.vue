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
    <div class="flex-1 overflow-y-auto p-4 space-y-3">
      <div
        v-for="(beat, index) in beats"
        :key="index"
        class="rounded-lg border border-gray-200 overflow-hidden"
      >
        <!-- Beat header -->
        <div
          class="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200"
        >
          <span class="text-xs font-mono text-gray-400 w-5 text-right shrink-0">
            {{ index + 1 }}
          </span>
          <span
            class="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
            :class="badgeClass(beat.image?.type)"
          >
            {{ beat.image?.type || "no image" }}
          </span>
          <span class="text-xs text-gray-500 shrink-0">{{
            beat.speaker || "Presenter"
          }}</span>
          <span v-if="beat.id" class="text-xs text-gray-400 font-mono ml-auto"
            >#{{ beat.id }}</span
          >
        </div>

        <!-- Beat body -->
        <div class="px-4 py-3 space-y-2">
          <!-- textSlide: show rendered image if available, else slide text + spinner -->
          <template v-if="beat.image?.type === 'textSlide'">
            <div v-if="renderedImages[index]" class="rounded overflow-hidden">
              <img
                :src="renderedImages[index]"
                class="w-full object-contain"
                :alt="`Beat ${index + 1}`"
              />
            </div>
            <div v-else class="text-sm text-gray-700">
              <div class="font-semibold">
                {{ beat.image.slide?.title }}
              </div>
              <div
                v-if="beat.image.slide?.subtitle"
                class="text-gray-500 text-xs"
              >
                {{ beat.image.slide.subtitle }}
              </div>
              <ul
                v-if="beat.image.slide?.bullets?.length"
                class="mt-1 space-y-0.5"
              >
                <li
                  v-for="(b, bi) in beat.image.slide.bullets"
                  :key="bi"
                  class="text-xs text-gray-600 flex gap-1"
                >
                  <span class="text-gray-400">•</span>{{ b }}
                </li>
              </ul>
            </div>
            <!-- Render status -->
            <div class="flex items-center gap-1.5 text-xs">
              <template v-if="renderState[index] === 'rendering'">
                <svg
                  class="animate-spin w-3 h-3 text-green-500 shrink-0"
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
                <span class="text-green-600">Rendering…</span>
              </template>
              <template v-else-if="renderState[index] === 'done'">
                <span class="text-green-500">✓</span>
                <span class="text-gray-400">Image ready</span>
              </template>
              <template v-else-if="renderState[index] === 'error'">
                <span class="text-red-400">✕</span>
                <span class="text-red-400">{{ renderErrors[index] }}</span>
              </template>
            </div>
          </template>

          <!-- Other image types -->
          <div
            v-else-if="beat.image && beat.image.type !== 'textSlide'"
            class="text-sm text-gray-700"
          >
            <template v-if="beat.image.type === 'markdown'">
              <div
                class="text-xs font-mono text-gray-600 bg-gray-50 rounded p-2 line-clamp-4 whitespace-pre-wrap"
              >
                {{ markdownPreview(beat.image.markdown) }}
              </div>
            </template>

            <template
              v-else-if="
                beat.image.type === 'imagePrompt' ||
                beat.image.type === 'moviePrompt'
              "
            >
              <div class="text-xs text-gray-600 italic line-clamp-3">
                "{{ beat.image.prompt }}"
              </div>
            </template>

            <template v-else-if="beat.image.type === 'mermaid'">
              <div class="font-semibold text-xs">{{ beat.image.title }}</div>
            </template>

            <template v-else-if="beat.image.type === 'chart'">
              <div class="font-semibold text-xs">{{ beat.image.title }}</div>
            </template>

            <template v-else>
              <div class="text-xs text-gray-400 italic">
                {{ beat.image.type }}
              </div>
            </template>
          </div>

          <!-- Divider -->
          <div
            v-if="beat.image && beat.text"
            class="border-t border-gray-100"
          />

          <!-- Narration text -->
          <div v-if="beat.text" class="text-sm text-gray-800 leading-relaxed">
            {{ beat.text }}
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
import { computed, onMounted, reactive } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { MulmoScriptData } from "./index";

interface Beat {
  speaker?: string;
  text?: string;
  id?: string;
  image?: {
    type: string;
    markdown?: string | string[];
    slide?: { title: string; subtitle?: string; bullets?: string[] };
    prompt?: string;
    title?: string;
    [key: string]: unknown;
  };
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
    if (beat.image?.type === "textSlide") {
      renderBeat(index);
    }
  });
});

const TYPE_BADGE: Record<string, string> = {
  markdown: "bg-blue-100 text-blue-700",
  textSlide: "bg-green-100 text-green-700",
  imagePrompt: "bg-purple-100 text-purple-700",
  moviePrompt: "bg-orange-100 text-orange-700",
  mermaid: "bg-teal-100 text-teal-700",
  chart: "bg-yellow-100 text-yellow-700",
  html_tailwind: "bg-pink-100 text-pink-700",
};

function badgeClass(type?: string): string {
  return TYPE_BADGE[type ?? ""] ?? "bg-gray-100 text-gray-600";
}

function markdownPreview(markdown?: string | string[]): string {
  if (!markdown) return "";
  const raw = Array.isArray(markdown) ? markdown.join("\n") : markdown;
  return raw.slice(0, 300);
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
