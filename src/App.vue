<template>
  <div class="flex fixed inset-0 bg-gray-900 text-white">
    <!-- Sidebar -->
    <div
      class="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white text-gray-900 relative"
    >
      <SidebarHeader
        :sandbox-enabled="sandboxEnabled"
        :show-right-sidebar="showRightSidebar"
        :title-style="debugTitleStyle"
        @test-query="(q) => sendMessage(q)"
        @notification-navigate="handleNotificationNavigate"
        @toggle-right-sidebar="toggleRightSidebar"
        @open-settings="showSettings = true"
      />
      <!-- History popup -->
      <SessionHistoryPanel
        v-if="showHistory"
        ref="historyPanelRef"
        :sessions="mergedSessions"
        :current-session-id="currentSessionId"
        :roles="roles"
        :top-offset="historyPopupTopOffset"
        :error-message="historyError"
        @load-session="loadSession"
      />

      <!-- Role selector -->
      <RoleSelector
        v-model:current-role-id="currentRoleId"
        :roles="roles"
        @change="onRoleChange"
      />

      <!-- Session tab bar -->
      <SessionTabBar
        ref="sessionTabBarRef"
        :sessions="tabSessions"
        :current-session-id="currentSessionId"
        :roles="roles"
        :active-session-count="activeSessionCount"
        :unread-count="unreadCount"
        :history-open="showHistory"
        @new-session="createNewSession()"
        @load-session="loadSession"
        @toggle-history="toggleHistory"
      />

      <!-- Gemini API key warning -->
      <div
        v-if="!geminiAvailable && needsGemini(currentRoleId)"
        class="mx-4 mb-2 rounded border border-yellow-400 bg-yellow-50 p-3 text-xs text-yellow-700"
      >
        <span class="material-icons text-xs align-middle mr-1">warning</span>
        Image generation requires <code class="font-mono">GEMINI_API_KEY</code>.
        Add it to <code class="font-mono">.env</code> and restart the app.
      </div>

      <!-- Tool result previews -->
      <ToolResultsPanel
        ref="toolResultsPanelRef"
        :results="sidebarResults"
        :selected-uuid="selectedResultUuid"
        :is-running="isRunning"
        :status-message="statusMessage"
        :pending-calls="pendingCalls"
        @select="onSidebarItemClick"
        @activate="activePane = 'sidebar'"
      />

      <!-- Sample queries (expandable pane) -->
      <SuggestionsPanel
        ref="suggestionsPanelRef"
        :queries="currentRole.queries ?? []"
        @send="(q) => sendMessage(q)"
        @edit="onQueryEdit"
      />

      <!-- Text input -->
      <ChatInput
        ref="chatInputRef"
        v-model="userInput"
        v-model:pasted-file="pastedFile"
        :is-running="isRunning"
        @send="sendMessage()"
      />
    </div>

    <!-- Canvas -->
    <div
      class="flex-1 flex flex-col bg-white text-gray-900 min-w-0 overflow-hidden"
    >
      <div
        class="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0 gap-2"
      >
        <PluginLauncher
          :active-tool-name="selectedResult?.toolName ?? null"
          :active-view-mode="canvasViewMode"
          @navigate="onPluginNavigate"
        />
        <CanvasViewToggle
          :model-value="canvasViewMode"
          @update:model-value="setCanvasViewMode"
        />
      </div>
      <div
        ref="canvasRef"
        class="flex-1 overflow-hidden outline-none min-h-0"
        tabindex="0"
        @mousedown="activePane = 'main'"
        @keydown="handleCanvasKeydown"
      >
        <!-- Single mode -->
        <template v-if="canvasViewMode === 'single'">
          <component
            :is="getPlugin(selectedResult.toolName)?.viewComponent"
            v-if="
              selectedResult &&
              getPlugin(selectedResult.toolName)?.viewComponent
            "
            :selected-result="selectedResult"
            :send-text-message="sendMessage"
            @update-result="handleUpdateResult"
          />
          <div v-else-if="selectedResult" class="h-full overflow-auto p-6">
            <pre class="text-sm text-gray-700 whitespace-pre-wrap">{{
              JSON.stringify(selectedResult, null, 2)
            }}</pre>
          </div>
          <div
            v-else
            class="flex items-center justify-center h-full text-gray-600"
          >
            <p>Start a conversation</p>
          </div>
        </template>
        <!-- Stack mode -->
        <StackView
          v-else-if="canvasViewMode === 'stack'"
          :tool-results="sidebarResults"
          :selected-result-uuid="selectedResultUuid"
          :send-text-message="sendMessage"
          @select="(uuid) => (selectedResultUuid = uuid)"
          @update-result="handleUpdateResult"
        />
        <!-- Files mode -->
        <FilesView
          v-else-if="canvasViewMode === 'files'"
          :refresh-token="filesRefreshToken"
          @load-session="onFilesViewLoadSession"
        />
        <!-- Todos mode -->
        <TodoExplorer v-else-if="canvasViewMode === 'todos'" />
        <!-- Scheduler mode -->
        <SchedulerView v-else-if="canvasViewMode === 'scheduler'" />
        <!-- Wiki mode -->
        <WikiView v-else-if="canvasViewMode === 'wiki'" />
        <!-- Skills mode -->
        <SkillsView v-else-if="canvasViewMode === 'skills'" />
        <!-- Roles mode -->
        <RolesView v-else-if="canvasViewMode === 'roles'" />
      </div>
    </div>
    <!-- Right sidebar: tool call history -->
    <RightSidebar
      v-if="showRightSidebar"
      ref="rightSidebarRef"
      :tool-call-history="toolCallHistory"
      :available-tools="availableTools"
      :role-prompt="currentRole.prompt"
      :tool-descriptions="toolDescriptions"
    />

    <!-- Global settings modal -->
    <SettingsModal
      :open="showSettings"
      :docker-mode="sandboxEnabled"
      :mcp-tools-error="mcpToolsError"
      @update:open="showSettings = $event"
    />
    <NotificationToast />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, reactive } from "vue";
