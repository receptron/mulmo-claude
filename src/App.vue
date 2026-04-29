<template>
  <div class="flex flex-col fixed inset-0 bg-gray-900 text-white">
    <!-- Global top bar — shown in every view mode -->
    <div class="shrink-0 bg-white text-gray-900">
      <!-- Row 1: title + plugin launcher -->
      <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
        <SidebarHeader
          :sandbox-enabled="sandboxEnabled"
          :gemini-available="geminiAvailable"
          :title-style="debugTitleStyle"
          @test-query="(q) => sendMessage(q)"
          @notification-navigate="handleNotificationNavigate"
          @open-settings="showSettings = true"
          @home="handleHomeClick"
        />
        <div class="flex-1 min-w-0">
          <PluginLauncher :active-tool-name="selectedResult?.toolName ?? null" :active-view-mode="currentPage" @navigate="onPluginNavigate" />
        </div>
      </div>
      <!-- Row 2: role selector + session tabs. Shown whenever the
           side panel is hidden — Row 2 and the side panel are
           mutually exclusive. The header-controls wrapper is pinned
           to 264px (w-72 minus px-3 padding on each side) so that
           RoleSelector / + / toggle occupy the exact same x-range as
           they do inside the open side panel — toggling the panel
           therefore doesn't shift those controls. -->
      <div v-if="!sidePanelVisible" class="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <div class="w-[264px] shrink-0">
          <SessionHeaderControls
            :roles="roles"
            :side-panel-visible="sidePanelVisible"
            :active-session-count="activeSessionCount"
            :unread-count="unreadCount"
            @role-change="onRoleChange"
            @new-session="handleNewSessionClick"
            @update:side-panel-visible="setSidePanelVisible"
          />
        </div>
        <SessionTabBar :sessions="tabSessions" :current-session-id="currentSessionId" :roles="roles" @load-session="handleSessionSelect" />
      </div>
    </div>

    <!-- Body: optional session-history column + sidebar (Single only) + canvas column + right sidebar -->
    <div class="flex flex-1 min-h-0">
      <!-- Session-history side panel. Opt-in column to the left of
           the chat sidebar / canvas, toggled via
           SessionHistoryToggleButton. Renders on every page when
           `sidePanelVisible` is true. Row 2 of the top bar hides when
           the panel is open — the panel's own header supplies the
           role selector + new-session button instead. -->
      <div
        v-if="sidePanelVisible"
        class="relative border-r border-gray-200 bg-white text-gray-900 flex flex-col min-w-0 overflow-hidden"
        :class="sidePanelExpanded ? 'flex-1' : 'w-72 flex-shrink-0'"
        data-testid="session-history-side-panel"
      >
        <!-- Single-row panel header. RoleSelector flexes to share the
             w-72 width with the new-session button and the side-panel
             close toggle. The expand affordance lives on the panel's
             right edge as a hover-reveal handle instead of a header
             button, so no second row is needed. -->
        <div class="flex items-center px-3 py-2 border-b border-gray-100">
          <SessionHeaderControls
            :roles="roles"
            :side-panel-visible="sidePanelVisible"
            :active-session-count="activeSessionCount"
            :unread-count="unreadCount"
            @role-change="onRoleChange"
            @new-session="handleNewSessionClick"
            @update:side-panel-visible="setSidePanelVisibleAndCollapse"
          />
        </div>
        <div class="group relative flex-1 min-h-0">
          <SessionHistoryPanel
            :sessions="mergedSessions"
            :current-session-id="currentSessionId"
            :roles="roles"
            :error-message="historyError"
            @load-session="handleSessionSelect"
            @toggle-bookmark="(id, bookmarked) => setBookmark(id, bookmarked)"
            @delete-session="(id) => deleteSessionFromHistory(id)"
          />
          <SessionHistoryExpandButton :model-value="sidePanelExpanded" @update:model-value="(value: boolean) => (sidePanelExpanded = value)" />
        </div>
      </div>

      <!-- Sidebar (Single layout only) -->
      <div
        v-if="!isStackLayout && !sidePanelExpanded"
        class="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white text-gray-900 relative"
        data-testid="chat-sidebar"
      >
        <!-- Tool result previews + role header (#842) -->
        <SessionSidebar
          ref="sessionSidebarRef"
          :results="sidebarResults"
          :selected-uuid="selectedResultUuid"
          :result-timestamps="activeSession?.resultTimestamps ?? new Map()"
          :session-role-name="sessionRoleName"
          :session-role-icon="sessionRoleIcon"
          :layout-mode="layoutMode"
          :show-right-sidebar="showRightSidebar"
          @select="onSidebarItemClick"
          @activate="activePane = 'sidebar'"
          @update:layout-mode="setLayoutMode"
          @toggle-right-sidebar="toggleRightSidebar"
        />

        <!-- Shared Thinking indicator. Sits between the sidebar and
             the chat input so the user gets the same "still alive"
             cue regardless of which plugin view fills the canvas
             (the sidebar copy inside SessionSidebar scrolls with
             results and can fall below the fold). -->
        <ThinkingIndicator
          v-if="activeSessionRunning"
          :status-message="statusMessage || t('app.thinking')"
          :run-elapsed-ms="runElapsedMs"
          :pending-calls="pendingCalls"
          class="border-t border-gray-100"
        />

        <!-- Text input -->
        <ChatInput
          ref="chatInputRef"
          v-model="userInput"
          v-model:pasted-file="pastedFile"
          :is-running="activeSessionRunning"
          :queries="sessionRole.queries ?? []"
          @send="sendMessage()"
          @suggestion-send="(q) => sendMessage(q)"
        />
      </div>

      <!-- Canvas column -->
      <div v-if="!sidePanelExpanded" class="flex-1 flex flex-col bg-white text-gray-900 min-w-0 overflow-hidden relative">
        <div ref="canvasRef" class="flex-1 overflow-hidden outline-none min-h-0" tabindex="0" @mousedown="activePane = 'main'" @keydown="handleCanvasKeydown">
          <!-- Chat page: single or stack layout -->
          <template v-if="isChatPage && layoutMode === 'single'">
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
              <p>{{ t("app.startConversation") }}</p>
            </div>
          </template>
          <StackView
            v-else-if="isChatPage && layoutMode === 'stack'"
            :tool-results="sidebarResults"
            :selected-result-uuid="selectedResultUuid"
            :result-timestamps="activeSession?.resultTimestamps ?? new Map()"
            :send-text-message="sendMessage"
            :session-role-name="sessionRoleName"
            :session-role-icon="sessionRoleIcon"
            :layout-mode="layoutMode"
            :show-right-sidebar="showRightSidebar"
            @select="(uuid) => (selectedResultUuid = uuid)"
            @update-result="handleUpdateResult"
            @update:layout-mode="setLayoutMode"
            @toggle-right-sidebar="toggleRightSidebar"
          />
          <!-- Distinct pages -->
          <FilesView v-else-if="currentPage === 'files'" :refresh-token="filesRefreshToken" @load-session="handleSessionSelect" />
          <TodoExplorer v-else-if="currentPage === 'todos'" />
          <CalendarView v-else-if="currentPage === 'calendar'" />
          <AutomationsView v-else-if="currentPage === 'automations'" />
          <WikiView v-else-if="currentPage === 'wiki'" />
          <SkillsView v-else-if="currentPage === 'skills'" />
          <RolesView v-else-if="currentPage === 'roles'" />
          <SourcesView v-else-if="currentPage === 'sources'" />
          <NewsView v-else-if="currentPage === 'news'" />
        </div>

        <!-- Bottom bar (Stack chat only — plugin views have no
             session context, so no chat input is shown) -->
        <div v-if="isChatPage && layoutMode === 'stack'" class="border-t border-gray-200 bg-white shrink-0">
          <ThinkingIndicator
            v-if="activeSessionRunning"
            :status-message="statusMessage || t('app.thinking')"
            :run-elapsed-ms="runElapsedMs"
            :pending-calls="pendingCalls"
            class="border-t border-gray-100"
          />
          <ChatInput
            ref="chatInputRef"
            v-model="userInput"
            v-model:pasted-file="pastedFile"
            :is-running="activeSessionRunning"
            :queries="sessionRole.queries ?? []"
            @send="sendMessage()"
            @suggestion-send="(q) => sendMessage(q)"
          />
        </div>
      </div>

      <!-- Right sidebar: tool call history. Only shown on the chat
           page — system prompt / tools / tool-call history are all
           agent-context and have no meaning on plugin views. -->
      <RightSidebar
        v-if="showRightSidebar && isChatPage && !sidePanelExpanded"
        ref="rightSidebarRef"
        :tool-call-history="toolCallHistory"
        :available-tools="availableTools"
        :role-prompt="sessionRole.prompt"
        :tool-descriptions="toolDescriptions"
      />
    </div>

    <!-- Global settings modal -->
    <SettingsModal
      :open="showSettings"
      :docker-mode="sandboxEnabled"
      :gemini-available="geminiAvailable"
      :mcp-tools-error="mcpToolsError"
      @update:open="showSettings = $event"
      @ask-gemini="handleAskGemini"
    />
    <NotificationToast />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { v4 as uuidv4 } from "uuid";
import { getPlugin } from "./tools";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import RightSidebar from "./components/RightSidebar.vue";
import SidebarHeader from "./components/SidebarHeader.vue";
import SessionHeaderControls from "./components/SessionHeaderControls.vue";
import SessionTabBar from "./components/SessionTabBar.vue";
import ChatInput, { type PastedFile } from "./components/ChatInput.vue";
import SessionHistoryExpandButton from "./components/SessionHistoryExpandButton.vue";
import SessionHistoryPanel from "./components/SessionHistoryPanel.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import ThinkingIndicator from "./components/ThinkingIndicator.vue";
import PluginLauncher from "./components/PluginLauncher.vue";
import StackView from "./components/StackView.vue";
import FilesView from "./components/FilesView.vue";
import TodoExplorer from "./components/TodoExplorer.vue";
import CalendarView from "./plugins/scheduler/CalendarView.vue";
import AutomationsView from "./plugins/scheduler/AutomationsView.vue";
import WikiView from "./plugins/wiki/View.vue";
import { buildWikiRouteParams } from "./plugins/wiki/route";
import SkillsView from "./plugins/manageSkills/View.vue";
import RolesView from "./components/RolesView.vue";
import SourcesView from "./components/SourcesView.vue";
import NewsView from "./components/NewsView.vue";
import SettingsModal from "./components/SettingsModal.vue";
import NotificationToast from "./components/NotificationToast.vue";
import type { NotificationAction } from "./types/notification";
import { PAGE_ROUTES, type PageRouteName } from "./router";
import type { SseEvent } from "./types/sse";
import type { SessionEntry, ActiveSession } from "./types/session";
import { EVENT_TYPES } from "./types/events";
import { extractImageData } from "./utils/tools/result";
import { buildAgentRequestBody, postAgentRun } from "./utils/agent/request";
import { applyAgentEvent, type AgentEventContext } from "./utils/agent/eventDispatch";
import { pushErrorMessage, beginUserTurn, updateResult } from "./utils/session/sessionHelpers";
import { roleName, roleIcon } from "./utils/role/icon";
import { createEmptySession } from "./utils/session/sessionFactory";
import { buildLoadedSession, parseSessionEntries } from "./utils/session/sessionEntries";
import { resolveNotificationTarget } from "./utils/notification/dispatch";
import { usePendingCalls } from "./composables/usePendingCalls";
import { useRunElapsed } from "./composables/useRunElapsed";
import { useKeyNavigation } from "./composables/useKeyNavigation";
import { useDebugBeat } from "./composables/useDebugBeat";
import { useChatScroll } from "./composables/useChatScroll";
import { useViewLayout } from "./composables/useViewLayout";
import { useSessionSync } from "./composables/useSessionSync";
import { useSessionDerived } from "./composables/useSessionDerived";
import { useFaviconState } from "./composables/useFaviconState";
import { useGlobalImageErrorRepair } from "./composables/useImageErrorRepair";
import { useMergedSessions } from "./composables/useMergedSessions";
import { useLayoutMode } from "./composables/useLayoutMode";
import { useSidePanelVisible } from "./composables/useSidePanelVisible";
import { useSelectedResult } from "./composables/useSelectedResult";
import { useMcpTools } from "./composables/useMcpTools";
import { useRoles } from "./composables/useRoles";
import { useCurrentRole } from "./composables/useCurrentRole";
import { BUILTIN_ROLE_IDS, type Role } from "./config/roles";
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
import { classifyWorkspacePath } from "./utils/path/workspaceLinkRouter";

const { t } = useI18n();

// --- Per-session state ---
// Declared early so that pub/sub callbacks and function declarations
// below can reference them without forward-reference ambiguity.
const sessionMap = reactive(new Map<string, ActiveSession>());

// Tracks active pub/sub subscriptions per session. The unsubscribe
// function is stored so we can clean up when the session is removed
// from memory. Sessions that are running always have an active
// subscription so events arrive via WebSocket.
const sessionSubscriptions = new Map<string, () => void>();

// currentSessionId is "the session currently displayed on /chat" —
// it's `""` whenever the user is on any other page. A plain ref (not
// a computed) so synchronous writes (e.g. inside createNewSession,
// which is called right before sendMessage might run) take effect
// immediately. The URL is kept in sync via navigateToSession, and
// external URL changes (back button, typed URL) feed back into the
// ref via the route watcher below. An `isChatPage` watcher clears
// it when the user leaves /chat.
const currentSessionId = ref("");

// --- Debug beat (pub/sub) ---
const { debugTitleStyle } = useDebugBeat();

const { subscribe: pubsubSubscribe } = usePubSub();

// --- Routing ---
const route = useRoute();
const router = useRouter();

function navigateToSession(sessionId: string, replace = false): void {
  currentSessionId.value = sessionId;
  const method = replace ? router.replace : router.push;
  method({
    name: PAGE_ROUTES.chat,
    params: { sessionId },
  }).catch((err) => {
    if (err?.type !== 16) {
      console.error("[navigateToSession] push failed:", err);
    }
  });
}

function handleNotificationNavigate(action: NotificationAction): void {
  const target = resolveNotificationTarget(action);
  if (!target) return;
  // No special-casing for chat targets: PR #774 moved the role
  // selector's state into the `useCurrentRole` singleton, so the
  // role no longer needs to be pinned via `?role=` on every
  // session-navigate. router.push(target) keeps the user's
  // current role choice across the navigation automatically.
  router.push(target).catch(() => {});
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

// --- Global state ---
// `roles` is the merged list (built-in + custom). `currentRoleId`
// is the role-selector dropdown's current pick — App.vue reads it
// as the fallback in createNewSession() so plugin callers like
// wiki's `appApi.startNewChat(message)` (no roleId) start their
// chat in whatever role the user last selected, instead of silently
// reverting to the first built-in role. Writes to `currentRoleId`
// happen only inside SessionHeaderControls (the dropdown owner).
// Code that needs "the role of the conversation in progress" reads
// `sessionRole` below, which derives from the active session.
const { roles, refreshRoles } = useRoles();
const { currentRoleId } = useCurrentRole(roles);

const userInput = ref("");
const pastedFile = ref<PastedFile | null>(null);
const activePane = ref<"sidebar" | "main">("sidebar");

const { sessions, historyError, fetchSessions, setBookmark, deleteSession: deleteSessionFromHistory } = useSessionHistory();
const { markSessionRead } = useSessionSync({
  sessionMap,
  currentSessionId,
  fetchSessions,
  // Another tab hard-deleted the chat we're currently viewing. The
  // sessionMap eviction has already cleared the in-memory state; the
  // URL still points at the dead id. Mirror the URL→404 fallback on
  // line ~366 by spinning up a fresh session so the user lands on a
  // working /chat instead of a blank pane.
  onCurrentSessionDeleted: () => createNewSession(),
});
const { geminiAvailable, sandboxEnabled, cpuLoadRatio, fetchHealth } = useHealth();

const { activeSession, toolResults, sidebarResults, isRunning, activeSessionRunning, statusMessage, toolCallHistory, activeSessionCount, unreadCount } =
  useSessionDerived({ sessionMap, currentSessionId, sessions });

const { selectedResultUuid } = useSelectedResult({
  activeSession,
  sessionMap,
  currentSessionId,
});

// Display name and icon of the role the active session was created
// under, so the message list can show which role is driving the
// conversation (independent of what the dropdown currently shows).
const sessionRoleName = computed(() => {
  const roleId = activeSession.value?.roleId;
  if (!roleId) return "";
  return roleName(roles.value, roleId);
});
const sessionRoleIcon = computed(() => {
  const roleId = activeSession.value?.roleId;
  if (!roleId) return "";
  return roleIcon(roles.value, roleId);
});

// Role of the conversation in progress. Drives the suggested-query
// list, the right-sidebar role-prompt, and the MCP tool filter so
// they all match the active session (not the role-selector
// dropdown — which is owned by SessionHeaderControls and whose
// selection only matters at "+" / role-change time).
const sessionRole = computed<Role>(() => {
  const sessionRoleId = activeSession.value?.roleId;
  if (sessionRoleId) {
    const match = roles.value.find((role) => role.id === sessionRoleId);
    if (match) return match;
  }
  return roles.value[0];
});

const { mergedSessions, tabSessions } = useMergedSessions({
  sessionMap,
  sessions,
});

// ── Dynamic favicon (#470) ──────────────────────────────────
// Every input here is global, not per-on-screen-session: the user
// is often on /files or other non-chat views, so the favicon has
// to react to the whole session list rather than `activeSession`.
//
// `isRunning` is the global scan from useSessionDerived (sessionMap +
// server summaries), and `mergedSessions` folds the in-memory
// `updatedAt` / `pendingGenerations` over server summaries — so the
// runningLong clock picks up `beginUserTurn`'s local stamp on the
// very same tick as `isRunning` flips, without waiting for the next
// /api/sessions refetch.
useFaviconState({ isRunning, sessions: mergedSessions, sessionsUnreadCount: unreadCount, cpuLoadRatio });
useGlobalImageErrorRepair();

const sessionSidebarRef = ref<{ root: HTMLDivElement | null } | null>(null);
const canvasRef = ref<HTMLDivElement | null>(null);
const chatInputRef = ref<{ focus: () => void; collapseSuggestions: () => void } | null>(null);
const { focusChatInput } = useChatScroll({
  sessionSidebarRef,
  toolResults,
  isRunning: activeSessionRunning,
  chatInputRef,
});

const { showRightSidebar, toggleRightSidebar } = useRightSidebar();
const showSettings = ref(false);

const { layoutMode, setLayoutMode } = useLayoutMode();
const { sidePanelVisible, setSidePanelVisible } = useSidePanelVisible();
// Transient full-width mode for the session-history side panel.
// Not persisted: reopening the panel should always start collapsed.
const sidePanelExpanded = ref(false);

function setSidePanelVisibleAndCollapse(value: boolean): void {
  setSidePanelVisible(value);
  if (!value) sidePanelExpanded.value = false;
}

// Current page derives from the route. The chat page has a layout
// preference on top (single vs. stack); other pages are distinct
// full-width views.
const isChatPage = computed(() => route.name === PAGE_ROUTES.chat);
const currentPage = computed<PageRouteName | null>(() => {
  const { name } = route;
  return typeof name === "string" && isPageRouteName(name) ? name : null;
});

// Refresh the files tree after each agent run so newly written files
// appear without a manual reload.
const filesRefreshToken = ref(0);
watch(isRunning, (running, prev) => {
  if (prev && !running) filesRefreshToken.value++;
});

// Opening the side panel refreshes the session list so stale entries
// don't linger after long idle periods. `fetchSessions` is diff-based
// (cursor-aware) so the extra call is cheap when nothing changed.
watch(sidePanelVisible, (visible, prev) => {
  if (!prev && visible) {
    fetchSessions().catch((err) => console.error("[side-panel] session fetch failed:", err));
  }
});

function onPluginNavigate(target: { key: string }): void {
  if (isPageRouteName(target.key)) {
    router.push({ name: target.key }).catch(() => {});
  }
}

function isPageRouteName(value: string): value is PageRouteName {
  return Object.values(PAGE_ROUTES).includes(value as PageRouteName);
}

// Layout only matters on /chat; other pages are full-width by design.
const { isStackLayout } = useViewLayout({
  layoutMode,
  isChatPage,
  activePane,
});

// Clear currentSessionId when the user leaves /chat so downstream
// consumers (history-panel border, mark-read, unread dot, session-
// state sync) see "nothing selected" instead of the stale last-viewed
// session. Also prune any empty session that was never sent to — we
// don't persist empty sessions on the server. Fires true → false only;
// an empty → /chat transition is handled by the route-params watcher
// and onMounted.
watch(isChatPage, (isChat, wasChat) => {
  if (!(wasChat && !isChat)) return;
  removeCurrentIfEmpty();
  currentSessionId.value = "";
});

function handleSessionSelect(sessionId: string): void {
  sidePanelExpanded.value = false;
  loadSession(sessionId);
}

function handleNewSessionClick(roleId: string): void {
  sidePanelExpanded.value = false;
  createNewSession(roleId);
}

function handleHomeClick(): void {
  resumeOrCreateChatSession().catch((err) => console.error("[home] resume failed:", err));
}

const rightSidebarRef = ref<InstanceType<typeof RightSidebar> | null>(null);

const { availableTools, toolDescriptions, mcpToolsError, fetchMcpToolsStatus } = useMcpTools({
  currentRole: sessionRole,
  getDefinition: (name) => getPlugin(name)?.toolDefinition ?? null,
});

const { pendingCalls, teardown: teardownPendingCalls } = usePendingCalls({
  isRunning: activeSessionRunning,
  toolCallHistory,
});

// Run-level elapsed time for the Thinking indicator (#731 PR2).
// Pure UI: ticks once per second while the active session is running,
// flips back to null on completion. No backend or schema changes.
const { elapsedMs: runElapsedMs, teardown: teardownRunElapsed } = useRunElapsed({
  isRunning: activeSessionRunning,
});

const selectedResult = computed(() => toolResults.value.find((result) => result.uuid === selectedResultUuid.value) ?? null);

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
    if (prevSession !== undefined) {
      const prevBusy = prevSession.isRunning || Object.keys(prevSession.pendingGenerations ?? {}).length > 0;
      if (!prevBusy) {
        unsubscribeSession(previousSessionId);
      }
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

function handleUpdateResult(updatedResult: ToolResultComplete) {
  if (activeSession.value) updateResult(activeSession.value, updatedResult);
}

function onSidebarItemClick(uuid: string) {
  selectedResultUuid.value = uuid;
}

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

// Replace vs push is derived from state, not chosen by the caller:
// replace only when we just discarded an empty session AND we're
// currently on that same /chat/:emptyId URL — otherwise there's
// something worth keeping in history (a real chat transcript, or
// a non-chat page like /wiki the user came from).
function createNewSession(roleId?: string): ActiveSession {
  const removedEmpty = removeCurrentIfEmpty();
  const replace = removedEmpty && isChatPage.value;
  // The "+" button and role-change handler always supply roleId
  // (read from SessionHeaderControls). When omitted (plugin-driven
  // startNewChat, initial bootstrap, post-failure recovery) inherit
  // the dropdown's current selection so the new chat uses the role
  // the user last picked. Final fallback to roles[0] only matters
  // before the dropdown has seeded (very early bootstrap).
  const rId = roleId ?? (currentRoleId.value || roles.value[0]?.id || "");
  const session = createEmptySession(uuidv4(), rId);
  sessionMap.set(session.id, session);
  navigateToSession(session.id, replace);
  chatInputRef.value?.collapseSuggestions();
  nextTick(() => focusChatInput());
  return session;
}

function onRoleChange(roleId: string) {
  // On non-chat pages (wiki, files, etc.) the user is just picking
  // the role that future new-chat actions should use — don't yank
  // them onto /chat by creating a session here. The new selection
  // is preserved inside SessionHeaderControls (useCurrentRole) and
  // future "+" clicks will read it from there.
  if (!isChatPage.value) return;
  createNewSession(roleId);
}

// Land on /chat with no specific session in mind (initial load or
// home-button click). Prefer the most-recent session so the user
// resumes where they left off; only create a fresh session when they
// have no chat history at all. Explicit "+" clicks and role switches
// still create a new session via createNewSession() directly.
async function resumeOrCreateChatSession(): Promise<void> {
  const topId = mergedSessions.value[0]?.id;
  if (!topId) {
    createNewSession();
    return;
  }
  if (sessionMap.has(topId)) {
    activateSession(topId, false);
    return;
  }
  await loadSession(topId);
  // loadSession silently returns on fetch failure (stale summary,
  // transient API error). Without a fallback, /chat is left with no
  // active session and sendMessage becomes a no-op.
  if (!sessionMap.has(topId)) {
    createNewSession();
  }
}

function activateSession(sessionId: string, replace: boolean): void {
  const reactiveSession = sessionMap.get(sessionId);
  if (reactiveSession) ensureSessionSubscription(reactiveSession);
  // Skip the redundant navigateToSession when we're already on the
  // matching /chat/:sessionId URL. The route-watcher path arrives
  // here AFTER the URL has changed (notification permalink, browser
  // back/forward, manual paste), and re-pushing the same path would
  // strip query strings — `?result=<uuid>` for the
  // notification-permalink case (#762) — because navigateToSession
  // builds the location object with `params` only.
  const onTargetSession = route.name === PAGE_ROUTES.chat && route.params.sessionId === sessionId;
  if (!onTargetSession) {
    navigateToSession(sessionId, replace);
  }
  // Closing the history popup is no longer explicit — navigating to
  // /chat/:id via navigateToSession changes the route, and the
  // canvas-column branches away from SessionHistoryPanel naturally.
}

async function loadSession(sessionId: string) {
  // currentSessionId is `""` on non-chat pages, so clicking a session
  // in the history panel from /wiki never matches and always navigates
  // to /chat. On /chat this guard just avoids re-navigating to the
  // session we're already displaying.
  const alreadyOnThatChat = sessionId === currentSessionId.value && sessionMap.has(sessionId);
  if (alreadyOnThatChat) return;
  // Mirror createNewSession: only replace when we just discarded an
  // empty session AND we're on that /chat/:emptyId URL. On any
  // non-chat page selecting a session must push, otherwise the
  // current entry would be skipped when the last chat happened to
  // be empty.
  const removedEmpty = removeCurrentIfEmpty();
  const replaced = removedEmpty && isChatPage.value;

  const live = sessionMap.get(sessionId);
  if (live) {
    activateSession(sessionId, replaced);
    return;
  }

  const response = await apiGet<SessionEntry[]>(API_ROUTES.sessions.detail.replace(":id", encodeURIComponent(sessionId)));
  if (!response.ok) return;

  const newSession = buildLoadedSession({
    id: sessionId,
    entries: response.data,
    defaultRoleId: roles.value[0]?.id ?? "",
    urlResult: typeof route.query.result === "string" ? route.query.result : null,
    serverSummary: sessions.value.find((summary) => summary.id === sessionId),
    nowIso: new Date().toISOString(),
  });
  sessionMap.set(sessionId, newSession);
  activateSession(sessionId, replaced);
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
  if (live === undefined) return false;
  return Object.keys(live.pendingGenerations).length > 0;
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
  if (!message || activeSessionRunning.value) return;
  userInput.value = "";
  const fileSnapshot = pastedFile.value;
  pastedFile.value = null;

  const session = sessionMap.get(currentSessionId.value);
  if (!session) return;

  beginUserTurn(session, message);
  const selectedRes = session.toolResults.find((result) => result.uuid === session.selectedResultUuid) ?? undefined;

  ensureSessionSubscription(session);

  const result = await postAgentRun(
    buildAgentRequestBody({
      message,
      role: sessionRole.value,
      chatSessionId: session.id,
      selectedImageData: fileSnapshot?.dataUrl ?? extractImageData(selectedRes),
    }),
  );
  if (!result.ok) {
    pushErrorMessage(session, result.error);
    unsubscribeSession(session.id);
  }
}

// Route workspace-internal links (wiki pages, files, sessions) to the
// appropriate page. Called from plugin Views via AppApi.
function navigateToWorkspacePath(href: string): void {
  const target = classifyWorkspacePath(href);
  if (!target) return;

  switch (target.kind) {
    case "wiki":
      router.push({ name: PAGE_ROUTES.wiki, params: buildWikiRouteParams({ kind: "page", slug: target.slug }) }).catch(() => {});
      break;
    case "file":
      // Path-based files URL (see plans/done/feat-files-path-url.md) — pass
      // segments as an array so each piece is url-encoded independently
      // and slashes stay as path separators.
      router.push({ name: PAGE_ROUTES.files, params: { pathMatch: target.path.split("/") } }).catch(() => {});
      break;
    case "session":
      handleSessionSelect(target.sessionId);
      break;
  }
}

function startNewChat(message: string, roleId?: string): void {
  // createNewSession sets currentSessionId synchronously (see the
  // comment on its declaration), so the follow-up sendMessage lands
  // in the new session rather than whatever was previously active.
  // Cross-route push behaviour (so browser Back returns to /wiki)
  // is now handled inside createNewSession via the isChatPage check.
  createNewSession(roleId);
  void sendMessage(message);
}

function handleAskGemini(): void {
  startNewChat(t("settingsModal.geminiAskMessage"), BUILTIN_ROLE_IDS.general);
}

// Plugin Views call back into App.vue via provide/inject (#227).
provideAppApi({
  refreshRoles,
  sendMessage: (message: string) => sendMessage(message),
  startNewChat: (message: string, roleId?: string) => startNewChat(message, roleId),
  navigateToWorkspacePath: (href: string) => navigateToWorkspacePath(href),
  getResultTimestamp: (uuid: string) => activeSession.value?.resultTimestamps.get(uuid),
});
// Plugin Views that need to tag background work with the current
// session (e.g. MulmoScript generations) inject this.
provideActiveSession(activeSession);

useEventListeners({
  onKeyNavigation: handleKeyNavigation,
  onTeardown: () => {
    teardownPendingCalls();
    teardownRunElapsed();
  },
});

onMounted(async () => {
  // Fire-and-forget side fetches.
  fetchHealth();
  fetchMcpToolsStatus();
  // Awaited below before resuming the top session, so we know the
  // sessions list is populated when we pick which one to land on.
  const sessionsReady = fetchSessions();
  // Roles must be loaded before the first session is created, so
  // createNewSession() picks a roleId that exists in the merged
  // role list (built-in + custom).
  await refreshRoles();

  // Session bootstrap only applies on /chat. On /files, /todos, /wiki,
  // etc. we must not create or load a chat session — doing so would
  // replace the URL with /chat/<new-id> and pull the user off the page
  // they actually loaded.
  //
  // Read the URL's sessionId directly rather than through
  // currentSessionId.value — the route-param watcher isn't `immediate`,
  // so on a hard load of /chat/<id> the ref may still be "" when we
  // reach this code and we'd mistakenly resume the top session.
  if (route.name === PAGE_ROUTES.chat) {
    const urlSessionId = typeof route.params.sessionId === "string" ? route.params.sessionId : "";
    if (urlSessionId) {
      if (currentSessionId.value !== urlSessionId) {
        currentSessionId.value = urlSessionId;
      }
      await loadSession(urlSessionId);
      // loadSession is a no-op when the server returns 404 — in that
      // case sessionMap won't have the id, so fall through to create.
      if (!sessionMap.has(urlSessionId)) {
        createNewSession();
      }
    } else {
      await sessionsReady;
      await resumeOrCreateChatSession();
    }
  }
});
</script>
