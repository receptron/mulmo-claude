<template>
  <div class="px-2 py-1 border-b border-gray-200 flex gap-1 items-center">
    <button
      class="flex-shrink-0 flex items-center justify-center w-7 py-1 rounded border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
      data-testid="new-session-btn"
      title="New session"
      aria-label="New session"
      @click="emit('newSession')"
    >
      <span class="material-icons text-sm">add</span>
    </button>
    <template v-for="i in 6" :key="i">
      <button
        v-if="sessions[i - 1]"
        class="flex-1 flex items-center justify-center py-1 rounded transition-colors"
        :class="
          sessions[i - 1].id === currentSessionId
            ? 'border border-gray-300 bg-white shadow-sm'
            : 'hover:bg-gray-100'
        "
        :title="
          sessions[i - 1].preview || roleName(roles, sessions[i - 1].roleId)
        "
        :data-testid="`session-tab-${sessions[i - 1].id}`"
        @click="emit('loadSession', sessions[i - 1].id)"
      >
        <span
          class="material-icons text-base"
          :class="[
            tabColor(sessions[i - 1]),
            sessions[i - 1].isRunning
              ? 'animate-spin [animation-duration:3s]'
              : '',
          ]"
          >{{ roleIcon(roles, sessions[i - 1].roleId) }}</span
        >
      </button>
      <div v-else class="flex-1" />
    </template>
    <button
      ref="historyButton"
      data-testid="history-btn"
      class="relative flex-shrink-0 flex items-center justify-center w-7 py-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      :class="{ 'text-blue-500': historyOpen }"
      title="Session history"
      @click="emit('toggleHistory')"
    >
      <span class="material-icons text-base">expand_more</span>
      <span
        v-if="activeSessionCount > 0"
        class="absolute -top-0.5 -left-0.5 min-w-[1rem] h-4 px-0.5 bg-yellow-400 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
        :title="`${activeSessionCount} active session${activeSessionCount > 1 ? 's' : ''} (agent running)`"
        >{{ activeSessionCount }}</span
      >
      <span
        v-if="unreadCount > 0"
        class="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
        :title="`${unreadCount} unread repl${unreadCount > 1 ? 'ies' : 'y'}`"
        >{{ unreadCount }}</span
      >
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { Role } from "../config/roles";
import type { SessionSummary } from "../types/session";
import { roleIcon, roleName } from "../utils/role/icon";

defineProps<{
  sessions: SessionSummary[];
  currentSessionId: string;
  roles: Role[];
  activeSessionCount: number;
  unreadCount: number;
  historyOpen: boolean;
}>();

const emit = defineEmits<{
  newSession: [];
  loadSession: [id: string];
  toggleHistory: [];
}>();

const historyButton = ref<HTMLButtonElement | null>(null);
defineExpose({ historyButton });

function tabColor(session: SessionSummary): string {
  if (session.isRunning) return "text-yellow-400";
  if (session.hasUnread) return "text-gray-900";
  return "text-gray-400";
}
</script>
