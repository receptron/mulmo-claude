<template>
  <div class="p-2 text-sm">
    <div class="font-medium text-gray-700 truncate mb-1">
      {{ title }}
    </div>
    <div v-if="hint" class="text-xs text-gray-500 leading-relaxed truncate">
      {{ hint }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentChartData } from "./index";

const props = defineProps<{ result: ToolResultComplete<PresentChartData> }>();

const data = computed(() => props.result.data);
const title = computed(() => data.value?.title ?? data.value?.document?.title ?? "Chart");

// Condensed "n charts: line, bar, …" hint derived from the document
// so the preview card tells the user what's inside without opening.
const hint = computed(() => {
  const charts = data.value?.document?.charts ?? [];
  if (charts.length === 0) return "";
  const types = charts
    .map((chart) => chart.type ?? inferTypeFromOption(chart.option))
    .filter((chartType): chartType is string => Boolean(chartType))
    .slice(0, 3);
  const suffix = charts.length > types.length ? ", …" : "";
  const typeList = types.join(", ");
  const plural = charts.length === 1 ? "" : "s";
  const details = typeList ? `: ${typeList}${suffix}` : "";
  return `${charts.length} chart${plural}${details}`;
});

function inferTypeFromOption(option: Record<string, unknown>): string | null {
  const series = option.series;
  if (Array.isArray(series) && series.length > 0) {
    const first = series[0] as { type?: unknown };
    if (typeof first.type === "string") return first.type;
  } else if (series && typeof series === "object") {
    const seriesType = (series as { type?: unknown }).type;
    if (typeof seriesType === "string") return seriesType;
  }
  return null;
}
</script>