import { v4 as uuidv4 } from "uuid";
import { getPlugin } from "./tools";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import RightSidebar from "./components/RightSidebar.vue";
import SidebarHeader from "./components/SidebarHeader.vue";
import RoleSelector from "./components/RoleSelector.vue";
import SessionTabBar from "./components/SessionTabBar.vue";
import SuggestionsPanel from "./components/SuggestionsPanel.vue";
import ChatInput, { type PastedFile } from "./components/ChatInput.vue";
import SessionHistoryPanel from "./components/SessionHistoryPanel.vue";
import ToolResultsPanel from "./components/ToolResultsPanel.vue";
import CanvasViewToggle from "./components/CanvasViewToggle.vue";
import PluginLauncher, {
  type PluginLauncherTarget,
} from "./components/PluginLauncher.vue";
import StackView from "./components/StackView.vue";
import FilesView from "./components/FilesView.vue";
import TodoExplorer from "./components/TodoExplorer.vue";
import SchedulerView from "./plugins/scheduler/View.vue";
import WikiView from "./plugins/wiki/View.vue";
import SkillsView from "./plugins/manageSkills/View.vue";
import RolesView from "./plugins/manageRoles/View.vue";
import SettingsModal from "./components/SettingsModal.vue";
import NotificationToast from "./components/NotificationToast.vue";
import {
  NOTIFICATION_ACTION_TYPES,
  NOTIFICATION_VIEWS,
  type NotificationAction,
} from "./types/notification";
import { CANVAS_VIEW } from "./utils/canvas/viewMode";
import {
  useDynamicFavicon,
  FAVICON_STATES,
  type FaviconState,
} from "./composables/useDynamicFavicon";
import { useNotifications } from "./composables/useNotifications";
import type { SseEvent } from "./types/sse";
import {
  type SessionSummary,
  type SessionEntry,
  type ActiveSession,
} from "./types/session";
import { EVENT_TYPES } from "./types/events";
import { extractImageData, makeTextResult } from "./utils/tools/result";
import { findScrollableChild } from "./utils/dom/scrollable";
import { buildAgentRequestBody } from "./utils/agent/request";
import {
  findPendingToolCall,
  shouldSelectAssistantText,
} from "./utils/agent/toolCalls";
import { mergeSessionLists } from "./utils/session/mergeSessions";
import {
  parseSessionEntries,
  resolveSelectedUuid,
  resolveSessionTimestamps,
} from "./utils/session/sessionEntries";
import { usePendingCalls } from "./composables/usePendingCalls";
import { useClickOutside } from "./composables/useClickOutside";
import { useCanvasViewMode } from "./composables/useCanvasViewMode";
import { isCanvasViewMode } from "./utils/canvas/viewMode";
import { useMcpTools } from "./composables/useMcpTools";
import { useRoles } from "./composables/useRoles";
import { BUILTIN_ROLE_IDS } from "./config/roles";
import { usePubSub } from "./composables/usePubSub";
import { PUBSUB_CHANNELS, sessionChannel } from "./config/pubsubChannels";
import { useHealth } from "./composables/useHealth";
import { useSessionHistory } from "./composables/useSessionHistory";
import { useRightSidebar } from "./composables/useRightSidebar";
import { useEventListeners } from "./composables/useEventListeners";
import { provideAppApi } from "./composables/useAppApi";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import { apiGet, apiPost, apiFetchRaw } from "./utils/api";
import { API_ROUTES } from "./config/apiRoutes";

// --- Debug beat (pub/sub) ---
const debugBeatColor = ref<string | null>(null);
const debugTitleStyle = computed(() =>
  debugBeatColor.value ? { color: debugBeatColor.value } : {},
);

const { subscribe: pubsubSubscribe } = usePubSub();
pubsubSubscribe(PUBSUB_CHANNELS.debugBeat, (data) => {
  const msg = data as { count: number; last?: boolean };
  if (msg.last) {
    debugBeatColor.value = null;
  } else {
    debugBeatColor.value = msg.count % 2 === 0 ? "#3b82f6" : "#ef4444";
  }
});

// --- Sessions channel (pub/sub) ---
// Subscribe to the global `sessions` channel. The server publishes a
// bare notification (no data) whenever any session's state changes.
// The client refetches the session list via REST — the server is the
// single source of truth for isRunning, hasUnread, etc.
pubsubSubscribe(PUBSUB_CHANNELS.sessions, () => {
  refreshSessionStates();
});

async function refreshSessionStates(): Promise<void> {
  const summaries = await fetchSessions();
  for (const s of summaries) {
    const live = sessionMap.get(s.id);
    if (!live) continue;
    // Missing fields mean the server has no live entry — reset to defaults.
    live.isRunning = s.isRunning ?? false;
    live.statusMessage = s.statusMessage ?? "";
    const unread = s.hasUnread ?? false;
    // Don't mark the currently viewed session as unread
    if (!(unread && s.id === currentSessionId.value)) {
      live.hasUnread = unread;
    }
  }
}

