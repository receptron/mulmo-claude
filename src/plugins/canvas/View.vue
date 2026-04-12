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
                @click="brushSize = size"
                :class="[
                  'w-8 h-8 rounded border-2 transition-colors',
                  brushSize === size
                    ? 'border-blue-500 bg-blue-100'
                    : 'border-gray-300 bg-white hover:bg-gray-50',
                ]"
              >
                <div
                  :class="'bg-gray-800 rounded-full mx-auto'"
                  :style="{
                    width: Math.max(2, size * 1) + 'px',
                    height: Math.max(2, size * 1) + 'px',
                  }"
                ></div>
              </button>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <input
              v-model="brushColor"
              type="color"
              class="w-12 h-8 rounded border border-gray-300"
            />
          </div>
        </div>

        <div class="flex items-center gap-1">
          <button
            @click="undo"
            class="w-8 h-8 flex items-center justify-center rounded border-2 border-gray-300 bg-white hover:bg-gray-50"
            title="Undo"
          >
            <span class="material-icons text-sm">undo</span>
          </button>
          <button
            @click="redo"
            class="w-8 h-8 flex items-center justify-center rounded border-2 border-gray-300 bg-white hover:bg-gray-50"
            title="Redo"
          >
            <span class="material-icons text-sm">redo</span>
          </button>
          <button
            @click="clear"
            class="w-8 h-8 flex items-center justify-center rounded border-2 border-red-300 bg-white hover:bg-red-50"
            title="Clear"
          >
            <span class="material-icons text-sm">delete</span>
          </button>
        </div>
      </div>
    </div>

    <div class="flex-1 p-4 overflow-hidden">
      <VueDrawingCanvas
        ref="canvasRef"
        :key="`${selectedResult?.uuid || 'default'}-${canvasRenderKey}`"
        v-model:image="canvasImage"
        :width="canvasWidth"
        :height="canvasHeight"
        :stroke-type="'dash'"
        :line-cap="'round'"
        :line-join="'round'"
        :fill-shape="false"
        :eraser="false"
        :lineWidth="brushSize"
        :color="brushColor"
        :background-color="'#FFFFFF'"
        :background-image="undefined"
        :watermark="undefined"
        :initial-image="initialStrokes"
        saveAs="png"
        :styles="{
          border: '1px solid #ddd',
          borderRadius: '8px',
        }"
        :lock="false"
        @mouseup="handleDrawingEnd"
        @touchend="handleDrawingEnd"
      />
      <div class="flex items-center gap-2 flex-wrap mt-3">
        <span class="text-xs text-gray-500 mr-1">Style:</span>
        <button
          v-for="style in artStyles"
          :key="style.id"
          @click="applyStyle(style)"
          class="px-3 py-1.5 text-xs rounded-full border border-gray-300 bg-white hover:bg-blue-50 hover:border-blue-400 transition-colors"
        >
          {{ style.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from "vue";
import VueDrawingCanvas from "vue-drawing-canvas";
import type { ToolResult } from "gui-chat-protocol/vue";
import type { ImageToolData, CanvasDrawingState } from "./definition";

const props = defineProps<{
  selectedResult: ToolResult<ImageToolData> | null;
  sendTextMessage?: (text: string) => void;
}>();

const emit = defineEmits<{
  updateResult: [result: ToolResult<ImageToolData>];
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

const applyStyle = async (style: { id: string; label: string }) => {
  await saveDrawingState();
  if (props.sendTextMessage) {
    props.sendTextMessage(
      `Turn my drawing on the canvas into a ${style.label} style image.`,
    );
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const canvasRef = ref<any>(null);
const canvasImage = ref("");
const brushSize = ref(5);
const brushColor = ref("#000000");
const initialStrokes = ref([]);
const canvasWidth = ref(800);
const canvasHeight = ref(600);
const canvasRenderKey = ref(0);

const restoreDrawingState = () => {
  if (props.selectedResult?.viewState?.drawingState) {
    const state = props.selectedResult.viewState
      .drawingState as CanvasDrawingState;

    brushSize.value = state.brushSize || 5;
    brushColor.value = state.brushColor || "#000000";
    canvasWidth.value = state.canvasWidth || 800;
    canvasHeight.value = state.canvasHeight || 600;

    if (state.strokes) {
      initialStrokes.value = state.strokes as never[];
    } else {
      initialStrokes.value = [];
    }
  } else {
    initialStrokes.value = [];
  }
};
restoreDrawingState();

const undo = async () => {
  if (canvasRef.value) {
    try {
      canvasRef.value.undo();
      // Wait for the canvas to update, then save state
      setTimeout(saveDrawingState, 50);
    } catch (error) {
      console.warn("Undo operation failed:", error);
    }
  }
};

const redo = async () => {
  if (canvasRef.value) {
    try {
      canvasRef.value.redo();
      // Wait for the canvas to update, then save state
      setTimeout(saveDrawingState, 50);
    } catch (error) {
      console.warn("Redo operation failed:", error);
    }
  }
};

const clear = () => {
  if (canvasRef.value) {
    try {
      canvasRef.value.reset();
      saveDrawingState();
    } catch (error) {
      console.warn("Clear operation failed:", error);
    }
  }
};

const handleDrawingEnd = () => {
  saveDrawingState();
};

const saveDrawingState = async () => {
  if (canvasRef.value && props.selectedResult) {
    try {
      const imageData = await canvasRef.value.save();
      const strokes = canvasRef.value.getAllStrokes();
      const drawingState = {
        strokes,
        brushSize: brushSize.value,
        brushColor: brushColor.value,
        canvasWidth: canvasWidth.value,
        canvasHeight: canvasHeight.value,
      };

      const updatedResult: ToolResult<ImageToolData> = {
        ...props.selectedResult,
        data: {
          prompt: props.selectedResult.data?.prompt || "",
          imageData: imageData,
        },
        viewState: {
          drawingState,
        },
      };

      emit("updateResult", updatedResult);
    } catch (error) {
      console.error("Failed to save drawing state:", error);
    }
  }
};

// Watch for selectedResult changes to restore drawing state
watch(
  () => props.selectedResult,
  () => {
    restoreDrawingState();
  },
  { immediate: false },
);

// Watch for changes to automatically save drawing state
watch([brushSize, brushColor], () => {
  saveDrawingState();
});

// Watch for canvas size changes and force re-mount
watch([canvasWidth, canvasHeight], () => {
  // Force canvas to re-mount with new dimensions by changing the key
  canvasRenderKey.value++;
});
const updateCanvasSize = () => {
  // Get the canvas container (the div with flex-1 p-4 overflow-hidden)
  const canvasContainer = canvasRef.value?.$el?.parentElement;
  if (canvasContainer) {
    const containerRect = canvasContainer.getBoundingClientRect();

    const padding = 32; // p-4 = 16px each side
    const newWidth = Math.floor(containerRect.width - padding);
    const newHeight = Math.floor((newWidth * 9) / 16);

    // Only update if the size actually changed to avoid unnecessary re-renders
    if (newWidth !== canvasWidth.value || newHeight !== canvasHeight.value) {
      canvasWidth.value = newWidth;
      canvasHeight.value = newHeight;
    }
  }
};

onMounted(async () => {
  await nextTick();
  updateCanvasSize();

  // Listen for window resize to update canvas size
  window.addEventListener("resize", updateCanvasSize);
});

// Clean up resize listener
onUnmounted(() => {
  window.removeEventListener("resize", updateCanvasSize);
});
</script>
