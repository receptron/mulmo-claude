<template>
  <div class="text-sm">
    <div class="font-medium text-gray-700 truncate mb-1">{{ title }}</div>
    <div v-if="hint" class="text-xs text-gray-500 leading-relaxed truncate">{{ hint }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { PresentScene3dData } from "./index";

const props = defineProps<{ result: ToolResultComplete<PresentScene3dData> }>();

const data = computed(() => props.result.data);
const title = computed(() => data.value?.title ?? data.value?.document?.title ?? "Scene");

// "n objects: scatter, bar, …" preview hint so the user knows what's
// in the scene without opening it.
const hint = computed(() => {
  const objects = data.value?.document?.objects ?? [];
  if (objects.length === 0) return "";
  const kinds = Array.from(new Set(objects.map((obj) => obj.kind))).slice(0, 3);
  const suffix = new Set(objects.map((obj) => obj.kind)).size > kinds.length ? ", …" : "";
  const plural = objects.length === 1 ? "" : "s";
  return `${objects.length} object${plural}: ${kinds.join(", ")}${suffix}`;
});
</script>