async function markSessionRead(id: string): Promise<void> {
  const result = await apiPost<{ ok: boolean }>(
    API_ROUTES.sessions.markRead.replace(":id", encodeURIComponent(id)),
  );
  // The server returns `{ ok: boolean }` — a 200 with `ok: false`
  // means the endpoint was reached but the flag wasn't actually
  // cleared (e.g. session not found). Treat that the same as a
  // transport failure and refetch so the sidebar doesn't go stale.
  if (!result.ok || result.data.ok === false) {
    // Server didn't clear the flag — refetch to restore truth.
    await refreshSessionStates();
  }
}

// --- Routing ---
const route = useRoute();
const router = useRouter();

// --- Per-session state ---
const sessionMap = reactive(new Map<string, ActiveSession>());

// Tracks active pub/sub subscriptions per session. The unsubscribe
// function is stored so we can clean up when the session is removed
// from memory. Sessions that are running always have an active
// subscription so events arrive via WebSocket.
const sessionSubscriptions = new Map<string, () => void>();

// currentSessionId is a plain ref so that synchronous writes (e.g.
// inside createNewSession, which is called right before sendMessage
// might run) take effect immediately. The URL is kept in sync via
// navigateToSession, and external URL changes (back button, typed
// URL) feed back into the ref via the route watcher below.
//
// Earlier attempt used a computed derived from route.params, but
// router.push is async — the route param doesn't update until the
// next tick, so any code reading currentSessionId between the push
// and the tick sees the stale value ("") and drops messages silently.
const currentSessionId = ref("");

function navigateToSession(id: string, replace = false): void {
  currentSessionId.value = id;
  const method = replace ? router.replace : router.push;
  // Use buildViewQuery() (reads canvasViewMode ref) instead of raw
  // route.query — the ref may have been updated synchronously by
  // setCanvasViewMode before this navigation runs, while
  // route.query.view is still stale (router.push is async).
  // Build query: view mode + role (omit role if it's the default
  // to keep URLs clean for the common case).
  const viewQuery = buildViewQuery();
  const roleQuery =
    currentRoleId.value && currentRoleId.value !== roles.value[0]?.id
      ? { role: currentRoleId.value }
      : {};
  method({
    name: "chat",
    params: { sessionId: id },
    query: { ...viewQuery, ...roleQuery },
  }).catch((err) => {
    // NavigationDuplicated is harmless (user clicked the same session
    // they're already on). Anything else is a real bug.
    if (err?.type !== 16) {
      console.error("[navigateToSession] push failed:", err);
    }
  });
}

function handleNotificationNavigate(action: NotificationAction): void {
  if (action.type !== NOTIFICATION_ACTION_TYPES.navigate) return;
  if (action.view === NOTIFICATION_VIEWS.chat) {
    if (action.sessionId) navigateToSession(action.sessionId);
  } else if (action.view === NOTIFICATION_VIEWS.todos) {
    setCanvasViewMode(CANVAS_VIEW.todos);
  } else if (action.view === NOTIFICATION_VIEWS.scheduler) {
    setCanvasViewMode(CANVAS_VIEW.scheduler);
  } else if (action.view === NOTIFICATION_VIEWS.files) {
    setCanvasViewMode(CANVAS_VIEW.files);
  }
}

// External URL changes (back/forward button, typed URL) → update ref.
// If the session isn't in memory, load it from the server.
watch(
  () => route.params.sessionId,
  async (newId) => {
    if (typeof newId !== "string" || newId === currentSessionId.value) return;
    currentSessionId.value = newId;
    if (!sessionMap.has(newId)) {
      await loadSession(newId);
      if (!sessionMap.has(newId)) {
        createNewSession();
      }
    }
  },
);

// External URL changes for ?role= → sync into currentRoleId.
// This doesn't trigger onRoleChange (which creates a new session) —
// the user is just navigating back/forward between sessions that
// were already associated with a role.
watch(
  () => route.query.role,
  (newRole) => {
    if (typeof newRole !== "string" || newRole === currentRoleId.value) return;
    const roleExists = roles.value.some((r) => r.id === newRole);
    if (roleExists) currentRoleId.value = newRole;
  },
);

// External URL changes for ?result= → sync into the session's
// selectedResultUuid. This handles back/forward and direct URL
// access with a specific result pre-selected.
watch(
  () => route.query.result,
  (newResult) => {
    const session = sessionMap.get(currentSessionId.value);
    if (!session) return;
    const resultId = typeof newResult === "string" ? newResult : null;
    if (resultId !== session.selectedResultUuid) {
      session.selectedResultUuid = resultId;
    }
  },
);

const activeSession = computed(() => sessionMap.get(currentSessionId.value));

const toolResults = computed(() => activeSession.value?.toolResults ?? []);

// Deduplicate consecutive tool results with the same toolName for the
// sidebar preview list. Tools like manageScheduler / manageTodoList
// return the full item list on every call, so 4 consecutive scheduler
// calls produce 4 identical "22 upcoming" previews. We keep only the
// last one in each consecutive run. text-response is excluded because
// each user/assistant message is unique content.
// Deduplicate consecutive tool results that represent "full-state
// refreshes" of the same collection. Tools like manageScheduler /
// manageTodoList / manageWiki return the full list on every call
// and set `updating: true` on the response — that flag is the
// signal that the previous result is superseded, not a new artifact.
//
// Tools that create individual artifacts (generateImage,
// presentDocument, editImage) DO NOT set `updating`, so consecutive
// calls stay visible as separate preview cards. This matches the
// "tennis vs golf docs" case raised in review: two different
// documents produced in a row must both be shown.
//
// text-response is never collapsed because each user/assistant
// message is unique content.
const sidebarResults = computed(() => {
  const all = toolResults.value;
  return all.filter((r, i) => {
    if (r.toolName === "text-response") return true;
    const next = all[i + 1];
    if (!next) return true;
    if (next.toolName !== r.toolName) return true;
    // Same tool as the next item — only collapse when BOTH results
    // are full-state refreshes (updating: true). Individual-artifact
    // tools that don't set `updating` stay visible.
    return !(r.updating === true && next.updating === true);
  });
});

