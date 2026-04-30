<template>
  <div class="w-full h-full flex flex-col bg-white">
    <div class="flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-gray-50">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <div class="flex gap-1">
              <button
                v-for="size in [2, 5, 10, 20]"
                :key="size"
                :class="[
                  'w-8 h-8 rounded border-2 transition-colors',
                  brushSize === size ? 'border-blue-500 bg-blue-100' : 'border-gray-300 bg-white hover:bg-gray-50',
                ]"
                @click="brushSize = size"
              >
                <div
                  class="bg-gray-800 rounded-full mx-auto"
                  :style="{
                    width: Math.max(2, size * 1) + 'px',
                    height: Math.max(2, size * 1) + 'px',
                  }"
                ></div>
              </button>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <input v-model="brushColor" type="color" class="w-12 h-8 rounded border border-gray-300" />
          </div>
        </div>

        <div class="flex items-center gap-1">
          <button
            class="w-8 h-8 flex items-center justify-center rounded border-2 border-gray-300 bg-white hover:bg-gray-50"
            :title="t('pluginCanvas.undo')"
            @click="undo"
          >
            <span class="material-icons text-sm">undo</span>
          </button>
          <button
            class="w-8 h-8 flex items-center justify-center rounded border-2 border-gray-300 bg-white hover:bg-gray-50"
            :title="t('pluginCanvas.redo')"
            @click="redo"
          >
            <span class="material-icons text-sm">redo</span>
          </button>
          <button
            class="w-8 h-8 flex items-center justify-center rounded border-2 border-red-300 bg-white hover:bg-red-50"
            :title="t('pluginCanvas.clear')"
            @click="clear"
          >
            <span class="material-icons text-sm">delete</span>
          </button>
        </div>
      </div>
    </div>

    <div ref="containerRef" class="flex-1 p-4 overflow-hidden">
      <VueDrawingCanvas
        v-if="canvasWidth > 0"
        ref="canvasRef"
        :key="`${selectedResult?.uuid || 'default'}-${canvasRenderKey}`"
        :width="canvasWidth"
        :height="canvasHeight"
        stroke-type="dash"
        line-cap="round"
        line-join="round"
        :fill-shape="false"
        :eraser="false"
        :line-width="brushSize"
        :color="brushColor"
        background-color="#FFFFFF"
        :background-image="backgroundImage"
        :watermark="undefined"
        save-as="png"
        :styles="{
          border: '1px solid #ddd',
          borderRadius: '8px',
        }"
        :lock="false"
        @mouseup="saveDrawing"
        @touchend="saveDrawing"
      />
      <div class="flex items-center gap-2 flex-wrap mt-3">
        <span class="text-xs text-gray-500 mr-1">{{ t("pluginCanvas.styleLabel") }}</span>
        <button
          v-for="style in artStyles"
          :key="style.id"
          class="px-3 py-1.5 text-xs rounded-full border border-gray-300 bg-white hover:bg-blue-50 hover:border-blue-400 transition-colors"
          @click="applyStyle(style)"
        >
          {{ style.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import VueDrawingCanvas from "vue-drawing-canvas";
import type { ToolResult } from "gui-chat-protocol/vue";
import type { ImageToolData } from "./definition";
import { apiPut } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { resolveImageSrc } from "../../utils/image/resolve";
import { bumpImage } from "../../utils/image/cacheBust";

const { t } = useI18n();

const props = defineProps<{
  selectedResult: ToolResult<ImageToolData> | null;
  sendTextMessage?: (text: string) => void;
}>();

const artStyles = [
  { id: "ghibli", label: "Ghibli" },
  { id: "ukiyoe", label: "Ukiyoe" },
  { id: "sumie", label: "Sumi-e" },
  { id: "picasso", label: "Picasso" },
  { id: "gogh", label: "Van Gogh" },
  { id: "photo", label: "Photo-realistic" },
  { id: "watercolor", label: "Watercolor" },
  { id: "popart", label: "Pop Art" },
  { id: "american", label: "American Comic" },
  { id: "cyberpunk", label: "Cyberpunk" },
  { id: "pencilsketch", label: "Pencil Sketch" },
  { id: "pixelart", label: "Pixel Art" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const canvasRef = ref<any>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const brushSize = ref(5);
const brushColor = ref("#000000");
// `canvasWidth === 0` doubles as "not measured yet" — the child has a
// v-if on `canvasWidth > 0` so it mounts exactly once, with the
// correct dimensions. Mounting at a default 800×600 and resizing a
// tick later races the in-flight background fetch and blanks the
// canvas on reload.
const canvasWidth = ref(0);
const canvasHeight = ref(0);
const canvasRenderKey = ref(0);

// The PNG on disk is the source of truth. The path is baked into
// the tool result at openCanvas time (server-allocated), so reload
// finds the file with zero client→server sync. Every stroke PUTs
// back to this same path.
const imagePath = computed(() => {
  const stored = props.selectedResult?.data?.imageData;
  if (!stored || stored.startsWith("data:")) return "";
  return stored;
});

const applyStyle = (style: { id: string; label: string }) => {
  // Embed the canvas image's workspace path directly so the LLM has
  // it in plain text and can quote it back as `imagePaths` to the
  // editImages tool. Falls back to the path-less phrasing only when
  // openCanvas hasn't been linked to a saved file yet.
  const path = imagePath.value;
  const text = path ? t("pluginCanvas.stylePromptWithPath", { path, style: style.label }) : t("pluginCanvas.stylePromptNoPath", { style: style.label });
  props.sendTextMessage?.(text);
};

// Per-mount cache buster for the VueDrawingCanvas child. The URL
// must be stable for the lifetime of one canvas instance — if it
// changes while the child is alive (e.g. from a post-save bump),
// the library nulls its cached `loadedImage` and the next redraw
// races a fresh re-fetch against stroke painting, blanking the
// canvas. Tying the token to `canvasRenderKey` (which increments
// when we explicitly remount via :key on resize) gives us fresh
// bytes on page reload and on resize, without mid-session churn.
const setupTime = Date.now();
const backgroundImage = computed(() => {
  if (!imagePath.value) return undefined;
  const base = resolveImageSrc(imagePath.value);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}mt=${setupTime}-${canvasRenderKey.value}`;
});

let uploadInFlight = false;
let pendingSave = false;

// Snapshot the current bitmap and PUT it back to the pre-allocated
// file. No result mutation — the path is fixed from canvas creation,
// so nothing upstream needs to know about saves. `function` (not
// `const`) so the undo/redo/clear handlers below can reference it
// without TDZ ordering problems.
async function saveDrawing(): Promise<void> {
  if (!canvasRef.value || !imagePath.value) return;
  if (uploadInFlight) {
    pendingSave = true;
    return;
  }
  uploadInFlight = true;
  try {
    const imageDataUri: string = await canvasRef.value.save();
    const result = await apiPut<{ path: string }>(API_ROUTES.image.update, {
      relativePath: imagePath.value,
      imageData: imageDataUri,
    });
    if (!result.ok) throw new Error(`PUT failed: ${result.error}`);
    bumpImage(imagePath.value);
  } catch (error) {
    console.error("Failed to save drawing:", error);
  } finally {
    uploadInFlight = false;
    if (pendingSave) {
      pendingSave = false;
      void saveDrawing();
    }
  }
}

// Undo/redo kick off the library's async redraw; give it a tick to
// composite before we snapshot-and-upload.
const undo = () => {
  canvasRef.value?.undo();
  setTimeout(saveDrawing, 50);
};
const redo = () => {
  canvasRef.value?.redo();
  setTimeout(saveDrawing, 50);
};
const clear = () => {
  canvasRef.value?.reset();
  saveDrawing();
};

const updateCanvasSize = () => {
  const container = containerRef.value;
  if (!container) return;
  const containerRect = container.getBoundingClientRect();
  const padding = 32;
  const newWidth = Math.floor(containerRect.width - padding);
  const newHeight = Math.floor((newWidth * 9) / 16);
  if (newWidth <= 0) return;
  if (newWidth === canvasWidth.value && newHeight === canvasHeight.value) return;
  const firstPaint = canvasWidth.value === 0;
  canvasWidth.value = newWidth;
  canvasHeight.value = newHeight;
  // Remount the child on every size change *after* the first paint so
  // it re-reads the background image at the new dimensions. The first
  // paint doesn't need this — v-if gates the mount on `canvasWidth > 0`.
  if (!firstPaint) canvasRenderKey.value++;
};

onMounted(async () => {
  await nextTick();
  updateCanvasSize();
  window.addEventListener("resize", updateCanvasSize);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateCanvasSize);
});
</script>
