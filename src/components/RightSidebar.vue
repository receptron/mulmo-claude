<template>
  <div
    class="w-80 flex-shrink-0 border-l border-gray-200 flex flex-col bg-white text-gray-900"
  >
    <div ref="historyContainer" class="flex-1 overflow-y-auto min-h-0">
      <div class="bg-white border-b border-gray-200">
        <button
          class="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
          title="Toggle system prompt"
          @click="showSystemPrompt = !showSystemPrompt"
        >
          <span
            class="text-xs font-semibold text-gray-500 uppercase tracking-wide"
            >System Prompt</span
          >
          <span class="text-gray-400 text-xs">{{
            showSystemPrompt ? "▲" : "▼"
          }}</span>
        </button>
        <div v-if="showSystemPrompt" class="px-4 pb-4">
          <div
            class="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap"
          >
            {{ rolePrompt }}
          </div>
        </div>
      </div>

      <div class="bg-white border-b border-gray-200">
        <div class="p-4 pb-0">
          <span
            class="text-xs font-semibold text-gray-500 uppercase tracking-wide"
            >Available Tools</span
          >
        </div>
        <div class="px-4 py-3 space-y-1">
          <div v-for="tool in availableTools" :key="tool" class="text-xs">
            <button
              class="flex items-center gap-1 w-full text-left"
              title="Toggle tool description"
              @click="toggleTool(tool)"
            >
              <span
                class="bg-gray-100 text-gray-700 rounded px-2 py-0.5 border border-gray-200 font-mono"
                >{{ tool }}</span
              >
              <span v-if="toolDescriptions[tool]" class="text-gray-400">{{
                expandedTools.has(tool) ? "▲" : "▼"
              }}</span>
            </button>
            <div
              v-if="toolDescriptions[tool] && expandedTools.has(tool)"
              class="text-gray-500 mt-0.5 pl-1 leading-snug whitespace-pre-wrap"
            >
              {{ toolDescriptions[tool] }}
            </div>
          </div>
        </div>
      </div>

      <div class="p-4 border-b border-gray-200 bg-white">
        <h2 class="text-lg font-semibold">Tool Call History</h2>
      </div>

      <div class="p-2 space-y-2 bg-gray-100">
        <div
          v-if="toolCallHistory.length === 0"
          class="text-gray-400 text-sm text-center py-4"
        >
          No tool calls yet
        </div>
        <div
          v-for="(call, index) in toolCallHistory"
          :key="index"
          class="border border-gray-300 rounded p-3 bg-white text-xs space-y-1"
        >
          <div class="flex justify-between items-start gap-2">
            <span class="font-semibold text-blue-600 break-all">{{
              call.toolName
            }}</span>
            <span class="text-gray-400 flex-shrink-0">{{
              formatTime(call.timestamp)
            }}</span>
          </div>
          <div>
            <div class="font-medium text-gray-500 mb-1">Arguments</div>
            <pre class="bg-gray-50 p-2 rounded overflow-x-auto text-gray-700">{{
              formatJson(call.args)
            }}</pre>
          </div>
          <div v-if="call.error">
            <div class="font-medium text-gray-500 mb-1">Error</div>
            <div class="bg-red-50 p-2 rounded text-red-700">
              {{ call.error }}
            </div>
          </div>
          <div v-else-if="call.result !== undefined">
            <div class="font-medium text-gray-500 mb-1">Result</div>
            <pre
              class="bg-green-50 p-2 rounded overflow-x-auto text-gray-700"
              >{{ call.result }}</pre
            >
          </div>
          <div v-else>
            <div class="text-gray-400 italic">Running...</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from "vue";
import type { ToolCallHistoryItem } from "../types/toolCallHistory";
import { formatTime } from "../utils/format/date";

defineProps<{
  toolCallHistory: ToolCallHistoryItem[];
  availableTools: string[];
  rolePrompt: string;
  toolDescriptions: Record<string, string>;
}>();

const showSystemPrompt = ref(false);
const expandedTools = ref(new Set<string>());
const historyContainer = ref<HTMLDivElement | null>(null);

function toggleTool(tool: string): void {
  if (expandedTools.value.has(tool)) {
    expandedTools.value.delete(tool);
  } else {
    expandedTools.value.add(tool);
  }
  expandedTools.value = new Set(expandedTools.value);
}

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function scrollToBottom(): void {
  nextTick(() => {
    if (historyContainer.value) {
      historyContainer.value.scrollTop = historyContainer.value.scrollHeight;
    }
  });
}

defineExpose({ scrollToBottom });
</script>