// Read running/status from the server session list (single source of
// truth). Falls back to sessionMap for the brief window before the
// first fetchSessions completes.
const currentSummary = computed(() =>
  sessions.value.find((s) => s.id === currentSessionId.value),
);
const isRunning = computed(
  () =>
    currentSummary.value?.isRunning ?? activeSession.value?.isRunning ?? false,
);
const statusMessage = computed(
  () =>
    currentSummary.value?.statusMessage ??
    activeSession.value?.statusMessage ??
    "",
);
const toolCallHistory = computed(
  () => activeSession.value?.toolCallHistory ?? [],
);

const selectedResultUuid = computed({
  get: () => activeSession.value?.selectedResultUuid ?? null,
  set: (val: string | null) => {
    if (activeSession.value) activeSession.value.selectedResultUuid = val;
    // Sync to URL. Null/empty → remove ?result= for clean URLs.
    const { result: __result, ...restQuery } = route.query;
    const nextQuery = val ? { ...restQuery, result: val } : restQuery;
    router.replace({ query: nextQuery }).catch((err: unknown) => {
      if (!isNavigationFailure(err)) {
        console.error("[selectedResultUuid] navigation failed:", err);
      }
    });
  },
});

const activeSessionCount = computed(
  () => sessions.value.filter((s) => s.isRunning).length,
);
const unreadCount = computed(
  () => sessions.value.filter((s) => s.hasUnread).length,
);

// --- Global state ---
const { roles, currentRoleId, currentRole, refreshRoles } = useRoles();

const userInput = ref("");
const pastedFile = ref<PastedFile | null>(null);
const activePane = ref<"sidebar" | "main">("sidebar");

const { sessions, showHistory, historyError, fetchSessions, toggleHistory } =
  useSessionHistory();
const { geminiAvailable, sandboxEnabled, fetchHealth } = useHealth();

// ── Dynamic favicon (#470) ──────────────────────────────────
const faviconState = computed<FaviconState>(() => {
  if (isRunning.value) return FAVICON_STATES.running;
  const hasUnread =
    currentSummary.value?.hasUnread ?? activeSession.value?.hasUnread ?? false;
  if (hasUnread) return FAVICON_STATES.done;
  return FAVICON_STATES.idle;
});

const { unreadCount: notificationUnreadCount } = useNotifications();
const hasNotificationBadge = computed(() => notificationUnreadCount.value > 0);

useDynamicFavicon({
  state: faviconState,
  hasNotification: hasNotificationBadge,
});

const toolResultsPanelRef = ref<{ root: HTMLDivElement | null } | null>(null);
const chatListRef = computed(() => toolResultsPanelRef.value?.root ?? null);
const canvasRef = ref<HTMLDivElement | null>(null);
const chatInputRef = ref<{ focus: () => void } | null>(null);

function focusChatInput(): void {
  chatInputRef.value?.focus();
}
const sessionTabBarRef = ref<{
  historyButton: HTMLButtonElement | null;
} | null>(null);
const historyButtonRef = computed(
  () => sessionTabBarRef.value?.historyButton ?? null,
);
// Exposed `root` from SessionHistoryPanel — the click-outside guard
// needs the actual popup DOM element (not the component instance).
const historyPanelRef = ref<{ root: HTMLDivElement | null } | null>(null);
const historyPopupRef = computed(() => historyPanelRef.value?.root ?? null);
const historyPopupTopOffset = computed(() => {
  const btn = historyButtonRef.value;
  if (!btn) return undefined;
  return btn.offsetTop + btn.offsetHeight;
});
function scrollChatToBottom() {
  nextTick(() => {
    if (chatListRef.value) {
      chatListRef.value.scrollTop = chatListRef.value.scrollHeight;
    }
  });
}

watch(() => toolResults.value.length, scrollChatToBottom);
watch(isRunning, (running) => {
  if (running) {
    scrollChatToBottom();
  } else {
    nextTick(() => focusChatInput());
  }
});

const { showRightSidebar, toggleRightSidebar } = useRightSidebar();
const showSettings = ref(false);

const {
  canvasViewMode,
  setCanvasViewMode,
  buildViewQuery,
  filesRefreshToken,
  handleViewModeShortcut,
} = useCanvasViewMode({ isRunning });
const rightSidebarRef = ref<InstanceType<typeof RightSidebar> | null>(null);

// Plugin-launcher click: switch canvas to the matching view mode.
function onPluginNavigate(target: PluginLauncherTarget): void {
  if (isCanvasViewMode(target.key)) {
    setCanvasViewMode(target.key);
  }
}

const { availableTools, toolDescriptions, mcpToolsError, fetchMcpToolsStatus } =
  useMcpTools({
    currentRole,
    getDefinition: (name) => getPlugin(name)?.toolDefinition ?? null,
  });

const { pendingCalls, teardown: teardownPendingCalls } = usePendingCalls({
  isRunning,
  toolCallHistory,
});

const selectedResult = computed(
  () =>
    toolResults.value.find((r) => r.uuid === selectedResultUuid.value) ?? null,
);

