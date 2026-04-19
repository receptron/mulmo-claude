<template>
  <div
    ref="root"
    class="absolute left-0 right-0 bottom-0 bg-white border-b border-gray-200 shadow-lg z-50 overflow-y-auto"
    :style="{ top: topOffset != null ? topOffset + 'px' : '4rem' }"
  >
    <div class="p-2 space-y-1">
      <div
        v-if="errorMessage"
        class="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-1"
        role="alert"
        data-testid="session-history-error"
      >
        ⚠ Failed to refresh: {{ errorMessage }}
        <span v-if="sessions.length > 0"> — showing last known list.</span>
      </div>
      <p v-if="sessions.length === 0" class="text-xs text-gray-400 p-2">
        No sessions yet.
      </p>
      <div
        v-for="session in sessions"
        :key="session.id"
        class="cursor-pointer rounded border p-2 text-sm transition-colors"
        :class="rowClasses(session)"
        :data-testid="`session-item-${session.id}`"
        @click="emit('loadSession', session.id)"
      >
        <div class="flex items-center gap-1 text-xs text-gray-500 mb-1">
          <span class="material-icons text-xs">{{
            roleIconFor(session.roleId)
          }}</span>
          <span>{{ roleNameFor(session.roleId) }}</span>
          <span class="ml-auto flex items-center gap-1.5">
            <span
              v-if="isSessionRunning(session)"
              class="flex items-center gap-0.5 text-yellow-600 font-medium"
            >
              <span
                class="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"
              />
              Running
            </span>
            <span
              v-else-if="isSessionUnread(session)"
              class="flex items-center gap-0.5 text-gray-900 font-bold"
            >
              Unread
            </span>
            <span v-else>{{ formatDate(session.updatedAt) }}</span>
          </span>
        </div>
        <p class="truncate" :class="previewClasses(session)">
          {{ session.preview || "(no messages)" }}
        </p>
        <!-- Optional second line: AI-generated summary of the
             session, populated by the chat indexer (#123). -->
        <p v-if="session.summary" class="text-xs text-gray-500 truncate mt-0.5">
          {{ session.summary }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { Role } from "../config/roles";
import type { SessionSummary } from "../types/session";
import { formatDate } from "../utils/format/date";
import { roleIcon, roleName } from "../utils/role/icon";

const props = defineProps<{
  sessions: SessionSummary[];
  currentSessionId: string;
  roles: Role[];
  topOffset?: number;
  // Latest fetch error from useSessionHistory, or null when healthy.
  errorMessage?: string | null;
}>();

const emit = defineEmits<{
  loadSession: [id: string];
}>();

const root = ref<HTMLDivElement | null>(null);
defineExpose({ root });

function roleIconFor(id: string): string {
  return roleIcon(props.roles, id);
}
function roleNameFor(id: string): string {
  return roleName(props.roles, id);
}

function isSessionRunning(session: SessionSummary): boolean {
  return session.isRunning ?? false;
}

function isSessionUnread(session: SessionSummary): boolean {
  return session.hasUnread ?? false;
}

function rowClasses(session: SessionSummary): string {
  if (isSessionRunning(session))
    return "border-yellow-400 bg-yellow-50 hover:bg-yellow-100";
  if (isSessionUnread(session))
    return "border-sky-300 bg-sky-50 hover:bg-sky-100";
  if (session.id === props.currentSessionId)
    return "border-blue-400 bg-blue-50 hover:bg-blue-100";
  return "border-gray-200 hover:bg-gray-50";
}

function previewClasses(session: SessionSummary): string {
  if (isSessionRunning(session)) return "text-yellow-800";
  if (isSessionUnread(session)) return "text-gray-900 font-bold";
  return "text-gray-700";
}
</script>
