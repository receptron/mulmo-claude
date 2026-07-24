<template>
  <div class="fixed inset-0 z-50 bg-black/80 overflow-y-auto" @click="emit('close')">
    <button class="fixed top-2 right-4 z-10 text-white/60 hover:text-white text-3xl leading-none" :title="m.close" @click.stop="emit('close')">✕</button>
    <div class="flex flex-col items-center gap-4 pt-4 pb-8" @click.stop>
      <div class="flex items-center gap-4">
        <button
          v-if="!lightbox.isCharacter"
          class="text-white/60 hover:text-white disabled:opacity-20 text-5xl leading-none"
          :disabled="!hasPrev"
          @click="emit('move', -1)"
        >
          ‹
        </button>
        <div class="flex flex-col items-center">
          <img :src="lightbox.src" class="max-w-[80vw] max-h-[85vh] object-contain rounded shadow-2xl" />
          <div v-if="!lightbox.isCharacter && beatCount > 1" class="relative w-full h-1">
            <div class="flex gap-1 h-full">
              <div
                v-for="i in beatCount"
                :key="i - 1"
                class="group flex-1 cursor-pointer relative transition-colors"
                :class="
                  i - 1 === lightbox.index
                    ? 'bg-white/80 hover:bg-white'
                    : i - 1 < lightbox.index
                      ? 'bg-white/40 hover:bg-white/60'
                      : 'bg-white/20 hover:bg-white/40'
                "
                @click="emit('jump', i - 1)"
              >
                <span class="absolute -inset-y-3 inset-x-0" />
                <div
                  v-if="beatTooltip(beatTexts[i - 1])"
                  class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 px-2 py-1 rounded bg-black/90 text-white text-xs leading-tight w-48 max-h-[53px] overflow-hidden opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity"
                >
                  {{ beatTooltip(beatTexts[i - 1]) }}
                </div>
              </div>
            </div>
            <div
              v-if="playingAudioIndex !== null && playingAudioIndex === lightbox.index"
              class="absolute top-1/2 w-3.5 h-3.5 rounded-full bg-white shadow ring-2 ring-black/30 -translate-y-1/2 -translate-x-1/2 pointer-events-none"
              :style="{ left: `${((lightbox.index + audioProgress) / beatCount) * 100}%` }"
            />
          </div>
        </div>
        <button
          v-if="!lightbox.isCharacter"
          class="text-white/60 hover:text-white disabled:opacity-20 text-5xl leading-none"
          :disabled="!hasNext"
          @click="emit('move', 1)"
        >
          ›
        </button>
      </div>
      <div v-if="lightbox.text || hasCurrentAudio" class="relative w-screen flex justify-center px-16">
        <p v-if="lightbox.text" class="max-w-[80vw] text-center text-white leading-relaxed text-[clamp(0.8rem,1.76vw,1.6rem)]">
          {{ lightbox.text }}
        </p>
        <button
          v-if="hasCurrentAudio"
          class="absolute top-0 right-4 text-sm px-3 py-1 rounded border border-white/60 text-white/60 hover:bg-white/20"
          @click="emit('playAudio', lightbox.index)"
        >
          {{ playingAudioIndex === lightbox.index ? m.stop : m.play }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Full-screen beat / character image viewer with the beat strip, prev-next
// arrows and the narration Play control. Pure Tailwind — the parent's
// `<style scoped>` block only targets the bottom-bar region, so nothing here
// relies on styles that stop at the component boundary.
//
// The parent owns `v-if="lightbox"`, so `lightbox` is never null in here and
// the template can read `.index` / `.src` without a guard.
import { beatTooltip } from "../helpers";
import type { LightboxState } from "../viewTypes";
import { useT } from "../../lang/index";

const m = useT();

defineProps<{
  lightbox: LightboxState;
  beatCount: number;
  beatTexts: (string | undefined)[];
  hasPrev: boolean;
  hasNext: boolean;
  playingAudioIndex: number | null;
  audioProgress: number;
  hasCurrentAudio: boolean;
}>();

const emit = defineEmits<{
  close: [];
  move: [delta: number];
  jump: [index: number];
  playAudio: [index: number];
}>();
</script>
