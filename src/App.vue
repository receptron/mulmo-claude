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
          <PluginLauncher :active-tool-name="selectedResult?.toolName ?? null" :active-view-mode="canvasViewMode" @navigate="onPluginNavigate" />
        </div>
      </div>
      <!-- Row 2: canvas toggle + role selector + session tabs -->
      <div class="flex items-center gap-3 px-3 py-2 border-b border-gray-100">
        <CanvasViewToggle :model-value="canvasViewMode" @update:model-value="setCanvasViewMode" />
        <RoleSelector v-model:current-role-id="currentRoleId" :roles="roles" @change="onRoleChange" />
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
      <div v-if="!isStackLayout" class="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white text-gray-900 relative">
        <!-- Gemini API key warning -->
        <div
          v-if="!geminiAvailable && needsGeminiForRole(currentRoleId)"
          class="mx-4 mt-3 mb-2 rounded border border-yellow-400 bg-yellow-50 p-3 text-xs text-yellow-700 shrink-0"
        >
          <span class="material-icons text-xs align-middle mr-1">warning</span>
          Image generation requires
          <code class="font-mono">GEMINI_API_KEY</code>. Add it to <code class="font-mono">.env</code> and restart the app.
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
        <SuggestionsPanel ref="suggestionsPanelRef" :queries="currentRole.queries ?? []" @send="(q) => sendMessage(q)" @edit="onQueryEdit" />

        <!-- Text input -->
        <ChatInput ref="chatInputRef" v-model="userInput" v-model:pasted-file="pastedFile" :is-running="isRunning" @send="sendMessage()" />
      </div>

      <!-- Canvas column -->
      <div class="flex-1 flex flex-col bg-white text-gray-900 min-w-0 overflow-hidden relative">
        <!-- Gemini API key warning (Stack layouts — no sidebar to host it) -->
        <div
          v-if="isStackLayout && !geminiAvailable && needsGeminiForRole(currentRoleId)"
          class="mx-3 mt-2 rounded border border-yellow-400 bg-yellow-50 p-2 text-xs text-yellow-700 shrink-0"
        >
          <span class="material-icons text-xs align-middle mr-1">warning</span>
          Image generation requires
          <code class="font-mono">GEMINI_API_KEY</code>. Add it to <code class="font-mono">.env</code> and restart the app.
        </div>

        <div ref="canvasRef" class="flex-1 overflow-hidden outline-none min-h-0" tabindex="0" @mousedown="activePane = 'main'" @keydown="handleCanvasKeydown">
          <!-- Single mode -->
          <template v-if="canvasViewMode === 'single'">
            <component
              :is="getPlugin(selectedResult.toolName)?.viewComponent"
              v-if="selectedResult && getPlugin(selectedResult.toolName)?.viewComponent"
              :selected-result="selectedResult"
              :send-text-message="sendMessage"
              @update-result="handleUpdateResult"
            />
            <div v-else-if="selectedResult" class="h-full overflow-auto p-6">
              <pre class="text-sm text-gray-700 whitespace-pre-wrap">{{ JSON.stringify(selectedResult, null, 2) }}</pre>
            </div>
            <div v-else class="flex items-center justify-center h-full text-gray-600">
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
          <FilesView v-else-if="canvasViewMode === 'files'" :refresh-token="filesRefreshToken" @load-session="handleSessionSelect" />
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
        <div v-if="canvasViewMode === 'stack'" class="border-t border-gray-200 bg-white shrink-0">
          <SuggestionsPanel ref="suggestionsPanelRef" :queries="currentRole.queries ?? []" @send="(q) => sendMessage(q)" @edit="onQueryEdit" />
          <ChatInput ref="chatInputRef" v-model="userInput" v-model:pasted-file="pastedFile" :is-running="isRunning" @send="sendMessage()" />
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
    <SettingsModal :open="showSettings" :docker-mode="sandboxEnabled" :mcp-tools-error="mcpToolsError" @update:open="showSettings = $event" />
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
import PluginLauncher from "./components/PluginLauncher.vue";
import StackView from "./components/StackView.vue";
import FilesView from "./components/FilesView.vue";
import TodoExplorer from "./components/TodoExplorer.vue";
import SchedulerView from "./plugins/scheduler/View.vue";
import WikiView from "./plugins/wiki/View.vue";
import SkillsView from "./plugins/manageSkills/View.vue";
import RolesView from "./plugins/manageRoles/View.vue";
import SettingsModal from "./components/SettingsModal.vue";
import NotificationToast from "./components/NotificationToast.vue";
import type { NotificationAction } from "./types/notification";
import { CANVAS_VIEW } from "./utils/canvas/viewMode";
import type { SseEvent } from "./types/sse";
import { type SessionEntry, type ActiveSession } from "./types/session";
import { EVENT_TYPES } from "./types/events";
import { extractImageData } from "./utils/tools/result";
import { buildAgentRequestBody, postAgentRun } from "./utils/agent/request";
import { applyAgentEvent, type AgentEventContext } from "./utils/agent/eventDispatch";
import { pushErrorMessage, beginUserTurn, updateResult } from "./utils/session/sessionHelpers";
import { maybeSeedRoleDefault } from "./utils/session/seedRoleDefault";
import { createEmptySession } from "./utils/session/sessionFactory";
import { buildLoadedSession, parseSessionEntries } from "./utils/session/sessionEntries";
import { resolveNotificationTarget } from "./utils/notification/dispatch";
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
import { useSelectedResult } from "./composables/useSelectedResult";
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
import { useRoute, useRouter } from "vue-router";
import { apiGet } from "./utils/api";
import { API_ROUTES } from "./config/apiRoutes";
import { needsGemini } from "./utils/role/plugins";

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

