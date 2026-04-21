<template>
  <div class="flex flex-col fixed inset-0 bg-gray-900 text-white">
    <!-- Global top bar — shown in every view mode -->
    <div ref="topBarRef" class="shrink-0 bg-white text-gray-900">
      <!-- Row 1: title + plugin launcher -->
      <div class="flex items-center gap-3 px-3 py-2 border-b border-gray-200">
        <SidebarHeader
          :sandbox-enabled="sandboxEnabled"
          :show-right-sidebar="showRightSidebar"
          :title-style="debugTitleStyle"
          @test-query="(q) => sendMessage(q)"
          @notification-navigate="handleNotificationNavigate"
          @toggle-right-sidebar="toggleRightSidebar"
          @open-settings="showSettings = true"
        />
        <div class="flex-1 min-w-0">
          <PluginLauncher
            :active-tool-name="selectedResult?.toolName ?? null"
            :active-view-mode="canvasViewMode"
            @navigate="onPluginNavigate"
          />
        </div>
      </div>
      <!-- Row 2: canvas toggle + role selector + session tabs -->
      <div class="flex items-center gap-3 px-3 py-2 border-b border-gray-100">
        <CanvasViewToggle
          :model-value="canvasViewMode"
          @update:model-value="setCanvasViewMode"
        />
        <RoleSelector
          v-model:current-role-id="currentRoleId"
          :roles="roles"
          @change="onRoleChange"
        />
        <SessionTabBar
          ref="sessionTabBarRef"
          :sessions="tabSessions"
          :current-session-id="displayedCurrentSessionId"
          :roles="roles"
          :active-session-count="activeSessionCount"
          :unread-count="unreadCount"
          :history-open="showHistory"
          @new-session="handleNewSessionClick"
          @load-session="handleSessionSelect"
          @toggle-history="toggleHistory"
        />
      </div>
    </div>

    <!-- History popup (all layouts) -->
    <SessionHistoryPanel
      v-if="showHistory"
      ref="historyPanelRef"
      :sessions="mergedSessions"
      :current-session-id="currentSessionId"
      :roles="roles"
      :top-offset="historyTopOffset"
      :error-message="historyError"
      @load-session="handleSessionSelect"
    />

    <!-- Body: sidebar (Single only) + canvas column + right sidebar -->
    <div class="flex flex-1 min-h-0">
      <!-- Sidebar (Single layout only) -->
      <div
        v-if="!isStackLayout"
        class="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white text-gray-900 relative"
      >
        <!-- Gemini API key warning -->
        <div
          v-if="!geminiAvailable && needsGemini(currentRoleId)"
          class="mx-4 mt-3 mb-2 rounded border border-yellow-400 bg-yellow-50 p-3 text-xs text-yellow-700 shrink-0"
        >
          <span class="material-icons text-xs align-middle mr-1">warning</span>
          Image generation requires
          <code class="font-mono">GEMINI_API_KEY</code>. Add it to
          <code class="font-mono">.env</code> and restart the app.
        </div>

        <!-- Tool result previews -->
        <ToolResultsPanel
          ref="toolResultsPanelRef"
          :results="sidebarResults"
          :selected-uuid="selectedResultUuid"
          :result-timestamps="activeSession?.resultTimestamps ?? new Map()"
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

      <!-- Canvas column -->
      <div
        class="flex-1 flex flex-col bg-white text-gray-900 min-w-0 overflow-hidden relative"
      >
        <!-- Gemini API key warning (Stack layouts — no sidebar to host it) -->
        <div
          v-if="isStackLayout && !geminiAvailable && needsGemini(currentRoleId)"
          class="mx-3 mt-2 rounded border border-yellow-400 bg-yellow-50 p-2 text-xs text-yellow-700 shrink-0"
        >
          <span class="material-icons text-xs align-middle mr-1">warning</span>
          Image generation requires
          <code class="font-mono">GEMINI_API_KEY</code>. Add it to
          <code class="font-mono">.env</code> and restart the app.
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
            :result-timestamps="activeSession?.resultTimestamps ?? new Map()"
            :send-text-message="sendMessage"
            @select="(uuid) => (selectedResultUuid = uuid)"
            @update-result="handleUpdateResult"
          />
          <!-- Files mode -->
          <FilesView
            v-else-if="canvasViewMode === 'files'"
            :refresh-token="filesRefreshToken"
            @load-session="handleSessionSelect"
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

        <!-- Bottom bar (Stack chat only — plugin views have no
             session context, so no chat input is shown) -->
        <div
          v-if="canvasViewMode === 'stack'"
          class="border-t border-gray-200 bg-white shrink-0"
        >
          <SuggestionsPanel
            ref="suggestionsPanelRef"
            :queries="currentRole.queries ?? []"
            @send="(q) => sendMessage(q)"
            @edit="onQueryEdit"
          />
          <ChatInput
            ref="chatInputRef"
            v-model="userInput"
            v-model:pasted-file="pastedFile"
            :is-running="isRunning"
            @send="sendMessage()"
          />
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
    </div>

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
import type { SseEvent } from "./types/sse";
import { type SessionEntry, type ActiveSession } from "./types/session";
import { EVENT_TYPES, generationKey } from "./types/events";
import { extractImageData, makeTextResult } from "./utils/tools/result";
import { buildAgentRequestBody } from "./utils/agent/request";
import {
  pushResult,
  pushErrorMessage,
  beginUserTurn,
  appendToLastAssistantText,
} from "./utils/session/sessionHelpers";
import { maybeSeedRoleDefault } from "./utils/session/seedRoleDefault";
import {
  findPendingToolCall,
  shouldSelectAssistantText,
} from "./utils/agent/toolCalls";
import {
  parseSessionEntries,
  resolveSelectedUuid,
  resolveSessionTimestamps,
} from "./utils/session/sessionEntries";
import { usePendingCalls } from "./composables/usePendingCalls";
import { useClickOutside } from "./composables/useClickOutside";
import { useKeyNavigation } from "./composables/useKeyNavigation";
import { useDebugBeat } from "./composables/useDebugBeat";
import { useChatScroll } from "./composables/useChatScroll";
import { useViewLayout } from "./composables/useViewLayout";
import { useSessionSync } from "./composables/useSessionSync";
import { useSessionDerived } from "./composables/useSessionDerived";
import { useFaviconState } from "./composables/useFaviconState";
import { useMergedSessions } from "./composables/useMergedSessions";
import { useCanvasViewMode } from "./composables/useCanvasViewMode";
import { isCanvasViewMode } from "./utils/canvas/viewMode";
import { useMcpTools } from "./composables/useMcpTools";
import { useRoles } from "./composables/useRoles";
import { usePubSub } from "./composables/usePubSub";
import { sessionChannel } from "./config/pubsubChannels";
import { useHealth } from "./composables/useHealth";
import { useSessionHistory } from "./composables/useSessionHistory";
import { useRightSidebar } from "./composables/useRightSidebar";
import { useEventListeners } from "./composables/useEventListeners";
import { provideAppApi } from "./composables/useAppApi";
import { provideActiveSession } from "./composables/useActiveSession";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import { apiGet, apiFetchRaw } from "./utils/api";
import { API_ROUTES } from "./config/apiRoutes";

