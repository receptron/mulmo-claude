<template>
  <div class="flex fixed inset-0 bg-gray-900 text-white">
    <!-- Sidebar -->
    <div
      class="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white text-gray-900 relative"
    >
      <div
        ref="headerRef"
        class="p-4 border-b border-gray-200 flex items-center justify-between"
      >
        <div>
          <h1
            data-testid="app-title"
            class="text-lg font-semibold"
            :style="debugTitleStyle"
          >
            MulmoClaude
          </h1>
        </div>
        <div class="flex gap-2">
          <button
            class="text-gray-400 hover:text-gray-700"
            data-testid="new-session-btn"
            title="New session"
            @click="createNewSession()"
          >
            <span class="material-icons">add_circle_outline</span>
          </button>
          <button
            ref="historyButtonRef"
            data-testid="history-btn"
            class="relative text-gray-400 hover:text-gray-700"
            :class="{ 'text-blue-500': showHistory }"
            title="Session history"
            @click="toggleHistory"
          >
            <span class="material-icons">history</span>
            <!-- Active sessions badge -->
            <span
              v-if="activeSessionCount > 0"
              class="absolute -top-1.5 -left-1.5 min-w-[1rem] h-4 px-0.5 bg-yellow-400 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none"
              >{{ activeSessionCount }}</span
            >
            <!-- Unread replies badge -->
            <span
              v-if="unreadCount > 0"
              class="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none"
              >{{ unreadCount }}</span
            >
          </button>
          <LockStatusPopup
            ref="lockPopupRef"
            :sandbox-enabled="sandboxEnabled"
            :open="showLockPopup"
            @update:open="showLockPopup = $event"
            @test-query="sendMessage"
          />
          <button
            class="text-gray-400 hover:text-gray-700"
            :class="{ 'text-blue-500': showRightSidebar }"
            title="Tool call history"
            @click="toggleRightSidebar"
          >
            <span class="material-icons">build</span>
          </button>
          <button
            class="text-gray-400 hover:text-gray-700"
            data-testid="settings-btn"
            title="Settings"
            aria-label="Settings"
            @click="showSettings = true"
          >
            <span class="material-icons">settings</span>
          </button>
        </div>
      </div>
      <!-- History popup -->
      <SessionHistoryPanel
        v-if="showHistory"
        ref="historyPanelRef"
        :sessions="mergedSessions"
        :current-session-id="currentSessionId"
        :roles="roles"
        :top-offset="headerRef?.offsetHeight"
        @load-session="loadSession"
      />

      <!-- Role selector -->
      <div
        class="p-4 border-b border-gray-200 flex items-center gap-2 relative"
      >
        <span class="text-sm text-gray-500 shrink-0">Role</span>
        <button
          ref="roleButtonRef"
          class="flex-1 flex items-center gap-2 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 text-left"
          data-testid="role-selector-btn"
          @click="showRoleDropdown = !showRoleDropdown"
        >
          <span class="material-icons text-base text-gray-500">{{
            roleIcon(currentRoleId)
          }}</span>
          <span class="flex-1 truncate">{{ currentRole.name }}</span>
          <span class="material-icons text-sm text-gray-400">expand_more</span>
        </button>
        <div
          v-if="showRoleDropdown"
          ref="roleDropdownRef"
          class="absolute left-4 right-4 top-full z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
        >
          <button
            v-for="role in roles"
            :key="role.id"
            :data-testid="`role-option-${role.id}`"
            class="w-full flex items-center gap-1.5 px-3 py-1 text-sm text-gray-900 hover:bg-gray-50 text-left"
            @click="
              currentRoleId = role.id;
              showRoleDropdown = false;
              onRoleChange();
            "
          >
            <span class="material-icons text-base text-gray-400">{{
              roleIcon(role.id)
            }}</span>
            {{ role.name }}
          </button>
        </div>
      </div>

      <!-- Session tab bar -->
      <div class="px-2 py-1 border-b border-gray-200 flex gap-1">
        <template v-for="i in 6" :key="i">
          <button
            v-if="tabSessions[i - 1]"
            class="flex-1 flex items-center justify-center py-1 rounded transition-colors"
            :class="
              tabSessions[i - 1].id === currentSessionId
                ? 'border border-gray-300 bg-white shadow-sm'
                : 'hover:bg-gray-100'
            "
            :title="
              tabSessions[i - 1].preview || roleName(tabSessions[i - 1].roleId)
            "
            :data-testid="`session-tab-${tabSessions[i - 1].id}`"
            @click="loadSession(tabSessions[i - 1].id)"
          >
            <span
              class="material-icons text-base"
              :class="[
                tabColor(tabSessions[i - 1]),
                tabSessions[i - 1].isRunning
                  ? 'animate-spin [animation-duration:3s]'
                  : '',
              ]"
              >{{ roleIcon(tabSessions[i - 1].roleId) }}</span
            >
          </button>
          <div v-else class="flex-1" />
        </template>
      </div>

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
      <div v-if="showQueries" class="border-t border-gray-200">
        <div
          v-if="queriesExpanded"
          ref="queriesListRef"
          class="px-4 pt-2 max-h-64 overflow-y-auto flex flex-col gap-1"
        >
          <button
            v-for="query in currentRole.queries"
            :key="query"
            class="text-left text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded px-3 py-1.5 border border-gray-300 transition-colors"
            @click="onQueryClick($event, query)"
          >
            {{ query }}
          </button>
          <p class="text-center text-[10px] text-gray-400 py-0.5">
            click to send · shift+click to edit
          </p>
        </div>
        <button
          class="w-full flex items-center justify-between px-4 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          @click="queriesExpanded = !queriesExpanded"
        >
          <span class="flex items-center gap-1">
            <span class="material-icons text-sm">lightbulb</span>
            Suggestions
          </span>
          <span
            class="material-icons text-sm transition-transform"
            :class="{ 'rotate-180': !queriesExpanded }"
            >expand_less</span
          >
        </button>
      </div>

      <!-- Text input -->
      <div class="p-4 border-t border-gray-200">
        <div class="flex gap-2">
          <textarea
            ref="textareaRef"
            v-model="userInput"
            data-testid="user-input"
            placeholder="Type a task..."
            rows="2"
            class="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
            :disabled="isRunning"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
            @keydown="onTextareaKeydown"
            @blur="onTextareaBlur"
          />
          <button
            data-testid="send-btn"
            class="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isRunning"
            @click="sendMessage()"
          >
            <span class="material-icons text-base">send</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Canvas -->
    <div
      class="flex-1 flex flex-col bg-white text-gray-900 min-w-0 overflow-hidden"
    >
      <div
        class="flex items-center justify-end px-3 py-2 border-b border-gray-100 shrink-0"
      >
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
          v-else
          :refresh-token="filesRefreshToken"
          @load-session="onFilesViewLoadSession"
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

    <!-- Global settings modal -->
    <SettingsModal
      :open="showSettings"
      :docker-mode="sandboxEnabled"
      @update:open="showSettings = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, reactive } from "vue";