// Type-guard for the user-side branch of a text-response result. Used
// to surface the first user message as a preview for live sessions
// that haven't been persisted to disk yet.
// Merged list for the history pane: live sessions in `sessionMap`
// merged with server-only sessions, sorted newest-first by
// `updatedAt` (most recently touched floats to the top). `updatedAt`
// is bumped in `sendMessage` for live sessions and taken from the
// jsonl file mtime for server-only sessions.
//
// When a session exists on the server side (the indexer has produced
// a title / summary / keywords for it), we prefer those fields over
// the live-session fallback: a live session that was loaded from a
// pre-indexed jsonl should keep showing the AI-generated title in
// the sidebar, not regress to the raw first user message. Without
// this merge, opening an indexed session immediately clobbered its
// sidebar row with the first-user-message preview.
const mergedSessions = computed((): SessionSummary[] =>
  mergeSessionLists([...sessionMap.values()], sessions.value),
);

const tabSessions = computed(() => mergedSessions.value.slice(0, 6));

// Centralised session-switch handler: subscribe to the current session's
// pub/sub channel so we receive real-time events even if the session is
// idle (another tab may start a run). Unsubscribe from idle sessions
// when switching away (running sessions keep their subscription so they
// continue receiving events — session_finished will clean them up).
let previousSessionId: string | null = null;
watch(currentSessionId, (id) => {
  const session = sessionMap.get(id);
  // Subscribe to the new session's channel
  if (session) {
    ensureSessionSubscription(session);
  }
  // Unsubscribe from the previous session if it's not running
  if (previousSessionId && previousSessionId !== id) {
    const prevSession = sessionMap.get(previousSessionId);
    if (prevSession && !prevSession.isRunning) {
      unsubscribeSession(previousSessionId);
    }
  }
  previousSessionId = id;

  // Clear unread in both sessionMap and sessions list (for badge count),
  // then tell the server so other tabs see it too.
  const summary = sessions.value.find((s) => s.id === id);
  const wasUnread =
    (session && session.hasUnread) || (summary && summary.hasUnread);
  if (wasUnread) {
    if (session) session.hasUnread = false;
    if (summary) summary.hasUnread = false;
    markSessionRead(id);
  }
});

const SCROLL_AMOUNT = 60;

function handleCanvasKeydown(e: KeyboardEvent) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  if (!canvasRef.value) return;
  const scrollable = findScrollableChild(canvasRef.value);
  if (!scrollable) return;
  e.preventDefault();
  const delta = e.key === "ArrowDown" ? SCROLL_AMOUNT : -SCROLL_AMOUNT;
  scrollable.scrollBy({ top: delta, behavior: "smooth" });
}

function handleKeyNavigation(e: KeyboardEvent) {
  if (activePane.value !== "sidebar") return;
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  // Navigate the deduplicated sidebar list so duplicates are skipped.
  const results = sidebarResults.value;
  if (results.length === 0) return;
  const currentIndex = results.findIndex(
    (r) => r.uuid === selectedResultUuid.value,
  );
  // If the currently selected UUID is filtered out of sidebarResults
  // (e.g. an older duplicate that was hidden by dedup), jump to the
  // edge instead of an arbitrary index. ArrowDown → first item;
  // ArrowUp → last item.
  if (currentIndex === -1) {
    selectedResultUuid.value =
      e.key === "ArrowDown"
        ? results[0].uuid
        : results[results.length - 1].uuid;
    return;
  }
  const nextIndex =
    e.key === "ArrowUp"
      ? Math.max(0, currentIndex - 1)
      : Math.min(results.length - 1, currentIndex + 1);
  selectedResultUuid.value = results[nextIndex].uuid;
}

const suggestionsPanelRef = ref<{ collapse: () => void } | null>(null);

function onQueryEdit(query: string): void {
  userInput.value = query;
  nextTick(() => focusChatInput());
}

// Surface a server-side or transport-level error as a card in the
// session's chat so the user actually sees it. The status-message
// channel can't be used because `finally` clears it the moment the
// run ends.
function pushErrorMessage(session: ActiveSession, message: string): void {
  const text = `[Error] ${message}`;
  const errorResult: ToolResultComplete = {
    uuid: uuidv4(),
    toolName: "text-response",
    message: text,
    title: "Error",
    data: { text, role: "assistant", transportKind: "text-rest" },
  };
  session.toolResults.push(errorResult);
  session.selectedResultUuid = errorResult.uuid;
}

function handleUpdateResult(updatedResult: ToolResultComplete) {
  const results = activeSession.value?.toolResults;
  if (!results) return;
  const index = results.findIndex((r) => r.uuid === updatedResult.uuid);
  if (index !== -1) {
    Object.assign(results[index], updatedResult);
  }
}

// When the user clicks an item in the sidebar while the canvas is
// showing the file explorer, the previously-selected file would
// otherwise stay on screen and the click would have no visible
// effect. Auto-switch back to single mode so the clicked item
// actually shows up in the canvas.
function onSidebarItemClick(uuid: string) {
  selectedResultUuid.value = uuid;
  if (canvasViewMode.value === CANVAS_VIEW.files) {
    setCanvasViewMode(CANVAS_VIEW.single);
  }
}

// Bridge from FilesView: a user clicked a markdown link to a chat
// session (e.g. "[session abc](../../chat/abc-123.jsonl)" inside
// a journal summary). Switch the active session AND pop the canvas
// out of files mode, otherwise they'd still be staring at the file
// tree after the session loaded.
function onFilesViewLoadSession(sessionId: string): void {
  // Set view mode BEFORE loading session so that navigateToSession
  // (called inside loadSession) picks up the updated canvasViewMode
  // in its query — avoids a race where two router.push calls fight.
  if (canvasViewMode.value === CANVAS_VIEW.files) {
    setCanvasViewMode(CANVAS_VIEW.single);
  }
  loadSession(sessionId);
}