// --- Per-session state ---
// Declared early so that pub/sub callbacks and function declarations
// below can reference them without forward-reference ambiguity.
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
const currentSessionId = ref("");

// --- Debug beat (pub/sub) ---
const { debugTitleStyle } = useDebugBeat();

const { subscribe: pubsubSubscribe } = usePubSub();

// --- Routing ---
const route = useRoute();
const router = useRouter();

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
    const roleExists = roles.value.some((role) => role.id === newRole);
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

// Deduplicate consecutive tool results with the same toolName for the
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

// --- Global state ---
const { roles, currentRoleId, currentRole, refreshRoles } = useRoles();

const userInput = ref("");
const pastedFile = ref<PastedFile | null>(null);
const activePane = ref<"sidebar" | "main">("sidebar");

const { sessions, showHistory, historyError, fetchSessions, toggleHistory } =
  useSessionHistory();
const { markSessionRead } = useSessionSync({
  sessionMap,
  currentSessionId,
  fetchSessions,
});
const { geminiAvailable, sandboxEnabled, fetchHealth } = useHealth();

const {
  activeSession,
  toolResults,
  sidebarResults,
  currentSummary,
  isRunning,
  statusMessage,
  toolCallHistory,
  activeSessionCount,
  unreadCount,
} = useSessionDerived({ sessionMap, currentSessionId, sessions });

// ── Dynamic favicon (#470) ──────────────────────────────────
useFaviconState({ isRunning, currentSummary, activeSession });