import { v4 as uuidv4 } from "uuid";
import { getPlugin } from "./tools";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import RightSidebar from "./components/RightSidebar.vue";
import SessionHistoryPanel from "./components/SessionHistoryPanel.vue";
import LockStatusPopup from "./components/LockStatusPopup.vue";
import ToolResultsPanel from "./components/ToolResultsPanel.vue";
import CanvasViewToggle from "./components/CanvasViewToggle.vue";
import StackView from "./components/StackView.vue";
import FilesView from "./components/FilesView.vue";
import SettingsModal from "./components/SettingsModal.vue";
import type { SseEvent } from "./types/sse";
import {
  type SessionSummary,
  type SessionEntry,
  type ActiveSession,
} from "./types/session";
import { extractImageData, makeTextResult } from "./utils/tools/result";
import {
  roleIcon as roleIconLookup,
  roleName as roleNameLookup,
} from "./utils/role/icon";
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
import { useMcpTools } from "./composables/useMcpTools";
import { useRoles } from "./composables/useRoles";
import { BUILTIN_ROLE_IDS } from "./config/roles";
import { usePubSub } from "./composables/usePubSub";
import { useHealth } from "./composables/useHealth";
import { useSessionHistory } from "./composables/useSessionHistory";
import { useRightSidebar } from "./composables/useRightSidebar";
import { useQueriesPanel } from "./composables/useQueriesPanel";
import { useEventListeners } from "./composables/useEventListeners";
import { provideAppApi } from "./composables/useAppApi";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";