const GEMINI_PLUGINS = new Set(["generateImage", "presentDocument"]);
const needsGemini = (roleId: string) =>
  (roles.value.find((r) => r.id === roleId)?.availablePlugins ?? []).some((p) =>
    GEMINI_PLUGINS.has(p),
  );

// Remove the current session from sessionMap if it's empty (no messages).
// Returns true if a session was removed, so the caller can use
// router.replace instead of router.push to keep the empty session out
// of browser navigation history.
function removeCurrentIfEmpty(): boolean {
  const id = currentSessionId.value;
  if (!id) return false;
  const session = sessionMap.get(id);
  if (session && session.toolResults.length === 0) {
    sessionMap.delete(id);
    return true;
  }
  return false;
}

function createNewSession(roleId?: string): ActiveSession {
  // Remove the current session if it's empty (no messages exchanged).
  removeCurrentIfEmpty();

  const id = uuidv4();
  const rId = roleId ?? currentRoleId.value;
  const now = new Date().toISOString();
  const session: ActiveSession = {
    id,
    roleId: rId,
    toolResults: [],
    isRunning: false,
    statusMessage: "",
    toolCallHistory: [],
    selectedResultUuid: null,
    hasUnread: false,
    startedAt: now,
    updatedAt: now,
    runStartIndex: 0,
  };
  sessionMap.set(id, session);
  navigateToSession(id, true);
  currentRoleId.value = rId;
  suggestionsPanelRef.value?.collapse();
  nextTick(() => focusChatInput());
  return sessionMap.get(id)!;
}

function onRoleChange() {
  const session = createNewSession(currentRoleId.value);
  maybeSeedRoleDefault(session);
}

// Some roles ship with a "default view" that's useful before any
// chat exchange. Seed a synthetic tool_result so the canvas renders
// the plugin immediately on role switch, without requiring the user
// to first ask Claude to list anything. The result is client-only
// (never persisted server-side) — any subsequent LLM tool call will
// replace / augment it in the normal way.
async function maybeSeedRoleDefault(session: ActiveSession): Promise<void> {
  if (session.roleId !== BUILTIN_ROLE_IDS.sourceManager) return;
  const response = await apiGet<{ sources?: unknown[] }>(
    API_ROUTES.sources.list,
  );
  if (!response.ok) {
    // Non-fatal: the Add / Rebuild buttons remain reachable via
    // chat as soon as the user sends any message. Still surface
    // a visible hint so the blank canvas isn't a mystery.
    if (session.toolResults.length === 0) {
      const detail =
        response.status === 0 ? response.error : `HTTP ${response.status}`;
      pushErrorMessage(
        session,
        `Could not preload sources (${detail}). Ask Claude to list them, or check the server log.`,
      );
    }
    return;
  }
  const result: ToolResultComplete = {
    uuid: uuidv4(),
    toolName: "manageSource",
    message: "Loaded source registry.",
    title: "Information sources",
    data: { sources: response.data.sources ?? [] },
  };
  // Skip if the user has already produced their own result in the
  // meantime (fast typer + slow fetch race).
  if (session.toolResults.length > 0) return;
  session.toolResults.push(result);
  session.selectedResultUuid = result.uuid;
}

async function loadSession(id: string) {
  // Re-selecting the already-active, loaded session is a no-op.
  // The sessionMap check is needed because the route watcher sets
  // currentSessionId before calling loadSession — without it the
  // guard would bail before the session data is fetched.
  if (id === currentSessionId.value && sessionMap.has(id)) return;

  // If the current session is empty, remove it from memory and use
  // replace-navigation so the empty session doesn't linger in
  // browser history (back button won't revisit it).
  const replaced = removeCurrentIfEmpty();

  // Already live in memory — just switch to it. The watch on
  // currentSessionId clears the unread flag automatically.
  const live = sessionMap.get(id);
  if (live) {
    navigateToSession(id, replaced);
    currentRoleId.value = live.roleId;
    showHistory.value = false;
    return;
  }

  // Load from server
  const response = await apiGet<SessionEntry[]>(
    API_ROUTES.sessions.detail.replace(":id", encodeURIComponent(id)),
  );
  if (!response.ok) return;
  const entries = response.data;

  const meta = entries.find((e) => e.type === EVENT_TYPES.sessionMeta);
  const roleId = meta?.roleId ?? currentRoleId.value;
  const toolResultsList = parseSessionEntries(entries);
  const urlResult =
    typeof route.query.result === "string" ? route.query.result : null;
  const resolvedSelectedUuid = resolveSelectedUuid(toolResultsList, urlResult);
  // Use server summary for live state (isRunning, etc.) and timestamps
  const serverSummary = sessions.value.find((s) => s.id === id);
  const { startedAt, updatedAt } = resolveSessionTimestamps(
    serverSummary,
    new Date().toISOString(),
  );

  const newSession: ActiveSession = {
    id,
    roleId,
    toolResults: toolResultsList,
    isRunning: serverSummary?.isRunning ?? false,
    statusMessage: serverSummary?.statusMessage ?? "",
    toolCallHistory: [],
    selectedResultUuid: resolvedSelectedUuid,
    hasUnread: false,
    startedAt,
    updatedAt,
    runStartIndex: toolResultsList.length,
  };
  sessionMap.set(id, newSession);
  // Subscribe immediately — the watch(currentSessionId) may have
  // already fired before the session was in sessionMap (e.g. when
  // opened via URL), so it couldn't subscribe at that point.
  // Use sessionMap.get() to obtain the reactive proxy — passing the
  // raw object would bypass Vue's reactivity tracking.
  const reactiveSession = sessionMap.get(id)!;
  ensureSessionSubscription(reactiveSession);
  navigateToSession(id, replaced);
  currentRoleId.value = roleId;
  showHistory.value = false;
}

