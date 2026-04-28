<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between">
      <span class="text-sm font-medium text-gray-700 truncate">
        {{ title ?? t("pluginChart.untitled") }}
      </span>
      <span class="text-xs text-gray-500 shrink-0">
        {{ t("pluginChart.chartCount", charts.length, { named: { count: charts.length } }) }}
      </span>
    </div>
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-for="(chart, idx) in charts" :key="idx" class="border border-gray-200 rounded-lg bg-white" :data-testid="`chart-card-${idx}`">
        <div class="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-sm font-medium text-gray-800 truncate">
              {{ chart.title ?? t("pluginChart.chartTitle", { num: idx + 1 }) }}
            </span>
            <span v-if="chart.type" class="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-blue-50 text-blue-700 shrink-0">
              {{ chart.type }}
            </span>
          </div>
          <button
            class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 shrink-0"
            :data-testid="`chart-export-png-${idx}`"
            @click="exportPng(idx, chart.title)"
          >
            <span class="material-icons text-sm align-middle">download</span>
            {{ t("pluginChart.png") }}
          </button>
        </div>
        <div :ref="(el) => setChartRef(idx, el as HTMLDivElement | null)" class="w-full h-[400px]" :data-testid="`chart-canvas-${idx}`" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import * as echarts from "echarts";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ChartEntry, PresentChartData } from "./index";
import { isRecord } from "../../utils/types";

const { t } = useI18n();

const props = defineProps<{
  selectedResult: ToolResultComplete<PresentChartData>;
}>();

const data = computed(() => props.selectedResult.data);
const charts = computed<ChartEntry[]>(() => data.value?.document?.charts ?? []);
const title = computed(() => data.value?.title ?? data.value?.document?.title);

const containers = ref<(HTMLDivElement | null)[]>([]);
// Kept as a plain array (not `ref`): ECharts instances are managed
// imperatively and should not trigger Vue re-renders on mutation.
const instances: echarts.ECharts[] = [];

function setChartRef(idx: number, element: HTMLDivElement | null): void {
  containers.value[idx] = element;
}

function disposeAll(): void {
  for (const instance of instances) {
    instance.dispose();
  }
  instances.length = 0;
}

// Force-disable mouse-wheel zoom on any dataZoom entry in the user's
// option. Rationale: in stack view the page needs to scroll past the
// chart, and `inside`-type dataZoom captures the wheel by default
// (zoomOnMouseWheel=true), which traps the scroll over the canvas.
// Toolbox/slider/drag zoom still work — only the wheel is disabled.
function disableWheelZoom(option: Record<string, unknown>): Record<string, unknown> {
  const { dataZoom } = option;
  if (dataZoom === undefined || dataZoom === null) return option;
  const normalise = (entry: unknown): unknown => {
    if (!isRecord(entry)) return entry;
    return {
      ...entry,
      zoomOnMouseWheel: false,
      moveOnMouseWheel: false,
    };
  };
  const next = Array.isArray(dataZoom) ? dataZoom.map(normalise) : normalise(dataZoom);
  return { ...option, dataZoom: next };
}

function renderAll(): void {
  disposeAll();
  for (let i = 0; i < charts.value.length; i += 1) {
    const element = containers.value[i];
    const chart = charts.value[i];
    if (!element || !chart) continue;
    const instance = echarts.init(element);
    try {
      instance.setOption(disableWheelZoom(chart.option));
    } catch (err) {
      console.warn(`[chart] setOption failed for chart ${i}`, err);
    }
    instances[i] = instance;
  }
}

function handleResize(): void {
  for (const instance of instances) instance.resize();
}

onMounted(() => {
  // Wait a tick so the refs are populated before we render.
  queueMicrotask(renderAll);
  window.addEventListener("resize", handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  disposeAll();
});

// Re-render when the selected result switches to a different document
// (e.g. user clicks another chart result in the sidebar).
watch(
  () => data.value?.filePath,
  () => queueMicrotask(renderAll),
);

function exportPng(idx: number, chartTitle?: string): void {
  const instance = instances[idx];
  if (!instance) return;
  const dataUrl = instance.getDataURL({
    type: "png",
    pixelRatio: 2,
    backgroundColor: "#ffffff",
  });
  let filenameSlug = (chartTitle ?? title.value ?? "chart").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  while (filenameSlug.startsWith("-")) filenameSlug = filenameSlug.slice(1);
  while (filenameSlug.endsWith("-")) filenameSlug = filenameSlug.slice(0, -1);
  if (!filenameSlug) filenameSlug = "chart";
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = `${filenameSlug}-${idx + 1}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
</script>
