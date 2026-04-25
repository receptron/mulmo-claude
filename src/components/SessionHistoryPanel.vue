<template>
  <!-- Rendered as the canvas-column content for the /history route
       (see plans/done/feat-history-url-route.md). Previously this was an
       absolute-positioned overlay; the `h-full overflow-y-auto` root
       plus inline flow replaces the z-index + topOffset plumbing. -->
  <div ref="root" class="h-full overflow-y-auto bg-white select-none">
    <div class="p-2 space-y-2">
      <!-- Origin filter bar -->
      <div class="flex gap-1 mb-3 flex-wrap" data-testid="session-filter-bar">
        <FilterChip
          v-for="f in HISTORY_FILTER_ORDER"
          :key="f"
          :active="activeFilter === f"
          :label="t(`sessionHistoryPanel.filters.${f}`)"
          :count="f === HISTORY_FILTERS.all ? undefined : countByOrigin(f)"
          :data-testid="`session-filter-${f}`"
          @click="activeFilter = f"
        />
      </div>

      <div
        v-if="errorMessage"
        class="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-1"
        role="alert"
        data-testid="session-history-error"
      >
        {{ t("sessionHistoryPanel.failedToRefresh", { error: errorMessage }) }}
        <span v-if="sessions.length > 0">{{ t("sessionHistoryPanel.showingLastKnown") }}</span>
      </div>
      <p v-if="filteredSessions.length === 0" class="text-xs text-gray-400 p-2">
        {{ activeFilter === HISTORY_FILTERS.all ? t("sessionHistoryPanel.noSessions") : t("sessionHistoryPanel.noMatching") }}
      </p>
      <div
        v-for="session in filteredSessions"
        :key="session.id"
        tabindex="0"
        role="button"
        :aria-label="t('sessionHistoryPanel.openRowAria', { preview: session.preview || t('sessionHistoryPanel.noMessages') })"
        class="relative cursor-pointer rounded p-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        :class="rowClasses(session)"
        :data-testid="`session-item-${session.id}`"
        @click="emit('loadSession', session.id)"
        @keydown.enter.prevent.self="(e) => !e.repeat && emit('loadSession', session.id)"
        @keydown.space.prevent.self="(e) => !e.repeat && emit('loadSession', session.id)"
      >
        <!-- Timestamp pill straddling the top border, mirroring the
             ToolResultsPanel card design. The running indicator
             still renders inline in the meta line below (it's a
             status, not a time); unread is signalled solely through
             previewClasses (bold text). -->
        <span class="absolute top-0 right-2 -translate-y-1/2 bg-white px-1 text-[10px] text-gray-400 leading-none pointer-events-none">
          {{ formatDate(session.updatedAt) }}
        </span>
        <div class="flex items-center gap-1.5">
          <SessionRoleIcon :session="session" :roles="roles" size="sm" />
          <p class="truncate flex-1 min-w-0" :class="previewClasses(session)">
            {{ session.preview || t("sessionHistoryPanel.noMessages") }}
          </p>
          <span v-if="isSessionRunning(session)" class="flex-shrink-0 flex items-center" :aria-label="t('sessionHistoryPanel.running')">
            <span class="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
          </span>
        </div>
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
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Role } from "../config/roles";
import type { SessionSummary, SessionOrigin } from "../types/session";
import { SESSION_ORIGINS } from "../types/session";
import { HISTORY_FILTERS, HISTORY_FILTER_ORDER, type HistoryFilter } from "../config/historyFilters";
import { formatDate } from "../utils/format/date";
import SessionRoleIcon from "./SessionRoleIcon.vue";
import FilterChip from "./FilterChip.vue";

const { t } = useI18n();

// `unread` is mutually exclusive with origin pills — selecting it
// shows every unread-flagged session regardless of origin, matching
// the user expectation that "unread" is the primary question ("what
// needs my attention?") rather than an origin sub-filter.

const props = defineProps<{
  sessions: SessionSummary[];
  currentSessionId: string;
  roles: Role[];
  // Latest fetch error from useSessionHistory, or null when healthy.
  errorMessage?: string | null;
}>();

const emit = defineEmits<{
  loadSession: [id: string];
}>();

const root = ref<HTMLDivElement | null>(null);
defineExpose({ root });

// ── Filter ──────────────────────────────────────────────────

// Panel-local state. Resets to `all` when the panel unmounts —
// persisting across mounts didn't earn its keep (no deep-link story
// now that /history is gone), and keeping it local avoids leaking
// panel UI state into a global store.
const activeFilter = ref<HistoryFilter>(HISTORY_FILTERS.all);

function originOf(session: SessionSummary): SessionOrigin {
  return session.origin ?? SESSION_ORIGINS.human;
}

const filteredSessions = computed(() => {
  if (activeFilter.value === HISTORY_FILTERS.all) return props.sessions;
  if (activeFilter.value === HISTORY_FILTERS.unread) return props.sessions.filter((session) => session.hasUnread === true);
  return props.sessions.filter((session) => originOf(session) === activeFilter.value);
});

function countByOrigin(filterKey: HistoryFilter): number {
  if (filterKey === HISTORY_FILTERS.all) return props.sessions.length;
  if (filterKey === HISTORY_FILTERS.unread) return props.sessions.filter((session) => session.hasUnread === true).length;
  return props.sessions.filter((session) => originOf(session) === filterKey).length;
}

function isSessionRunning(session: SessionSummary): boolean {
  return session.isRunning ?? false;
}

function isSessionUnread(session: SessionSummary): boolean {
  return session.hasUnread ?? false;
}

function rowClasses(session: SessionSummary): string {
  if (session.id === props.currentSessionId) return "border-2 border-blue-500 hover:bg-gray-50";
  return "border border-gray-200 hover:bg-gray-50";
}

function previewClasses(session: SessionSummary): string {
  if (isSessionUnread(session)) return "text-gray-900 font-bold";
  return "text-gray-700";
}
</script>
