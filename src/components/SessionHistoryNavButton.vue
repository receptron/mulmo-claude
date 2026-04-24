<template>
  <!-- Navigates to the full-page `/history` route. Carries two
       session-wide status badges so the user can see the aggregate
       count even from a single-glance control:
         - active-session count (yellow, top-left)
         - unread-reply count (red, top-right)
       Rendered both in SessionTabBar (when Row 2 is showing) and in
       the side-panel header (when the panel is open and Row 2 is
       hidden) so the /history entrypoint never disappears from the
       chat surface. -->
  <button
    data-testid="history-btn"
    class="relative flex-shrink-0 flex items-center justify-center w-7 py-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
    :class="{ 'text-blue-500': historyOpen }"
    :title="t('sessionTabBar.sessionHistory')"
    @click="emit('toggleHistory')"
  >
    <span class="material-icons text-base">expand_more</span>
    <span
      v-if="activeSessionCount > 0"
      class="absolute -top-0.5 -left-0.5 min-w-[1rem] h-4 px-0.5 bg-yellow-400 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
      :title="t('sessionTabBar.activeSessions', activeSessionCount, { named: { count: activeSessionCount } })"
      >{{ activeSessionCount }}</span
    >
    <span
      v-if="unreadCount > 0"
      class="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
      :title="t('sessionTabBar.unreadReplies', unreadCount, { named: { count: unreadCount } })"
      >{{ unreadCount }}</span
    >
  </button>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  activeSessionCount: number;
  unreadCount: number;
  historyOpen: boolean;
}>();

const emit = defineEmits<{
  toggleHistory: [];
}>();
</script>