// Re-fetch the transcript from the server and patch any entries the
// client missed (e.g. due to a pub-sub disconnect during a long
// Docker build). Called on session_finished so the user sees the
// full response even if mid-run events were lost. See issue #350.
async function refreshSessionTranscript(sessionId: string): Promise<void> {
  const session = sessionMap.get(sessionId);
  if (!session) return;
  const response = await apiGet<SessionEntry[]>(
    API_ROUTES.sessions.detail.replace(":id", encodeURIComponent(sessionId)),
  );
  if (!response.ok) return;
  const serverResults = parseSessionEntries(response.data);
  // Only patch if the server knows more than we do — avoids
  // replacing a richer in-flight state with a stale snapshot when
  // session_finished races with the last few events.
  if (serverResults.length > session.toolResults.length) {
    session.toolResults = serverResults;
  }
}

// Seed the session state for a fresh user turn. Not pure (mutates
// session), but isolated so sendMessage doesn't have the init
// pattern inline. Writes `runStartIndex` onto the session — the
// index into toolResults at which this run's outputs start, used
// later to decide whether a trailing text response becomes the
// selected canvas result.
function beginUserTurn(session: ActiveSession, message: string): void {
  // Append the user's message so it renders immediately. State like
  // isRunning / statusMessage is NOT set here — it comes from the
  // server via the `sessions` channel notification → refetch cycle,
  // keeping all clients (including the initiator) in sync.
  session.updatedAt = new Date().toISOString();
  session.toolResults.push(makeTextResult(message, "user"));
  session.runStartIndex = session.toolResults.length;
}

// Subscribe to a session's pub/sub channel so events from the server
// (tool_call, text, tool_result, session_finished, etc.) arrive via
// WebSocket and are dispatched into the session's reactive state.
// Returns the unsubscribe function. Idempotent — if a subscription
// already exists for this session, it's reused.
function ensureSessionSubscription(session: ActiveSession): void {
  if (sessionSubscriptions.has(session.id)) return;

  const sessionId = session.id;
  const ctx: AgentEventContext = {
    get session() {
      // Always resolve from sessionMap so we track the latest
      // reactive proxy — loadSession may replace the object.
      return sessionMap.get(sessionId) ?? session;
    },
    setCurrentRoleId: (roleId) => {
      currentRoleId.value = roleId;
    },
    onRoleChange,
    refreshRoles,
    scrollSidebarToBottom: () => rightSidebarRef.value?.scrollToBottom(),
  };

  const channel = sessionChannel(session.id);
  const unsub = pubsubSubscribe(channel, (data) => {
    const event = data as SseEvent;
    if (!event || typeof event !== "object") return;

    // session_finished signals end-of-run. If the user is viewing
    // this session, clear unread and keep the subscription alive so
    // we receive events if another tab starts a new run. Only
    // unsubscribe sessions the user is NOT currently viewing — the
    // watch(currentSessionId) handler cleans up when switching away.
    if (event.type === EVENT_TYPES.sessionFinished) {
      // Recover any events lost due to pub-sub disconnects during
      // long runs (e.g. Docker builds). Fire-and-forget; if the
      // re-fetch fails the user still has whatever events arrived
      // via the live stream + can reload manually. See #350.
      refreshSessionTranscript(session.id);
      if (currentSessionId.value === session.id) {
        markSessionRead(session.id);
      } else {
        unsubscribeSession(session.id);
      }
      return;
    }

    applyAgentEvent(event, ctx);
  });

  sessionSubscriptions.set(session.id, unsub);
}

function unsubscribeSession(chatSessionId: string): void {
  const unsub = sessionSubscriptions.get(chatSessionId);
  if (unsub) {
    unsub();
    sessionSubscriptions.delete(chatSessionId);
  }
}

// Dispatch a single event from the agent pub/sub channel against an
// active session. Hoisted so its switch counts toward its own
// cognitive-complexity budget rather than ballooning the caller's
// score. Reactive refs / callbacks that live in the setup scope are
// passed via `ctx` — this keeps the handler a regular named function
// with a clear signature.
interface AgentEventContext {
  session: ActiveSession;
  setCurrentRoleId: (roleId: string) => void;
  onRoleChange: () => void;
  refreshRoles: () => Promise<void>;
  scrollSidebarToBottom: () => void;
}

