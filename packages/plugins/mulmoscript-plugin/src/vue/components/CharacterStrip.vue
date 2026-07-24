<template>
  <div class="border-b border-gray-100 shrink-0 px-4 py-3">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ m.characters }}</span>
      <button
        class="px-2 py-0.5 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        :disabled="busy || characterKeys.every((key) => renderState[key] === 'rendering')"
        @click="emit('generateAll')"
      >
        {{ m.generateAll }}
      </button>
    </div>
    <div class="flex gap-3 flex-wrap">
      <div v-for="key in characterKeys" :key="key" class="flex flex-col items-center gap-1 w-36">
        <!-- Character thumbnail -->
        <div
          class="relative w-36 h-36 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center transition-colors"
          :class="dragOver[key] ? 'border-blue-400 bg-blue-50' : 'border-gray-200'"
          @dragover="emit('charDragOver', $event, key)"
          @dragleave="emit('charDragLeave', key)"
          @drop="emit('charDrop', $event, key)"
        >
          <img v-if="thumbnails[key]" :src="thumbnails[key]" class="w-full h-full object-cover cursor-zoom-in" :alt="key" @click="emit('openLightbox', key)" />
          <template v-else-if="renderState[key] === 'rendering'">
            <svg class="animate-spin w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </template>
          <template v-else-if="renderState[key] === 'error'">
            <span class="text-xs text-red-400 text-center px-1">{{ errors[key] }}</span>
          </template>
          <template v-else>
            <span class="text-xs text-gray-300 text-center px-1 leading-tight">{{ characterPrompt(images, key) }}</span>
          </template>
          <!-- Permanent drop hint -->
          <div v-if="!dragOver[key]" class="absolute bottom-0 inset-x-0 text-center text-xs text-gray-400 bg-white/70 py-0.5 pointer-events-none">
            {{ m.orDropImage }}
          </div>
          <!-- Drop overlay -->
          <div v-if="dragOver[key]" class="absolute inset-0 flex items-center justify-center bg-blue-50/80 pointer-events-none">
            <span class="text-xs text-blue-500 font-medium">{{ m.drop }}</span>
          </div>
          <!-- Regenerate button -->
          <button
            v-if="thumbnails[key] && renderState[key] !== 'rendering'"
            class="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded border bg-white"
            :class="busy ? 'border-yellow-400 text-yellow-500 cursor-not-allowed' : 'border-gray-400 text-gray-600 hover:bg-gray-50'"
            :disabled="busy"
            @click.stop="emit('renderCharacter', key, true)"
          >
            <span v-if="busy" class="inline-block animate-spin">↺</span>
            <span v-else>↺</span>
          </button>
          <!-- Generate button -->
          <button
            v-else-if="!thumbnails[key] && renderState[key] !== 'rendering'"
            class="absolute top-0.5 right-0.5 px-1 py-0.5 text-xs rounded border bg-white"
            :class="busy ? 'border-yellow-400 text-yellow-500 cursor-not-allowed' : 'border-blue-400 text-blue-600 hover:bg-blue-50'"
            :disabled="busy"
            @click.stop="emit('renderCharacter', key, false)"
          >
            <svg v-if="busy" class="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span v-else>{{ m.gen }}</span>
          </button>
        </div>
        <span class="text-xs text-gray-600 text-center truncate w-full">{{ key }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// `imageParams.images` character thumbnails: drag-and-drop upload, per-character
// render, and generate-all. Pure Tailwind — the parent's `<style scoped>` block
// only targets the bottom-bar region, so nothing here relies on styles that stop
// at the component boundary. The `char` prefix the parent uses to disambiguate
// character state from beat state is redundant inside this component.
import { computed } from "vue";
import { characterPrompt } from "../helpers";
import type { ImageEntry } from "../viewTypes";
import { useT } from "../../lang/index";

const m = useT();

const props = defineProps<{
  characterKeys: string[];
  images: Record<string, ImageEntry> | undefined;
  thumbnails: Record<string, string>;
  renderState: Record<string, string>;
  errors: Record<string, string>;
  dragOver: Record<string, boolean>;
  movieGenerating: boolean;
  anyBeatRendering: boolean;
}>();

const emit = defineEmits<{
  generateAll: [];
  charDragOver: [event: DragEvent, key: string];
  charDragLeave: [key: string];
  charDrop: [event: DragEvent, key: string];
  openLightbox: [key: string];
  renderCharacter: [key: string, force: boolean];
}>();

// A movie render or any in-flight beat render locks every per-character
// action — the generated frames must not change underneath them.
const busy = computed(() => props.movieGenerating || props.anyBeatRendering);
</script>
