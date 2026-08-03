<template>
  <div ref="containerEl" class="marp-container">
    <div class="flex items-center justify-end gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <span class="text-xs text-gray-500 mr-auto pl-2">{{ t("pluginMarkdown.marpSlidesMode", { count: slideCount }) }}</span>
      <!-- Toolbar slot: View.vue mounts the split-mode toggle here so
           the chrome stays unified with PDF / slide-count. Slot is a
           no-op for non-toggle consumers (FileContentRenderer). -->
      <slot name="toolbar" />
      <button
        class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        :disabled="pdfDownloading"
        @click="onExportPdf"
      >
        <span class="material-icons text-base">{{ pdfDownloading ? "hourglass_empty" : "download" }}</span>
        {{ t("pluginMarkdown.marpExportPdf") }}
      </button>
      <span v-if="pdfError" class="text-xs text-red-500" :title="pdfError">{{ t("pluginMarkdown.pdfFailedShort") }}</span>
    </div>
    <div v-if="renderError" class="load-error-banner" role="alert">
      {{ t("pluginMarkdown.marpRenderFailed", { error: renderError }) }}
    </div>
    <div class="marp-frame-wrapper" :style="{ padding: wrapperPadding }">
      <div v-if="srcDoc" :style="{ height: frameHeight + 'px', overflow: 'hidden' }">
        <iframe
          :srcdoc="srcDoc"
          :style="{
            width: nativeIframeWidth + 'px',
            height: nativeContentHeight + 'px',
            transform: `scale(${slideScale})`,
            transformOrigin: 'top left',
          }"
          sandbox=""
          class="marp-frame"
          :title="t('pluginMarkdown.marpSlidesMode', { count: slideCount })"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { usePdfExport } from "./usePdfExport";
import type { MarpThemeEntry } from "./contract";
import { readMarpThemes } from "./contract";
import { errorMessage } from "@mulmoclaude/common";
import { rewriteMarkdownImageRefs } from "@mulmoclaude/markdown-utils/image/rewriteMarkdownImageRefs";
import { renderMarpDeck, type RenderMarpResult } from "../../render/marp";
import { useT } from "../../lang";

const t = useT();
const { dispatch } = useRuntime();

const props = defineProps<{
  markdown: string;
  pdfFilename: string;
  baseDir?: string | undefined;
}>();

const DEFAULT_SLIDE_WIDTH = 1280;
const DEFAULT_SLIDE_HEIGHT = 720;
const SLIDE_GAP_PX = 16;
const BODY_PADDING_PX = 16;
const WRAPPER_PADDING_PX = 12;
const FALLBACK_WIDTH_PX = 800;
const MIN_SCALE = 0.05;
const MAX_SCALE = 1;

const wrapperPadding = `${WRAPPER_PADDING_PX}px`;

const containerEl = ref<HTMLElement | null>(null);
const containerWidth = ref(FALLBACK_WIDTH_PX);
const srcDoc = ref<string>("");
const slideCount = ref(0);
const slideWidth = ref(DEFAULT_SLIDE_WIDTH);
const slideHeight = ref(DEFAULT_SLIDE_HEIGHT);
const renderError = ref<string | null>(null);

const { pdfDownloading, pdfError, downloadPdf } = usePdfExport();

const nativeIframeWidth = computed(() => slideWidth.value + BODY_PADDING_PX * 2);

const slideScale = computed(() => {
  const raw = (containerWidth.value - WRAPPER_PADDING_PX * 2) / nativeIframeWidth.value;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
});

const nativeContentHeight = computed(() => {
  if (slideCount.value === 0) return BODY_PADDING_PX * 2;
  const slides = slideCount.value * slideHeight.value;
  const gaps = Math.max(0, slideCount.value - 1) * SLIDE_GAP_PX;
  return slides + gaps + BODY_PADDING_PX * 2;
});

const frameHeight = computed(() => Math.ceil(nativeContentHeight.value * slideScale.value));

