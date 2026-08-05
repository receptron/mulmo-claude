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
          @click="toggleFilter(f)"
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
      <!-- Handlers are passed as method references on purpose: an
           inline arrow closing over `session` would be a fresh
           function on every render of this list, so every row's props
           compare would fail and the whole list would re-render on
           each selection change — the cost SessionHistoryRow exists to
           avoid. The row hands its own session back through the emit
           payload instead. -->
      <SessionHistoryRow
        v-for="session in filteredSessions"
        :key="session.id"
        :session="session"
        :roles="roles"
        :selected="session.id === currentSessionId"
        :menu-open="openMenuId === session.id"
        @select="onSelect"
        @toggle-menu="toggleMenu"
        @toggle-bookmark="onToggleBookmark"
        @delete-session="onDelete"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onBeforeUpdate, onUpdated, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Role } from "../config/roles";
import type { SessionSummary, SessionOrigin } from "../types/session";
import { SESSION_ORIGINS } from "../types/session";
import { HISTORY_FILTERS, HISTORY_FILTER_ORDER, type HistoryFilter } from "../config/historyFilters";
import { isLongRunningConversation } from "../utils/session/longRunning";
import SessionHistoryRow from "./SessionHistoryRow.vue";
import FilterChip from "./FilterChip.vue";
import { flushRowPerf, perfLog, perfLogSinceClick, perfLogUntilPaint, perfMarkClick } from "../utils/devPerf";

const { t } = useI18n();

// ── Investigation instrumentation (see src/utils/devPerf.ts) ────────
// Off unless `localStorage["mulmoclaude:perf"] === "1"`. #2810's version
// of this measured the panel before the row split; the call sites here
// measure the same click on the fixed code — how long until the row's
// border appears, how long Vue spends patching the list, and how much
// of the per-row work still runs.
const setupStartedAt = performance.now();
let updatePassStartedAt = 0;

// `unread` and `bookmarked` are mutually exclusive with origin pills —
// selecting either shows every matching session regardless of origin,
// matching the user expectation that those are the primary questions
// ("what needs my attention?", "what did I save?") rather than origin
// sub-filters.

const props = defineProps<{
  sessions: SessionSummary[];
  currentSessionId: string;
  roles: Role[];
  // Latest fetch error from useSessionHistory, or null when healthy.
  errorMessage?: string | null;
}>();

const emit = defineEmits<{
  loadSession: [id: string];
  toggleBookmark: [id: string, bookmarked: boolean];
  deleteSession: [id: string];
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

function matchesFilter(session: SessionSummary, filter: HistoryFilter): boolean {
  if (filter === HISTORY_FILTERS.all) return true;
  if (filter === HISTORY_FILTERS.unread) return session.hasUnread === true;
  if (filter === HISTORY_FILTERS.bookmarked) return session.isBookmarked === true;
  if (filter === HISTORY_FILTERS.longRunning) return isLongRunningConversation(session);
  return originOf(session) === filter;
}

const filteredSessions = computed(() => props.sessions.filter((session) => matchesFilter(session, activeFilter.value)));

// Mirror Wiki's toggleTagFilter (plugins/wiki/View.vue): clicking the
// already-active chip resets to `all`. The `all` chip itself is a
// no-op when active — there's nothing to "deselect" back to.
function toggleFilter(filter: HistoryFilter): void {
  activeFilter.value = activeFilter.value === filter ? HISTORY_FILTERS.all : filter;
}

function countByOrigin(filterKey: HistoryFilter): number {
  if (filterKey === HISTORY_FILTERS.all) return props.sessions.length;
  return props.sessions.filter((session) => matchesFilter(session, filterKey)).length;
}

// The row's selected border is the first feedback the click produces,
// so this pair brackets the "I clicked but nothing happened yet" window.
function onSelect(sessionId: string): void {
  perfMarkClick();
  emit("loadSession", sessionId);
}

watch(
  () => props.currentSessionId,
  () => perfLogSinceClick("click→row selected"),
);

// ── Row action menu ─────────────────────────────────────────
//
// Only one popover is open at a time, tracked by session id. A
// document-level click listener closes it on any outside click; the
// kebab button and popover stop propagation so clicks inside don't
// trigger the closer (or the row's load-session handler).

const openMenuId = ref<string | null>(null);

function toggleMenu(sessionId: string): void {
  openMenuId.value = openMenuId.value === sessionId ? null : sessionId;
}

function closeMenu(): void {
  openMenuId.value = null;
}

function onToggleBookmark(session: SessionSummary): void {
  emit("toggleBookmark", session.id, !session.isBookmarked);
  closeMenu();
}

function onDelete(session: SessionSummary): void {
  const ok = window.confirm(t("sessionHistoryPanel.deleteConfirm", { preview: session.preview || t("sessionHistoryPanel.noMessages") }));
  if (!ok) return;
  emit("deleteSession", session.id);
  closeMenu();
}

onMounted(() => {
  document.addEventListener("click", closeMenu);
  perfLogUntilPaint("history-panel setup→paint", setupStartedAt, {
    rows: filteredSessions.value.length,
    totalSessions: props.sessions.length,
  });
  flushRowPerf("mount", filteredSessions.value.length);
});

// Every re-render of the list (filter change, selection change, or a
// sessions-channel refetch replacing the array) lands here. The span
// between the two hooks is the vnode diff + child patch of the whole
// list — the ~110 ms line in #2809's Safari table.
onBeforeUpdate(() => {
  updatePassStartedAt = performance.now();
});

onUpdated(() => {
  perfLog("list patch (vnode diff)", performance.now() - updatePassStartedAt, { rows: filteredSessions.value.length });
  flushRowPerf("update", filteredSessions.value.length);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeMenu);
});
</script>