// Try to append a text chunk to the last assistant text-response
// result in the session. Returns true if appended, false if a new
// result should be created instead. Extracted to keep
// applyAgentEvent under the cognitive-complexity threshold.
function appendToLastAssistantText(
  session: ActiveSession,
  text: string,
): boolean {
  const last = session.toolResults[session.toolResults.length - 1];
  const lastData = last?.data as { role?: string; text?: string } | undefined;
  if (last?.toolName !== "text-response" || lastData?.role !== "assistant") {
    return false;
  }
  lastData.text = (lastData.text ?? "") + text;
  last.message = (last.message ?? "") + text;
  return true;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing 15; streaming append adds 1
async function applyAgentEvent(
  event: SseEvent,
  ctx: AgentEventContext,
): Promise<void> {
  const { session } = ctx;
  switch (event.type) {
    case EVENT_TYPES.toolCall:
      session.toolCallHistory.push({
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        args: event.args,
        timestamp: Date.now(),
      });
      ctx.scrollSidebarToBottom();
      return;
    case EVENT_TYPES.toolCallResult: {
      const entry = findPendingToolCall(
        session.toolCallHistory,
        event.toolUseId,
      );
      if (entry) entry.result = event.content;
      ctx.scrollSidebarToBottom();
      return;
    }
    case EVENT_TYPES.status:
      session.statusMessage = event.message;
      return;
    case EVENT_TYPES.switchRole:
      setTimeout(() => {
        ctx.setCurrentRoleId(event.roleId);
        ctx.onRoleChange();
      }, 0);
      return;
    case EVENT_TYPES.rolesUpdated:
      await ctx.refreshRoles();
      return;
    case EVENT_TYPES.text: {
      const source = event.source ?? "assistant";
      if (source === "user") {
        // The tab that sent the message already added it locally via
        // beginUserTurn. Deduplicate: skip if the last text-response
        // is a user message with identical text.
        const last = session.toolResults[session.toolResults.length - 1];
        const lastData = last?.data as
          | { role?: string; text?: string }
          | undefined;
        if (
          last?.toolName === "text-response" &&
          lastData?.role === "user" &&
          lastData?.text === event.message
        )
          return;
        session.toolResults.push(makeTextResult(event.message, "user"));
        return;
      }
      // Streaming: append to the last assistant text-response if one
      // exists, rather than creating a new card per chunk.
      if (appendToLastAssistantText(session, event.message)) return;
      const textResult = makeTextResult(event.message, "assistant");
      session.toolResults.push(textResult);
      if (
        shouldSelectAssistantText(session.toolResults, session.runStartIndex)
      ) {
        session.selectedResultUuid = textResult.uuid;
      }
      return;
    }
    case EVENT_TYPES.toolResult: {
      const { result } = event;
      const existing = session.toolResults.findIndex(
        (r) => r.uuid === result.uuid,
      );
      if (existing >= 0) {
        session.toolResults[existing] = result;
      } else {
        session.toolResults.push(result);
        session.selectedResultUuid = result.uuid;
      }
      return;
    }
    case EVENT_TYPES.error:
      console.error("[agent] error event:", event.message);
      pushErrorMessage(session, event.message);
      return;
    case EVENT_TYPES.sessionFinished:
      // Handled in the subscription callback — no-op here.
      return;
  }
}

async function sendMessage(text?: string) {
  const message = typeof text === "string" ? text : userInput.value.trim();
  if (!message || isRunning.value) return;
  userInput.value = "";
  const fileSnapshot = pastedFile.value;
  pastedFile.value = null;

  const session = sessionMap.get(currentSessionId.value);
  if (!session) return;

  beginUserTurn(session, message);
  const sessionRole =
    roles.value.find((r) => r.id === session.roleId) ?? roles.value[0];
  const selectedRes =
    session.toolResults.find((r) => r.uuid === session.selectedResultUuid) ??
    undefined;

  // Subscribe to the session's pub/sub channel BEFORE posting so we
  // don't miss events. The subscription callback dispatches each
  // event into the session's reactive state via applyAgentEvent.
  ensureSessionSubscription(session);

  try {
    const response = await apiFetchRaw(API_ROUTES.agent.run, {
      method: "POST",
      body: JSON.stringify(
        buildAgentRequestBody({
          message,
          role: sessionRole,
          chatSessionId: session.id,
          selectedImageData:
            fileSnapshot?.dataUrl ?? extractImageData(selectedRes),
        }),
      ),
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      pushErrorMessage(
        session,
        `Server error ${response.status}: ${errBody.slice(0, 200)}`,
      );
      unsubscribeSession(session.id);
    }
  } catch (e) {
    console.error("[agent] fetch error:", e);
    pushErrorMessage(
      session,
      e instanceof Error ? e.message : "Connection error.",
    );
    unsubscribeSession(session.id);
  }
}

const { handler: handleClickOutsideHistory } = useClickOutside({
  isOpen: showHistory,
  buttonRef: historyButtonRef,
  popupRef: historyPopupRef,
});

// Plugin Views call back into App.vue via provide/inject (#227).
provideAppApi({
  refreshRoles,
  sendMessage: (message: string) => sendMessage(message),
});

useEventListeners({
  onKeyNavigation: handleKeyNavigation,
  onViewModeShortcut: handleViewModeShortcut,
  onClickOutsideHistory: handleClickOutsideHistory,
  onTeardown: teardownPendingCalls,
});

onMounted(async () => {
  // Fire-and-forget side fetches.
  fetchHealth();
  fetchMcpToolsStatus();
  fetchSessions();
  // Roles must be loaded before the first session is created, so
  // createNewSession() picks a roleId that exists in the merged
  // role list (built-in + custom).
  await refreshRoles();

  // If the URL specifies a role, apply it before session creation.
  const urlRole =
    typeof route.query.role === "string" ? route.query.role : null;
  if (urlRole && roles.value.some((r) => r.id === urlRole)) {
    currentRoleId.value = urlRole;
  }

  // If the URL already names a session (e.g. a bookmarked link or a
  // page reload), try to load it. Otherwise create a fresh one.
  const initialSessionId = currentSessionId.value;
  if (initialSessionId) {
    await loadSession(initialSessionId);
    // loadSession is a no-op when the server returns 404 — in that
    // case sessionMap won't have the id, so fall through to create.
    if (!sessionMap.has(initialSessionId)) {
      createNewSession();
    }
  } else {
    createNewSession();
  }
});
</script>
