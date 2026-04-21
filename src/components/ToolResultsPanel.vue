<template>
  <div
    ref="root"
    class="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 bg-gray-100 outline-none"
    tabindex="0"
    @mousedown="emit('activate')"
  >
    <div
      v-for="result in results"
      :key="result.uuid"
      class="cursor-pointer rounded border border-gray-300 p-2 text-sm text-gray-900 hover:opacity-75 transition-opacity"
      :class="result.uuid === selectedUuid ? 'ring-2 ring-blue-500' : ''"
      @click="emit('select', result.uuid)"
    >
      <div class="flex items-center gap-1">
        <component
          :is="getPlugin(result.toolName)?.previewComponent"
          v-if="getPlugin(result.toolName)?.previewComponent"
          :result="result"
          class="flex-1 min-w-0"
        />
        <span v-else class="flex-1 min-w-0 truncate">{{
          result.title || result.toolName
        }}</span>
        <span
          v-if="resultTimestamps.get(result.uuid)"
          class="text-[10px] text-gray-400 shrink-0"
          >{{ formatSmartTime(resultTimestamps.get(result.uuid)!) }}</span
        >
      </div>
    </div>

    <!-- Thinking indicator -->
    <div v-if="isRunning" class="px-2 py-1 text-sm">
      <div class="flex items-center gap-2 text-gray-500">
        <span class="text-xs">{{ statusMessage }}</span>
        <span class="flex gap-1">
          <span
            class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
            style="animation-delay: 0ms"
          />
          <span
            class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
            style="animation-delay: 150ms"
          />
          <span
            class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
            style="animation-delay: 300ms"
          />
        </span>
      </div>
      <div v-if="pendingCalls.length > 0" class="mt-1 space-y-0.5">
        <div
          v-for="call in pendingCalls"
          :key="call.toolUseId"
          class="flex items-center gap-1.5 text-xs text-gray-400"
        >
          <span
            class="w-1.5 h-1.5 rounded-full bg-blue-300 shrink-0 animate-pulse"
          />
          <span class="font-mono truncate">{{ call.toolName }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { getPlugin } from "../tools";
import { formatSmartTime } from "../utils/format/date";

interface PendingCall {
  toolUseId: string;
  toolName: string;
}

defineProps<{
  results: ToolResultComplete[];
  selectedUuid: string | null;
  resultTimestamps: Map<string, number>;
  isRunning: boolean;
  statusMessage: string;
  pendingCalls: PendingCall[];
}>();

const emit = defineEmits<{
  select: [uuid: string];
  activate: [];
}>();

const root = ref<HTMLDivElement | null>(null);
defineExpose({ root });
</script>