// --- Debug beat (pub/sub) ---
const debugBeatColor = ref<string | null>(null);
const debugTitleStyle = computed(() =>
  debugBeatColor.value ? { color: debugBeatColor.value } : {},
);

const { subscribe: pubsubSubscribe } = usePubSub();
pubsubSubscribe("debug.beat", (data) => {
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
pubsubSubscribe("sessions", () => {
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
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(id)}/mark-read`,
      { method: "POST" },
    );
    // The server returns `{ ok: boolean }` — a 200 with `ok: false`
    // means the endpoint was reached but the flag wasn't actually
    // cleared (e.g. session not found). Treat that the same as a
    // transport failure and refetch so the sidebar doesn't go stale.
    let appLevelOk = true;
    if (res.ok) {
      try {
        const body: unknown = await res.json();
        if (
          body !== null &&
          typeof body === "object" &&
          (body as { ok?: unknown }).ok === false
        ) {
          appLevelOk = false;
        }
      } catch {
        // Body wasn't JSON — treat as failure.
        appLevelOk = false;
      }
    }
    if (!res.ok || !appLevelOk) {
      // Server didn't clear the flag — refetch to restore truth.
      await refreshSessionStates();
    }
  } catch {
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
const activePane = ref<"sidebar" | "main">("sidebar");

// IME composition tracking. Safari fires `compositionend` BEFORE the
// confirming Enter's `keydown`, so `event.isComposing` is already
// false on that keydown — the inline `!isComposing` guard let the
// message send on IME confirmation. Chrome / Firefox fire
// `compositionend` AFTER the keydown and keep `isComposing` true,
// so they handle confirmation correctly on their own.
//
// We use a tight time window after `compositionend` (30ms) to suppress
// only the immediately-following keydown — short enough that Safari's
// synchronous race fits, long enough that human reaction time on a
// follow-up Enter (>=100ms) never falls inside.
let isImeComposing = false;
let lastCompositionEndAt = 0;
const SAFARI_IME_RACE_WINDOW_MS = 30;
function onCompositionStart() {
  isImeComposing = true;
}
function onCompositionEnd() {
  isImeComposing = false;
  lastCompositionEndAt = performance.now();
}
function onTextareaBlur() {
  isImeComposing = false;
  lastCompositionEndAt = 0;
}
function onTextareaKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey) return;
  if (event.isComposing || isImeComposing) {
    event.preventDefault();
    return;
  }
  if (performance.now() - lastCompositionEndAt < SAFARI_IME_RACE_WINDOW_MS) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  sendMessage();
}

const { sessions, showHistory, fetchSessions, toggleHistory } =
  useSessionHistory();
const { geminiAvailable, sandboxEnabled, fetchHealth } = useHealth();
const showLockPopup = ref(false);

const toolResultsPanelRef = ref<{ root: HTMLDivElement | null } | null>(null);
const chatListRef = computed(() => toolResultsPanelRef.value?.root ?? null);
const canvasRef = ref<HTMLDivElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const historyButtonRef = ref<HTMLButtonElement | null>(null);
// Exposed `root` from SessionHistoryPanel — the click-outside guard
// needs the actual popup DOM element (not the component instance).
const historyPanelRef = ref<{ root: HTMLDivElement | null } | null>(null);
const historyPopupRef = computed(() => historyPanelRef.value?.root ?? null);
// Lock popup exposes its button + popup DOM via defineExpose so the
// click-outside guard has both references without poking the template.
const lockPopupRef = ref<{
  button: HTMLButtonElement | null;
  popup: HTMLDivElement | null;
} | null>(null);
const lockButtonRef = computed(() => lockPopupRef.value?.button ?? null);
const lockPopupElRef = computed(() => lockPopupRef.value?.popup ?? null);
const headerRef = ref<HTMLDivElement | null>(null);
const roleButtonRef = ref<HTMLButtonElement | null>(null);
const roleDropdownRef = ref<HTMLDivElement | null>(null);
const showRoleDropdown = ref(false);

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
    nextTick(() => textareaRef.value?.focus());
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

const { availableTools, toolDescriptions, fetchMcpToolsStatus } = useMcpTools({
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

function tabColor(session: SessionSummary): string {
  if (session.isRunning) return "text-yellow-400";
  if (session.hasUnread) return "text-gray-900";
  return "text-gray-400";
}

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
    ensureSessionSubscription(session, session.toolResults.length);
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

// The sendMessage wrapper defers resolution until call time so the
// composable can be instantiated here, before sendMessage is
// declared further down. Function declarations are hoisted so the
// reference is valid at click time.
const { queriesExpanded, queriesListRef, onQueryClick } = useQueriesPanel({
  userInput,
  textareaRef,
  sendMessage: (msg) => sendMessage(msg),
});

const showQueries = computed(() => !!currentRole.value.queries?.length);

// Local wrappers that thread the reactive `roles.value` into the
// pure helpers in src/utils/role.ts. Template bindings keep the
// short names `roleIcon(id)` / `roleName(id)`.
function roleIcon(roleId: string): string {
  return roleIconLookup(roles.value, roleId);
}

function roleName(roleId: string): string {
  return roleNameLookup(roles.value, roleId);
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
  if (canvasViewMode.value === "files") {
    setCanvasViewMode("single");
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
  if (canvasViewMode.value === "files") {
    setCanvasViewMode("single");
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
  };
  sessionMap.set(id, session);
  navigateToSession(id, true);
  currentRoleId.value = rId;
  queriesExpanded.value = false;
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
  try {
    const res = await fetch("/api/sources");
    if (!res.ok) {
      if (session.toolResults.length === 0) {
        pushErrorMessage(
          session,
          `Could not preload sources (HTTP ${res.status}). Ask Claude to list them, or check the server log.`,
        );
      }
      return;
    }
    const body = (await res.json()) as { sources?: unknown[] };
    const result: ToolResultComplete = {
      uuid: uuidv4(),
      toolName: "manageSource",
      message: "Loaded source registry.",
      title: "Information sources",
      data: { sources: body.sources ?? [] },
    };
    // Skip if the user has already produced their own result in the
    // meantime (fast typer + slow fetch race).
    if (session.toolResults.length > 0) return;
    session.toolResults.push(result);
    session.selectedResultUuid = result.uuid;
  } catch (err) {
    // Non-fatal: the Add / Rebuild buttons remain reachable via
    // chat as soon as the user sends any message. Still surface
    // a visible hint so the blank canvas isn't a mystery.
    if (session.toolResults.length === 0) {
      pushErrorMessage(
        session,
        `Could not preload sources: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
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
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) return;
  const entries: SessionEntry[] = await res.json();

  const meta = entries.find((e) => e.type === "session_meta");
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
  };
  sessionMap.set(id, newSession);
  // Subscribe immediately — the watch(currentSessionId) may have
  // already fired before the session was in sessionMap (e.g. when
  // opened via URL), so it couldn't subscribe at that point.
  // Use sessionMap.get() to obtain the reactive proxy — passing the
  // raw object would bypass Vue's reactivity tracking.
  const reactiveSession = sessionMap.get(id)!;
  ensureSessionSubscription(
    reactiveSession,
    reactiveSession.toolResults.length,
  );
  navigateToSession(id, replaced);
  currentRoleId.value = roleId;
  showHistory.value = false;
}