const toolResultsPanelRef = ref<{ root: HTMLDivElement | null } | null>(null);
const chatListRef = computed(() => toolResultsPanelRef.value?.root ?? null);
const canvasRef = ref<HTMLDivElement | null>(null);
const chatInputRef = ref<{ focus: () => void } | null>(null);
const topBarRef = ref<HTMLDivElement | null>(null);
// Measured when the history popup opens — the popup is a direct child
// of the root, so its absolute `top` must equal the global top bar's
// full height.
const historyTopOffset = ref<number | undefined>(undefined);

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
const toolResultsLength = computed(() => toolResults.value.length);
useChatScroll({
  chatListRef,
  toolResultsLength,
  isRunning,
  focusChatInput,
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

// The no-sidebar "stack-style" layout (top bar + full-width canvas +
// bottom bar) is used for every view mode except Single. Clicking a
// plugin launcher button (Todos / Scheduler / Files / ...) swaps the
// canvas content without collapsing the frame back to the sidebar
// layout.
const { isStackLayout, restoreChatViewForSession, displayedCurrentSessionId } =
  useViewLayout({
    canvasViewMode,
    setCanvasViewMode,
    currentSessionId,
    activePane,
  });

// User-initiated session switches: clicking a session tab, a history
// row, or a chat link in FilesView. In plugin views (Todos / Files /
// ...) no chat is active, so the click's purpose is to surface the
// chat — restore the preferred Single/Stack mode before loading.
// Not wired into the internal `loadSession` call path because that
// also fires on initial mount with `?view=plugin` URLs, which must
// be honoured as-is.
function handleSessionSelect(id: string): void {
  restoreChatViewForSession();
  loadSession(id);
}

function handleNewSessionClick(): void {
  restoreChatViewForSession();
  createNewSession();
}

// In plugin views (Todos / Files / ...) no chat is active, so the
// Measure the top bar's height whenever the history popup is about
// to open. Defer to nextTick so the popup's v-if transition doesn't
// race the measurement.
watch(showHistory, (open) => {
  if (open) {
    nextTick(() => {
      historyTopOffset.value = topBarRef.value?.offsetHeight;
    });
  }
});
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
    toolResults.value.find(
      (result) => result.uuid === selectedResultUuid.value,
    ) ?? null,
);

// Type-guard for the user-side branch of a text-response result. Used
// to surface the first user message as a preview for live sessions
// that haven't been persisted to disk yet.
// Merged list for the history pane: live sessions in `sessionMap`
// merged with server-only sessions, sorted newest-first by
const { mergedSessions, tabSessions } = useMergedSessions({
  sessionMap,
  sessions,
});

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
  // Unsubscribe from the previous session if it's not running and has
  // no in-flight background generations. Tearing down the subscription
  // while a generation is still running would orphan its completion
  // event, leaving the session's busy indicator stuck on.
  if (previousSessionId && previousSessionId !== id) {
    const prevSession = sessionMap.get(previousSessionId);
    const prevBusy =
      !!prevSession &&
      (prevSession.isRunning ||
        Object.keys(prevSession.pendingGenerations ?? {}).length > 0);
    if (prevSession && !prevBusy) {
      unsubscribeSession(previousSessionId);
    }
  }
  previousSessionId = id;

  // Clear unread in both sessionMap and sessions list (for badge count),
  // then tell the server so other tabs see it too.
  const summary = sessions.value.find((entry) => entry.id === id);
  const wasUnread =
    (session && session.hasUnread) || (summary && summary.hasUnread);
  if (wasUnread) {
    if (session) session.hasUnread = false;
    if (summary) summary.hasUnread = false;
    markSessionRead(id);
  }
});

const { handleCanvasKeydown, handleKeyNavigation } = useKeyNavigation({
  canvasRef,
  activePane,
  sidebarResults,
  selectedResultUuid,
});

const suggestionsPanelRef = ref<{ collapse: () => void } | null>(null);

function onQueryEdit(query: string): void {
  userInput.value = query;
  nextTick(() => focusChatInput());
}

function handleUpdateResult(updatedResult: ToolResultComplete) {
  const results = activeSession.value?.toolResults;
  if (!results) return;
  const index = results.findIndex(
    (result) => result.uuid === updatedResult.uuid,
  );
  if (index !== -1) {
    Object.assign(results[index], updatedResult);
  }
}

function onSidebarItemClick(uuid: string) {
  selectedResultUuid.value = uuid;
}

const GEMINI_PLUGINS = new Set(["generateImage", "presentDocument"]);
const needsGemini = (roleId: string) =>
  (roles.value.find((role) => role.id === roleId)?.availablePlugins ?? []).some(
    (plugin) => GEMINI_PLUGINS.has(plugin),
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
    resultTimestamps: new Map(),
    isRunning: false,
    statusMessage: "",
    toolCallHistory: [],
    selectedResultUuid: null,
    hasUnread: false,
    startedAt: now,
    updatedAt: now,
    runStartIndex: 0,
    pendingGenerations: {},
  };
  sessionMap.set(id, session);
  navigateToSession(id, true);
  currentRoleId.value = rId;
  suggestionsPanelRef.value?.collapse();
  nextTick(() => focusChatInput());
  return sessionMap.get(id)!;
}

