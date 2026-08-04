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
      <div
        v-for="session in filteredSessions"
        :key="session.id"
        tabindex="0"
        role="button"
        :aria-label="rowAriaLabel(session)"
        :title="primaryText(session)"
        class="relative cursor-pointer rounded p-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        :class="rowClasses(session)"
        :data-testid="`session-item-${session.id}`"
        @click="onRowClick(session.id)"
        @keydown.enter.prevent.self="(e) => !e.repeat && emit('loadSession', session.id)"
        @keydown.space.prevent.self="(e) => !e.repeat && emit('loadSession', session.id)"
      >
        <!-- Timestamp pill straddling the top border, mirroring the
             SessionSidebar card design. The kebab "..." button sits
             next to it on the same border line — clicking opens a
             popover with delete + bookmark actions. The running
             indicator still renders inline in the meta line below
             (it's a status, not a time); unread is signalled through
             previewClasses (bold text); bookmark state is signalled
             via the green role icon. -->
        <div class="absolute top-0 right-6 -translate-y-1/2 flex items-center gap-1 bg-white px-1 leading-none">
          <span class="text-[10px] text-gray-400 pointer-events-none">{{ rowTimestamp(session) }}</span>
          <button
            type="button"
            class="flex items-center justify-center px-0.5 border border-gray-300 rounded-md text-gray-400 hover:text-gray-700 hover:border-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
            :aria-label="t('sessionHistoryPanel.rowMenuAria')"
            :data-testid="`session-row-menu-${session.id}`"
            @click.stop="toggleMenu(session.id)"
            @keydown.enter.stop
            @keydown.space.stop
          >
            <span class="material-icons !text-[14px] leading-none" aria-hidden="true">more_horiz</span>
          </button>
        </div>
        <div
          v-if="openMenuId === session.id"
          class="absolute top-2 right-2 z-10 min-w-[140px] rounded border border-gray-200 bg-white shadow-md py-1 text-xs"
          role="menu"
          :data-testid="`session-row-menu-popover-${session.id}`"
          @click.stop
        >
          <button
            type="button"
            role="menuitem"
            class="block w-full text-left px-3 py-1.5 hover:bg-gray-100"
            :data-testid="`session-row-bookmark-${session.id}`"
            @click.stop="onToggleBookmark(session)"
          >
            {{ session.isBookmarked ? t("sessionHistoryPanel.unbookmark") : t("sessionHistoryPanel.bookmark") }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="block w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50"
            :data-testid="`session-row-delete-${session.id}`"
            @click.stop="onDelete(session)"
          >
            {{ t("sessionHistoryPanel.delete") }}
          </button>
        </div>
        <!-- Primary line prefers the AI-generated summary (chat indexer,
             #123) when present — it's typically more informative than
             the first user message. Fall back to the first user message,
             then to a "no messages" placeholder. `line-clamp-2` lets a
             summary wrap so more of it is readable at a glance; the raw
             first-message fallback stays on a single line via `truncate`
             so short prompts don't disturb row heights. -->
        <div class="flex items-start gap-1.5">
          <SessionRoleIcon :session="session" :roles="roles" size="sm" class="flex-shrink-0 mt-0.5" />
          <p class="flex-1 min-w-0" :class="[previewClasses(session), sessionHasVisibleSummary(session) ? 'line-clamp-2' : 'truncate']">
            {{ primaryText(session) }}
          </p>
          <span v-if="isSessionRunning(session)" class="flex-shrink-0 flex items-center mt-0.5" :aria-label="t('sessionHistoryPanel.running')">
            <span class="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onUpdated, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Role } from "../config/roles";
import type { SessionSummary, SessionOrigin } from "../types/session";
import { SESSION_ORIGINS } from "../types/session";
import { HISTORY_FILTERS, HISTORY_FILTER_ORDER, type HistoryFilter } from "../config/historyFilters";
import { isLongRunningConversation } from "../utils/session/longRunning";
import { resolveSessionPrimaryText, sessionHasVisibleSummary } from "../utils/session/sessionPreview";
import { formatDate } from "../utils/format/date";
import SessionRoleIcon from "./SessionRoleIcon.vue";
import FilterChip from "./FilterChip.vue";
import { createPerfAccumulator, perfLogSinceClick, perfLogUntilPaint, perfMarkClick } from "../utils/devPerf";

const { t } = useI18n();

// ── Investigation instrumentation (see src/utils/devPerf.ts) ────────
// Off unless `localStorage["mulmoclaude:perf"] === "1"`. Splits the
// panel's render cost into the three per-row calls the template makes,
// so "the list is slow" resolves into which of them dominates.
const setupStartedAt = performance.now();
const timestampCost = createPerfAccumulator();
const ariaCost = createPerfAccumulator();
const primaryTextCost = createPerfAccumulator();

function flushRowCosts(pass: string, rows: number): void {
  timestampCost.flush(`${pass}: formatDate()`, { rows });
  ariaCost.flush(`${pass}: t(openRowAria)`, { rows });
  primaryTextCost.flush(`${pass}: primaryText()`, { rows });
}

function rowTimestamp(session: SessionSummary): string {
  return timestampCost.add(() => formatDate(session.updatedAt));
}

function rowAriaLabel(session: SessionSummary): string {
  return ariaCost.add(() => t("sessionHistoryPanel.openRowAria", { preview: primaryText(session) }));
}

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

// The row's selected border is the first feedback the click produces.
// It cannot appear until loadSession has finished, so this measures the
// "I clicked but nothing happened yet" window directly.
function onRowClick(sessionId: string): void {
  perfMarkClick();
  emit("loadSession", sessionId);
}

watch(
  () => props.currentSessionId,
  () => perfLogSinceClick("click→row selected"),
);

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

// Primary line resolution: prefer the AI summary (trim + whitespace
// guarded so a summarizer returning "   " doesn't blank the row) →
// first user message → localised placeholder. Same call is used for
// visible text, aria-label, and the hover title so all three stay in
// lockstep.
function primaryText(session: SessionSummary): string {
  return primaryTextCost.add(() => resolveSessionPrimaryText(session) ?? t("sessionHistoryPanel.noMessages"));
}

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
  flushRowCosts("mount", filteredSessions.value.length);
});

// Every re-render of the list (filter change, selection change, or a
// sessions-channel refetch replacing the array) lands here.
onUpdated(() => {
  flushRowCosts("update", filteredSessions.value.length);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeMenu);
});
</script>
