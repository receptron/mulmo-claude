<template>
  <div class="flex-1 flex flex-col overflow-hidden" data-testid="wiki-graph">
    <div v-if="graphError" class="mx-6 mt-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
      {{ graphError }}
    </div>
    <div v-else-if="!graphData || graphData.nodes.length === 0" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
      <div class="text-center space-y-2">
        <span class="material-icons text-4xl text-gray-300">hub</span>
        <p>{{ $t("pluginWiki.graphEmpty") }}</p>
      </div>
    </div>
    <WikiGraphView v-else :graph="graphData" class="flex-1" @navigate="emit('navigate', $event)" />
  </div>
</template>

<script setup lang="ts">
import type { WikiGraph } from "@mulmoclaude/core/wiki";
import WikiGraphView from "./WikiGraphView.vue";

defineProps<{
  graphData: WikiGraph | null;
  graphError: string | null;
}>();

const emit = defineEmits<{ navigate: [slug: string] }>();
</script>