function buildCsp(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const imgSrc = origin ? `${origin} data:` : "data:";
  return [
    "default-src 'none'",
    `img-src ${imgSrc}`,
    "style-src 'unsafe-inline' 'self'",
    "font-src 'self' data:",
    "connect-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function buildSlideCss(css: string): string {
  return `html,body { margin:0; padding:${BODY_PADDING_PX}px; background:transparent; overflow:hidden; }
${css}
div.marpit > section {
  display: block !important;
  margin: 0 auto ${SLIDE_GAP_PX}px !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  border-radius: 6px;
}
div.marpit > section img:not([data-marp-twemoji]) {
  max-width: 100%;
  max-height: 60cqh;
  object-fit: contain;
}`;
}

function buildSrcDoc(html: string, css: string): string {
  const csp = buildCsp();
  const styles = buildSlideCss(css);
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<style>${styles}</style></head><body>${html}</body></html>`;
}

function countSlides(html: string): number {
  const sectionMatches = html.match(/<section[\s>]/g);
  return sectionMatches ? sectionMatches.length : 0;
}

function resetRenderState(): void {
  srcDoc.value = "";
  slideCount.value = 0;
  slideWidth.value = DEFAULT_SLIDE_WIDTH;
  slideHeight.value = DEFAULT_SLIDE_HEIGHT;
}

// Cache the workspace's Marp themes so we don't re-fetch on every
// keystroke. Fetched lazily on first render; a theme edit requires a
// manual reload until follow-up work wires pubsub invalidation.
// **Successful** responses are cached, including an empty list (=
// user has no themes — confirmed by the server, not just guessed).
// Failed dispatches (network blip, server temporarily down) leave the
// cache null so the next render retries — caching `[]` on failure
// would silently disable themes for the rest of the session
// (CodeRabbit #1653 review).
let cachedThemes: readonly MarpThemeEntry[] | null = null;

async function loadMarpThemes(): Promise<readonly MarpThemeEntry[]> {
  if (cachedThemes !== null) return cachedThemes;
  try {
    const { themes } = await dispatch({ kind: "marpThemes" }, readMarpThemes);
    if (!Array.isArray(themes)) return [];
    cachedThemes = themes;
    return cachedThemes;
  } catch {
    return [];
  }
}

async function prepareMarp(markdown: string): Promise<RenderMarpResult> {
  // Register every workspace-defined theme (#1649). A deck opts in
  // via frontmatter `theme: <name>`; decks that don't keep Marp's
  // default look.
  const themes = await loadMarpThemes();
  // Rewrite workspace-relative `<img>` refs to host URLs BEFORE Marp so
  // the preview iframe can load them (the PDF export inlines instead).
  // `inlineSVG: false` (the renderMarpDeck default) → CSS-sized sections
  // for the scrollable preview.
  const rewritten = rewriteMarkdownImageRefs(markdown, props.baseDir ?? "");
  return renderMarpDeck(rewritten, { themes });
}

let renderToken = 0;

async function renderMarp(markdown: string): Promise<void> {
  const token = ++renderToken;
  renderError.value = null;
  if (!markdown) {
    resetRenderState();
    return;
  }
  try {
    const { html, css, slideWidth: width, slideHeight: height } = await prepareMarp(markdown);
    // regex note: monotonic render counter, not a secret
    if (token !== renderToken) return;
    slideCount.value = countSlides(html);
    slideWidth.value = width;
    slideHeight.value = height;
    srcDoc.value = buildSrcDoc(html, css);
  } catch (err) {
    // regex note: monotonic render counter, not a secret
    if (token !== renderToken) return;
    renderError.value = errorMessage(err);
    resetRenderState();
  }
}

watch(
  () => [props.markdown, props.baseDir],
  ([source]) => {
    void renderMarp(source as string);
  },
  { immediate: true },
);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!containerEl.value) return;
  containerWidth.value = containerEl.value.clientWidth || FALLBACK_WIDTH_PX;
  resizeObserver = new ResizeObserver((entries) => {
    const [entry] = entries;
    if (entry) containerWidth.value = entry.contentRect.width || FALLBACK_WIDTH_PX;
  });
  resizeObserver.observe(containerEl.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

async function onExportPdf(): Promise<void> {
  if (!props.markdown) return;
  await downloadPdf({ markdown: props.markdown, filename: props.pdfFilename, marp: true, baseDir: props.baseDir });
}
</script>

<style scoped>
.marp-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  border-radius: 6px;
}

.marp-frame-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.marp-frame {
  border: none;
  background: transparent;
  display: block;
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
</style>