function onRoleChange() {
  // Covers both the user dropdown click and the agent-triggered role
  // switch (EVENT_TYPES.switchRole) — either way the user ends up in
  // a fresh chat session, so a plugin view should yield to chat.
  restoreChatViewForSession();
  const session = createNewSession(currentRoleId.value);
  maybeSeedRoleDefault(session);
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

  const meta = entries.find((entry) => entry.type === EVENT_TYPES.sessionMeta);
  const roleId = meta?.roleId ?? currentRoleId.value;
  const toolResultsList = parseSessionEntries(entries);
  const urlResult =
    typeof route.query.result === "string" ? route.query.result : null;
  const resolvedSelectedUuid = resolveSelectedUuid(toolResultsList, urlResult);
  // Use server summary for live state (isRunning, etc.) and timestamps
  const serverSummary = sessions.value.find((session) => session.id === id);
  const { startedAt, updatedAt } = resolveSessionTimestamps(
    serverSummary,
    new Date().toISOString(),
  );
  // Approximate per-entry timestamps for a loaded session: the JSONL
  // format doesn't persist them yet, so spread entries evenly between
  // startedAt and updatedAt. New results pushed in this session via
  // pushResult() will overwrite with the real Date.now().
  const loadedTimestamps = new Map<string, number>();
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(updatedAt).getTime();
  toolResultsList.forEach((result, i) => {
    const frac =
      toolResultsList.length > 1 ? i / (toolResultsList.length - 1) : 0;
    loadedTimestamps.set(result.uuid, startMs + (endMs - startMs) * frac);
  });

  const newSession: ActiveSession = {
    id,
    roleId,
    toolResults: toolResultsList,
    resultTimestamps: loadedTimestamps,
    isRunning: serverSummary?.isRunning ?? false,
    statusMessage: serverSummary?.statusMessage ?? "",
    toolCallHistory: [],
    selectedResultUuid: resolvedSelectedUuid,
    hasUnread: false,
    startedAt,
    updatedAt,
    runStartIndex: toolResultsList.length,
    pendingGenerations: {},
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
        // Keep the subscription alive if background generations are
        // still in flight — otherwise their completion events would
        // be lost and the busy indicator would stay stuck.
        const live = sessionMap.get(session.id);
        const hasPending =
          !!live && Object.keys(live.pendingGenerations ?? {}).length > 0;
        if (!hasPending) unsubscribeSession(session.id);
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
        pushResult(session, makeTextResult(event.message, "user"));
        return;
      }
      // Streaming: append to the last assistant text-response if one
      // exists, rather than creating a new card per chunk.
      if (appendToLastAssistantText(session, event.message)) return;
      const textResult = makeTextResult(event.message, "assistant");
      pushResult(session, textResult);
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
        (existingResult) => existingResult.uuid === result.uuid,
      );
      if (existing >= 0) {
        session.toolResults[existing] = result;
      } else {
        pushResult(session, result);
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
    case EVENT_TYPES.generationStarted: {
      const mapKey = generationKey(event.kind, event.filePath, event.key);
      session.pendingGenerations[mapKey] = {
        kind: event.kind,
        filePath: event.filePath,
        key: event.key,
      };
      return;
    }
    case EVENT_TYPES.generationFinished: {
      const mapKey = generationKey(event.kind, event.filePath, event.key);
      delete session.pendingGenerations[mapKey];
      // When the last pending generation drains and the user is
      // actively viewing this session, clear the unread flag server
      // set on drain. Mirrors the sessionFinished handler.
      const drained = Object.keys(session.pendingGenerations).length === 0;
      if (drained && currentSessionId.value === session.id) {
        markSessionRead(session.id);
      }
      return;
    }
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
    roles.value.find((role) => role.id === session.roleId) ?? roles.value[0];
  const selectedRes =
    session.toolResults.find(
      (result) => result.uuid === session.selectedResultUuid,
    ) ?? undefined;

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
  } catch (err) {
    console.error("[agent] fetch error:", err);
    pushErrorMessage(
      session,
      err instanceof Error ? err.message : "Connection error.",
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
// Plugin Views that need to tag background work with the current
// session (e.g. MulmoScript generations) inject this.
provideActiveSession(activeSession);

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
  if (urlRole && roles.value.some((role) => role.id === urlRole)) {
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
