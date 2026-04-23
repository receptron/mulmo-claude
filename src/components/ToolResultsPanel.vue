<template>
  <div class="flex-1 min-h-0 flex flex-col bg-gray-100">
    <div class="shrink-0 flex items-center gap-1 text-xs text-gray-400 px-2 pt-2 pb-1" data-testid="sidebar-role-header">
      <span v-if="sessionRoleIcon" class="material-icons text-xs leading-none">{{ sessionRoleIcon }}</span>
      <span v-if="sessionRoleName">{{ sessionRoleName }}</span>
      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          class="text-gray-400 hover:text-gray-700"
          :class="{ 'text-blue-500': showRightSidebar }"
          :title="t('sidebarHeader.toolCallHistory')"
          :aria-label="t('sidebarHeader.toolCallHistory')"
          :aria-pressed="showRightSidebar"
          @click="emit('toggle-right-sidebar')"
        >
          <span class="material-icons text-lg" aria-hidden="true">build</span>
        </button>
        <CanvasViewToggle :model-value="layoutMode" @update:model-value="(mode) => emit('update:layoutMode', mode)" />
      </div>
    </div>
    <div
      ref="root"
      class="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 outline-none"
      tabindex="0"
      data-testid="tool-results-scroll"
      @mousedown="emit('activate')"
    >
      <div
        v-for="result in results"
        :key="result.uuid"
        class="relative cursor-pointer rounded border border-gray-300 text-sm text-gray-900 hover:opacity-75 transition-opacity"
        :class="result.uuid === selectedUuid ? 'ring-2 ring-blue-500' : ''"
        @click="emit('select', result.uuid)"
      >
        <span class="absolute top-0 left-2 -translate-y-1/2 bg-gray-100 px-1 text-[10px] text-gray-400 leading-none pointer-events-none">
          {{ sourceLabel(result) }}
        </span>
        <span
          v-if="resultTimestamps.get(result.uuid)"
          class="absolute top-0 right-2 -translate-y-1/2 bg-gray-100 px-1 text-[10px] text-gray-400 leading-none pointer-events-none"
        >
          {{ formatSmartTime(resultTimestamps.get(result.uuid)!) }}
        </span>
        <component :is="getPlugin(result.toolName)?.previewComponent" v-if="getPlugin(result.toolName)?.previewComponent" :result="result" />
        <span v-else class="block truncate p-2">{{ result.title || result.toolName }}</span>
      </div>

      <!-- Thinking indicator -->
      <div v-if="isRunning" class="px-2 py-1 text-sm">
        <div class="flex items-center gap-2 text-gray-500">
          <span class="text-xs">{{ statusMessage }}</span>
          <span class="flex gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 0ms" />
            <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 150ms" />
            <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 300ms" />
          </span>
        </div>
        <div v-if="pendingCalls.length > 0" class="mt-1 space-y-0.5">
          <div v-for="call in pendingCalls" :key="call.toolUseId" class="flex items-center gap-1.5 text-xs text-gray-400">
            <span class="w-1.5 h-1.5 rounded-full bg-blue-300 shrink-0 animate-pulse" />
            <span class="font-mono truncate">{{ call.toolName }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { getPlugin } from "../tools";
import { formatSmartTime } from "../utils/format/date";
import CanvasViewToggle from "./CanvasViewToggle.vue";
import type { LayoutMode } from "../utils/canvas/layoutMode";

const { t } = useI18n();

function sourceLabel(result: ToolResultComplete): string {
  if (result.toolName === "text-response") return result.title ?? "Assistant";
  return result.toolName;
}

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
  sessionRoleName?: string;
  sessionRoleIcon?: string;
  layoutMode: LayoutMode;
  showRightSidebar: boolean;
}>();

const emit = defineEmits<{
  select: [uuid: string];
  activate: [];
  "update:layoutMode": [mode: LayoutMode];
  "toggle-right-sidebar": [];
}>();

const root = ref<HTMLDivElement | null>(null);
defineExpose({ root });
</script>

<style scoped>
/* Prevent rendered markdown links inside preview cards from navigating.
   Clicking a sidebar card should select the result, not follow links. */
:deep(a) {
  pointer-events: none;
  color: inherit;
  text-decoration: none;
}
</style>
