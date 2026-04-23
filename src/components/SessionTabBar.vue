<template>
  <div class="flex-1 flex gap-1 items-center min-w-0">
    <button
      class="flex-shrink-0 flex items-center justify-center w-7 py-1 rounded border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
      data-testid="new-session-btn"
      :title="t('sessionTabBar.newSession')"
      :aria-label="t('sessionTabBar.newSession')"
      @click="emit('newSession')"
    >
      <span class="material-icons text-sm">add</span>
    </button>
    <template v-for="i in 6" :key="i">
      <button
        v-if="sessions[i - 1]"
        class="relative flex-1 min-w-0 flex items-center justify-start gap-1.5 pl-2 pr-2 py-1 rounded overflow-hidden transition-colors"
        :class="sessions[i - 1].id === currentSessionId ? 'border border-gray-300 bg-white shadow-sm' : 'hover:bg-gray-100'"
        :title="tabTooltip(sessions[i - 1])"
        :data-testid="`session-tab-${sessions[i - 1].id}`"
        :aria-current="sessions[i - 1].id === currentSessionId ? 'page' : undefined"
        @click="emit('loadSession', sessions[i - 1].id)"
      >
        <!-- Single icon slot. Non-human sessions swap the role
             icon for a coloured origin glyph (schedule / build /
             sync_alt) so the origin is readable at a glance
             without stacking two icons next to each other.
             Human sessions keep the role icon. Origin info is
             also prepended to the tab `title` tooltip. -->
        <span
          class="material-icons text-base leading-none shrink-0"
          :class="[iconColor(sessions[i - 1]), sessions[i - 1].isRunning ? 'animate-spin [animation-duration:3s]' : '']"
          :aria-label="iconAriaLabel(sessions[i - 1]) || undefined"
          >{{ iconGlyph(sessions[i - 1]) }}</span
        >
        <span class="text-xs text-gray-700 truncate min-w-0">{{ tabLabel(sessions[i - 1]) }}</span>
        <!-- Unread dot. Suppressed only when the user is actually
             looking at that chat session — otherwise
             `currentSessionId` keeps pointing at the last chat
             even when the user is on /wiki, /files, etc., and the
             dot would silently disappear on the tab that most
             needs it. -->
        <span
          v-if="sessions[i - 1].hasUnread && !(isChatPage && sessions[i - 1].id === currentSessionId)"
          class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white"
          :aria-label="t('sessionTabBar.unreadDot')"
        />
      </button>
      <div v-else class="flex-1" />
    </template>
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
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { Role } from "../config/roles";
import { SESSION_ORIGINS, type SessionOrigin, type SessionSummary } from "../types/session";
import { roleIcon, roleName } from "../utils/role/icon";

const { t } = useI18n();

const props = defineProps<{
  sessions: SessionSummary[];
  currentSessionId: string;
  // `currentSessionId` is "the last chat session the user was on".
  // It does NOT clear when the user navigates to /wiki /files etc.,
  // so we need a separate flag to know whether that session is
  // actually on-screen. Only then does it make sense to suppress
  // the unread dot on its tab.
  isChatPage: boolean;
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

// Colour for the tab's main icon. Running always wins (yellow
// is the "work-in-progress" signal), then origin colour for
// scheduler / skill / bridge, then the standard active / idle
// greys for human sessions.
function iconColor(session: SessionSummary): string {
  if (session.isRunning) return "text-yellow-400";
  const origin = originMeta(session.origin);
  if (origin) return origin.color;
  if (session.hasUnread) return "text-gray-900";
  return "text-gray-400";
}

// Which material-icons glyph to render in the tab's icon slot.
// Non-human sessions surface origin (scheduler / skill / bridge)
// instead of the role icon — role is still available via the
// `title` tooltip's fallback chain.
function iconGlyph(session: SessionSummary): string {
  const origin = originMeta(session.origin);
  if (origin) return origin.glyph;
  return roleIcon(props.roles, session.roleId);
}

// `aria-label` announces the origin for non-human sessions
// (human sessions get nothing — the tab `title` already covers
// them and a redundant aria-label just doubles the screen
// reader's output).
function iconAriaLabel(session: SessionSummary): string {
  return originTooltip(session.origin);
}

// Short label shown next to the role icon so users can tell
// sessions apart at a glance. Prefers the indexer-generated
// `summary` (title-like), falls back to the first user-message
// `preview`, finally the role name so a brand-new empty session
// still has a visible identifier. We rely on CSS `truncate` for
// the visual cap; this char cap just keeps the DOM text short
// enough that layout doesn't overflow before clipping kicks in.
const MAX_LABEL_CHARS = 20;
function tabLabel(session: SessionSummary): string {
  const src = (session.summary ?? session.preview ?? "").trim();
  if (src.length > 0) return src.slice(0, MAX_LABEL_CHARS);
  return roleName(props.roles, session.roleId);
}

// Tooltip on the tab button itself. Combines the origin name
// (so mouse users hovering can see "Started by scheduler" — the
// glyph aria-label is not exposed as a native tooltip) with the
// session summary / preview / role fallback chain.
function tabTooltip(session: SessionSummary): string {
  const body = session.summary || session.preview || roleName(props.roles, session.roleId);
  const origin = originTooltip(session.origin);
  return origin ? `${origin} · ${body}` : body;
}

// Glyph + colour for the top-left origin mark on non-human
// sessions. Material-icons names (shape) plus a tailwind text
// colour together give scheduler / skill / bridge a recognisable
// signature at a glance.
function originMeta(origin: SessionOrigin | undefined): { glyph: string; color: string } | null {
  if (!origin || origin === SESSION_ORIGINS.human) return null;
  if (origin === SESSION_ORIGINS.scheduler) return { glyph: "schedule", color: "text-blue-500" };
  if (origin === SESSION_ORIGINS.skill) return { glyph: "build", color: "text-emerald-500" };
  if (origin === SESSION_ORIGINS.bridge) return { glyph: "sync_alt", color: "text-purple-500" };
  return null;
}

function originTooltip(origin: SessionOrigin | undefined): string {
  if (!origin || origin === SESSION_ORIGINS.human) return "";
  return t(`sessionTabBar.origin.${origin}`);
}
</script>