// Seed the session state for a fresh user turn. Not pure (mutates
// session), but isolated so sendMessage doesn't have the init
// pattern inline. Returns `runStartIndex` — the index into
// toolResults at which this run's outputs start, used later to
// decide whether a trailing text response becomes the selected
// canvas result.
function beginUserTurn(session: ActiveSession, message: string): number {
  // Append the user's message so it renders immediately. State like
  // isRunning / statusMessage is NOT set here — it comes from the
  // server via the `sessions` channel notification → refetch cycle,
  // keeping all clients (including the initiator) in sync.
  session.updatedAt = new Date().toISOString();
  session.toolResults.push(makeTextResult(message, "user"));
  return session.toolResults.length;
}

// Subscribe to a session's pub/sub channel so events from the server
// (tool_call, text, tool_result, session_finished, etc.) arrive via
// WebSocket and are dispatched into the session's reactive state.
// Returns the unsubscribe function. Idempotent — if a subscription
// already exists for this session, it's reused.
function ensureSessionSubscription(
  session: ActiveSession,
  runStartIndex: number,
): void {
  if (sessionSubscriptions.has(session.id)) return;

  const ctx: AgentEventContext = {
    session,
    runStartIndex,
    setCurrentRoleId: (roleId) => {
      currentRoleId.value = roleId;
    },
    onRoleChange,
    refreshRoles,
    scrollSidebarToBottom: () => rightSidebarRef.value?.scrollToBottom(),
  };

  const channel = `session.${session.id}`;
  const unsub = pubsubSubscribe(channel, (data) => {
    const event = data as SseEvent;
    if (!event || typeof event !== "object") return;

    // session_finished signals end-of-run. If the user is viewing
    // this session, clear unread and keep the subscription alive so
    // we receive events if another tab starts a new run. Only
    // unsubscribe sessions the user is NOT currently viewing — the
    // watch(currentSessionId) handler cleans up when switching away.
    if (event.type === "session_finished") {
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
  runStartIndex: number;
  setCurrentRoleId: (roleId: string) => void;
  onRoleChange: () => void;
  refreshRoles: () => Promise<void>;
  scrollSidebarToBottom: () => void;
}

async function applyAgentEvent(
  event: SseEvent,
  ctx: AgentEventContext,
): Promise<void> {
  const { session, runStartIndex } = ctx;
  switch (event.type) {
    case "tool_call":
      session.toolCallHistory.push({
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        args: event.args,
        timestamp: Date.now(),
      });
      ctx.scrollSidebarToBottom();
      return;
    case "tool_call_result": {
      const entry = findPendingToolCall(
        session.toolCallHistory,
        event.toolUseId,
      );
      if (entry) entry.result = event.content;
      ctx.scrollSidebarToBottom();
      return;
    }
    case "status":
      session.statusMessage = event.message;
      return;
    case "switch_role":
      setTimeout(() => {
        ctx.setCurrentRoleId(event.roleId);
        ctx.onRoleChange();
      }, 0);
      return;
    case "roles_updated":
      await ctx.refreshRoles();
      return;
    case "text": {
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
      const textResult = makeTextResult(event.message, "assistant");
      session.toolResults.push(textResult);
      if (shouldSelectAssistantText(session.toolResults, runStartIndex)) {
        session.selectedResultUuid = textResult.uuid;
      }
      return;
    }
    case "tool_result": {
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
    case "error":
      console.error("[agent] error event:", event.message);
      pushErrorMessage(session, event.message);
      return;
    case "session_finished":
      // Handled in the subscription callback — no-op here.
      return;
  }
}

async function sendMessage(text?: string) {
  const message = typeof text === "string" ? text : userInput.value.trim();
  if (!message || isRunning.value) return;
  userInput.value = "";

  const session = sessionMap.get(currentSessionId.value);
  if (!session) return;

  const runStartIndex = beginUserTurn(session, message);
  const sessionRole =
    roles.value.find((r) => r.id === session.roleId) ?? roles.value[0];
  const selectedRes =
    session.toolResults.find((r) => r.uuid === session.selectedResultUuid) ??
    undefined;

  // Subscribe to the session's pub/sub channel BEFORE posting so we
  // don't miss events. The subscription callback dispatches each
  // event into the session's reactive state via applyAgentEvent.
  ensureSessionSubscription(session, runStartIndex);

  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildAgentRequestBody({
          message,
          role: sessionRole,
          chatSessionId: session.id,
          selectedImageData: extractImageData(selectedRes),
        }),
      ),
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
const { handler: handleClickOutsideLock } = useClickOutside({
  isOpen: showLockPopup,
  buttonRef: lockButtonRef,
  popupRef: lockPopupElRef,
});
const { handler: handleClickOutsideRoleDropdown } = useClickOutside({
  isOpen: showRoleDropdown,
  buttonRef: roleButtonRef,
  popupRef: roleDropdownRef,
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
  onClickOutsideLock: handleClickOutsideLock,
  onClickOutsideRoleDropdown: handleClickOutsideRoleDropdown,
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
