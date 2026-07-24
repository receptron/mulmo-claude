<template>
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
      :title="m.playPresentation"
      :aria-label="m.playPresentation"
      @click="emit('play')"
    >
      <span class="material-icons text-base">play_arrow</span>
    </button>
    <!-- Download Movie: authenticated blob fetch through the host
         adapter, then a synthetic <a download> click. A plain
         <a href download> can't attach the host's auth headers, which
         would have forced an auth exemption on the media route — the
         host-injected `fetchMediaBlob` keeps the auth boundary intact
         (and hosts that don't provide it simply don't show this
         button). -->
    <button
      v-if="moviePath && !movieGenerating && canFetchMedia"
      class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      :disabled="movieDownloading"
      data-testid="mulmo-script-download-movie-button"
      @click="emit('downloadMovie')"
    >
      <span class="material-icons text-base">download</span>
      <span>{{ m.movie }}</span>
    </button>
    <!-- Regenerate Movie (icon-only): collapses to a square once a
         movie exists — the adjacent Download / Play already make
         the subject clear, so the "Movie" label only adds noise. -->
    <button
      v-if="moviePath && !movieGenerating"
      class="h-8 w-8 flex items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
      :title="m.regenerateMovie"
      :aria-label="m.regenerateMovie"
      data-testid="mulmo-script-regenerate-movie-button"
      @click="emit('generateMovie')"
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
      @click="emit('generateMovie')"
    >
      <svg v-if="movieGenerating" class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      <span v-if="movieGenerating">{{ m.generating }}</span>
      <template v-else>
        <span class="material-icons text-sm">refresh</span>
        <span>{{ m.movie }}</span>
      </template>
    </button>
    <!-- PDF (#1614): same Generate / Download / Regenerate pattern
         as the Movie cluster above, kept structurally separate so
         the two outputs can be requested independently and report
         status independently. -->
    <button
      v-if="pdfPath && !pdfGenerating && canFetchMedia"
      class="h-8 px-2.5 flex items-center gap-1 rounded bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      :disabled="pdfDownloading"
      data-testid="mulmo-script-download-pdf-button"
      @click="emit('downloadPdf')"
    >
      <span class="material-icons text-base">download</span>
      <span>{{ m.pdf }}</span>
    </button>
    <button
      v-if="pdfPath && !pdfGenerating"
      class="h-8 w-8 flex items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
      :title="m.regeneratePdf"
      :aria-label="m.regeneratePdf"
      data-testid="mulmo-script-regenerate-pdf-button"
      @click="emit('generatePdf')"
    >
      <span class="material-icons text-base">refresh</span>
    </button>
    <button
      v-else
      class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      :disabled="pdfGenerating"
      data-testid="mulmo-script-generate-pdf-button"
      @click="emit('generatePdf')"
    >
      <svg v-if="pdfGenerating" class="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      <span v-if="pdfGenerating">{{ m.generatingPdf }}</span>
      <template v-else>
        <span class="material-icons text-sm">picture_as_pdf</span>
        <span>{{ m.pdf }}</span>
      </template>
    </button>
  </div>
</template>

<script setup lang="ts">
// Movie + PDF action cluster from the View header. Pure Tailwind — the
// parent's `<style scoped>` block only targets the bottom-bar region, so
// nothing here depends on styles that stop at the component boundary.
import { useT } from "../../lang/index";

const m = useT();

defineProps<{
  moviePath: string | null;
  movieGenerating: boolean;
  movieDownloading: boolean;
  isPlayReady: boolean;
  canFetchMedia: boolean;
  pdfPath: string | null;
  pdfGenerating: boolean;
  pdfDownloading: boolean;
}>();

const emit = defineEmits<{
  play: [];
  generateMovie: [];
  downloadMovie: [];
  generatePdf: [];
  downloadPdf: [];
}>();
</script>