// Omit ?role= for the default role to keep URLs clean.
function buildRoleQuery(): Record<string, string> {
  const roleId = currentRoleId.value;
  if (!roleId || roles.value.length === 0 || roleId === roles.value[0]?.id) return {};
  return { role: roleId };
}

function navigateToSession(sessionId: string, replace = false): void {
  currentSessionId.value = sessionId;
  const method = replace ? router.replace : router.push;
  method({
    name: "chat",
    params: { sessionId },
    query: { ...buildViewQuery(), ...buildRoleQuery() },
  }).catch((err) => {
    if (err?.type !== 16) {
      console.error("[navigateToSession] push failed:", err);
    }
  });
}

function handleNotificationNavigate(action: NotificationAction): void {
  const target = resolveNotificationTarget(action);
  if (!target) return;
  if (target.kind === "session") {
    navigateToSession(target.sessionId);
  } else {
    setCanvasViewMode(CANVAS_VIEW[target.view]);
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

// --- Global state ---
const { roles, currentRoleId, currentRole, refreshRoles } = useRoles();

const userInput = ref("");
const pastedFile = ref<PastedFile | null>(null);
const activePane = ref<"sidebar" | "main">("sidebar");

const { sessions, showHistory, historyError, fetchSessions, toggleHistory } = useSessionHistory();
const { markSessionRead } = useSessionSync({
  sessionMap,
  currentSessionId,
  fetchSessions,
});
const { geminiAvailable, sandboxEnabled, fetchHealth } = useHealth();

const { activeSession, toolResults, sidebarResults, currentSummary, isRunning, statusMessage, toolCallHistory, activeSessionCount, unreadCount } =
  useSessionDerived({ sessionMap, currentSessionId, sessions });

const { selectedResultUuid } = useSelectedResult({
  activeSession,
  sessionMap,
  currentSessionId,
});

// ── Dynamic favicon (#470) ──────────────────────────────────
useFaviconState({ isRunning, currentSummary, activeSession });

const toolResultsPanelRef = ref<{ root: HTMLDivElement | null } | null>(null);
const canvasRef = ref<HTMLDivElement | null>(null);
const chatInputRef = ref<{ focus: () => void } | null>(null);
const topBarRef = ref<HTMLDivElement | null>(null);
const historyTopOffset = ref<number | undefined>(undefined);

const sessionTabBarRef = ref<{
  historyButton: HTMLButtonElement | null;
} | null>(null);
const historyButtonRef = computed(() => sessionTabBarRef.value?.historyButton ?? null);
const historyPanelRef = ref<{ root: HTMLDivElement | null } | null>(null);
const historyPopupRef = computed(() => historyPanelRef.value?.root ?? null);

const { focusChatInput } = useChatScroll({
  toolResultsPanelRef,
  toolResults,
  isRunning,
  chatInputRef,
});

const { showRightSidebar, toggleRightSidebar } = useRightSidebar();
const showSettings = ref(false);

const { canvasViewMode, setCanvasViewMode, buildViewQuery, filesRefreshToken, handleViewModeShortcut, onPluginNavigate } = useCanvasViewMode({ isRunning });

// The no-sidebar "stack-style" layout (top bar + full-width canvas +
// bottom bar) is used for every view mode except Single. Clicking a
// plugin launcher button (Todos / Scheduler / Files / ...) swaps the
// canvas content without collapsing the frame back to the sidebar
// layout.
const { isStackLayout, restoreChatViewForSession, displayedCurrentSessionId } = useViewLayout({
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
function handleSessionSelect(sessionId: string): void {
  restoreChatViewForSession();
  loadSession(sessionId);
}

function handleNewSessionClick(): void {
  restoreChatViewForSession();
  createNewSession();
}

// Measure the top bar's height when the history popup opens.
watch(showHistory, (open) => {
  if (open) {
    nextTick(() => {
      historyTopOffset.value = topBarRef.value?.offsetHeight;
    });
  }
});
const rightSidebarRef = ref<InstanceType<typeof RightSidebar> | null>(null);

const { availableTools, toolDescriptions, mcpToolsError, fetchMcpToolsStatus } = useMcpTools({
  currentRole,
  getDefinition: (name) => getPlugin(name)?.toolDefinition ?? null,
});

const { pendingCalls, teardown: teardownPendingCalls } = usePendingCalls({
  isRunning,
  toolCallHistory,
});

const selectedResult = computed(() => toolResults.value.find((result) => result.uuid === selectedResultUuid.value) ?? null);

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
watch(currentSessionId, (sessionId) => {
  const session = sessionMap.get(sessionId);
  // Subscribe to the new session's channel
  if (session) {
    ensureSessionSubscription(session);
  }
  // Unsubscribe from the previous session if it's not running and has
  // no in-flight background generations. Tearing down the subscription
  // while a generation is still running would orphan its completion
  // event, leaving the session's busy indicator stuck on.
  if (previousSessionId && previousSessionId !== sessionId) {
    const prevSession = sessionMap.get(previousSessionId);
    const prevBusy = !!prevSession && (prevSession.isRunning || Object.keys(prevSession.pendingGenerations ?? {}).length > 0);
    if (prevSession && !prevBusy) {
      unsubscribeSession(previousSessionId);
    }
  }
  previousSessionId = sessionId;

  // Clear unread in both sessionMap and sessions list (for badge count),
  // then tell the server so other tabs see it too.
  const summary = sessions.value.find((entry) => entry.id === sessionId);
  const wasUnread = (session && session.hasUnread) || (summary && summary.hasUnread);
  if (wasUnread) {
    if (session) session.hasUnread = false;
    if (summary) summary.hasUnread = false;
    markSessionRead(sessionId);
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
  if (activeSession.value) updateResult(activeSession.value, updatedResult);
}

function onSidebarItemClick(uuid: string) {
  selectedResultUuid.value = uuid;
}

const needsGeminiForRole = (roleId: string) => needsGemini(roles.value, roleId);

// Remove the current session from sessionMap if it's empty (no messages).
// Returns true if a session was removed, so the caller can use
// router.replace instead of router.push to keep the empty session out
// of browser navigation history.
function removeCurrentIfEmpty(): boolean {
  const sessionId = currentSessionId.value;
  if (!sessionId) return false;
  const session = sessionMap.get(sessionId);
  if (session && session.toolResults.length === 0) {
    sessionMap.delete(sessionId);
    return true;
  }
  return false;
}

function createNewSession(roleId?: string): ActiveSession {
  removeCurrentIfEmpty();
  const rId = roleId ?? currentRoleId.value;
  const session = createEmptySession(uuidv4(), rId);
  sessionMap.set(session.id, session);
  currentRoleId.value = rId;
  navigateToSession(session.id, true);
  suggestionsPanelRef.value?.collapse();
  nextTick(() => focusChatInput());
  return sessionMap.get(session.id)!;
}

function onRoleChange() {
  // Covers both the user dropdown click and the agent-triggered role
  // switch (EVENT_TYPES.switchRole) — either way the user ends up in
  // a fresh chat session, so a plugin view should yield to chat.
  restoreChatViewForSession();
  const session = createNewSession(currentRoleId.value);
  maybeSeedRoleDefault(session);
}

function activateSession(sessionId: string, roleId: string, replace: boolean): void {
  const reactiveSession = sessionMap.get(sessionId);
  if (reactiveSession) ensureSessionSubscription(reactiveSession);
  // Set role before navigating: buildRoleQuery() reads currentRoleId to
  // build ?role=, and the route.query.role watcher would otherwise fire
  // after navigation and revert currentRoleId to the previous session's role.
  currentRoleId.value = roleId;
  navigateToSession(sessionId, replace);
  showHistory.value = false;
}

async function loadSession(sessionId: string) {
  if (sessionId === currentSessionId.value && sessionMap.has(sessionId)) return;
  const replaced = removeCurrentIfEmpty();

  const live = sessionMap.get(sessionId);
  if (live) {
    activateSession(sessionId, live.roleId, replaced);
    return;
  }

  const response = await apiGet<SessionEntry[]>(API_ROUTES.sessions.detail.replace(":id", encodeURIComponent(sessionId)));
  if (!response.ok) return;

  const newSession = buildLoadedSession({
    id: sessionId,
    entries: response.data,
    defaultRoleId: currentRoleId.value,
    urlResult: typeof route.query.result === "string" ? route.query.result : null,
    serverSummary: sessions.value.find((summary) => summary.id === sessionId),
    nowIso: new Date().toISOString(),
  });
  sessionMap.set(sessionId, newSession);
  activateSession(sessionId, newSession.roleId, replaced);
}

// Re-fetch the transcript from the server and patch any entries the
// client missed (e.g. due to a pub-sub disconnect during a long
// Docker build). Called on session_finished so the user sees the
// full response even if mid-run events were lost. See issue #350.
async function refreshSessionTranscript(sessionId: string): Promise<void> {
  const session = sessionMap.get(sessionId);
  if (!session) return;
  const response = await apiGet<SessionEntry[]>(API_ROUTES.sessions.detail.replace(":id", encodeURIComponent(sessionId)));
  if (!response.ok) return;
  const serverResults = parseSessionEntries(response.data);
  // Only patch if the server knows more than we do — avoids
  // replacing a richer in-flight state with a stale snapshot when
  // session_finished races with the last few events.
  if (serverResults.length > session.toolResults.length) {
    session.toolResults = serverResults;
  }
}

function buildAgentEventContext(session: ActiveSession): AgentEventContext {
  const sessionId = session.id;
  return {
    get session() {
      return sessionMap.get(sessionId) ?? session;
    },
    setCurrentRoleId: (roleId) => {
      currentRoleId.value = roleId;
    },
    onRoleChange,
    refreshRoles,
    scrollSidebarToBottom: () => rightSidebarRef.value?.scrollToBottom(),
    onGenerationsDrained: () => {
      if (currentSessionId.value === sessionId) {
        markSessionRead(sessionId);
      }
    },
  };
}

function hasPendingGenerations(sessionId: string): boolean {
  const live = sessionMap.get(sessionId);
  return !!live && Object.keys(live.pendingGenerations).length > 0;
}

function handleSessionFinished(sessionId: string): void {
  refreshSessionTranscript(sessionId).catch((err) => {
    console.error("[handleSessionFinished] refresh failed:", err);
  });
  if (currentSessionId.value === sessionId) {
    markSessionRead(sessionId);
  } else if (!hasPendingGenerations(sessionId)) {
    unsubscribeSession(sessionId);
  }
}

function createSessionEventHandler(session: ActiveSession, ctx: AgentEventContext): (data: unknown) => void {
  return (data: unknown) => {
    const event = data as SseEvent;
    if (!event || typeof event !== "object") return;
    if (event.type === EVENT_TYPES.sessionFinished) {
      handleSessionFinished(session.id);
      return;
    }
    applyAgentEvent(event, ctx).catch((err) => {
      console.error("[applyAgentEvent] unhandled:", err);
    });
  };
}

function ensureSessionSubscription(session: ActiveSession): void {
  if (sessionSubscriptions.has(session.id)) return;
  const ctx = buildAgentEventContext(session);
  const handler = createSessionEventHandler(session, ctx);
  const unsub = pubsubSubscribe(sessionChannel(session.id), handler);
  sessionSubscriptions.set(session.id, unsub);
}

function unsubscribeSession(chatSessionId: string): void {
  const unsub = sessionSubscriptions.get(chatSessionId);
  if (unsub) {
    unsub();
    sessionSubscriptions.delete(chatSessionId);
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
  const sessionRole = roles.value.find((role) => role.id === session.roleId) ?? roles.value[0];
  const selectedRes = session.toolResults.find((result) => result.uuid === session.selectedResultUuid) ?? undefined;

  ensureSessionSubscription(session);

  const result = await postAgentRun(
    buildAgentRequestBody({
      message,
      role: sessionRole,
      chatSessionId: session.id,
      selectedImageData: fileSnapshot?.dataUrl ?? extractImageData(selectedRes),
    }),
  );
  if (!result.ok) {
    pushErrorMessage(session, result.error);
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
  const urlRole = typeof route.query.role === "string" ? route.query.role : null;
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
