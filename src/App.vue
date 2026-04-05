<template>
  <div class="flex fixed inset-0 bg-gray-900 text-white">
    <!-- Sidebar -->
    <div
      class="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white text-gray-900"
    >
      <div
        class="p-4 border-b border-gray-200 flex items-center justify-between"
      >
        <div>
          <h1 class="text-lg font-semibold">MulmoClaude</h1>
        </div>
        <div class="flex gap-2">
          <button
            class="text-gray-400 hover:text-gray-700"
            @click="onRoleChange"
            title="New session"
          >
            <span class="material-icons">add_circle_outline</span>
          </button>
          <button
            class="text-gray-400 hover:text-gray-700"
            :class="{ 'text-blue-500': showHistory }"
            @click="toggleHistory"
            title="Session history"
          >
            <span class="material-icons">history</span>
          </button>
          <button
            class="text-gray-400 hover:text-gray-700"
            :class="{ 'text-blue-500': showRightSidebar }"
            @click="toggleRightSidebar"
            title="Tool call history"
          >
            <span class="material-icons">build</span>
          </button>
        </div>
      </div>

      <!-- Role selector -->
      <div class="p-4 border-b border-gray-200">
        <select
          v-model="currentRoleId"
          class="w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
          @change="onRoleChange"
        >
          <option v-for="role in roles" :key="role.id" :value="role.id">
            {{ role.name }}
          </option>
        </select>
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

      <!-- Session history panel -->
      <div
        v-if="showHistory"
        class="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 bg-gray-100"
      >
        <p v-if="sessions.length === 0" class="text-xs text-gray-400">
          No sessions yet.
        </p>
        <div
          v-for="session in sessions"
          :key="session.id"
          class="cursor-pointer rounded border border-gray-300 p-2 text-sm hover:opacity-75 transition-opacity"
          @click="loadSession(session.id)"
        >
          <div class="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <span class="material-icons text-xs">{{
              roleIcon(session.roleId)
            }}</span>
            <span>{{ roleName(session.roleId) }}</span>
            <span class="ml-auto">{{ formatDate(session.startedAt) }}</span>
          </div>
          <p class="text-gray-700 truncate">
            {{ session.preview || "(no messages)" }}
          </p>
        </div>
      </div>

      <!-- Tool result previews -->
      <div
        v-else
        ref="chatListRef"
        class="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 bg-gray-100"
      >
        <div
          v-for="result in toolResults"
          :key="result.uuid"
          class="cursor-pointer rounded border border-gray-300 p-2 text-sm text-gray-900 hover:opacity-75 transition-opacity"
          :class="
            result.uuid === selectedResultUuid ? 'ring-2 ring-blue-500' : ''
          "
          @click="selectedResultUuid = result.uuid"
        >
          <component
            :is="getPlugin(result.toolName)?.previewComponent"
            v-if="getPlugin(result.toolName)?.previewComponent"
            :result="result"
          />
          <span v-else>{{ result.title || result.toolName }}</span>
        </div>

        <!-- Thinking indicator -->
        <div v-if="isRunning" class="px-2 py-1 text-sm">
          <div class="flex items-center gap-2 text-gray-500">
            <span class="text-xs">{{ statusMessage }}</span>
            <span class="flex gap-1">
              <span
                class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                style="animation-delay: 0ms"
              />
              <span
                class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                style="animation-delay: 150ms"
              />
              <span
                class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                style="animation-delay: 300ms"
              />
            </span>
          </div>
          <div v-if="pendingCalls.length > 0" class="mt-1 space-y-0.5">
            <div
              v-for="call in pendingCalls"
              :key="call.toolUseId"
              class="flex items-center gap-1.5 text-xs text-gray-400"
            >
              <span
                class="w-1.5 h-1.5 rounded-full bg-blue-300 shrink-0 animate-pulse"
              />
              <span class="font-mono truncate">{{ call.toolName }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Sample queries -->
      <div
        v-if="showQueries"
        class="px-4 pt-3 flex flex-wrap gap-2 border-t border-gray-200"
      >
        <button
          v-for="query in currentRole.queries"
          :key="query"
          class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full px-3 py-1 border border-gray-300 transition-colors"
          @click="sendMessage(query)"
        >
          {{ query }}
        </button>
      </div>

      <!-- Text input -->
      <div
        class="p-4 border-t border-gray-200"
        :class="{ 'border-t-0': showQueries }"
      >
        <div class="flex gap-2">
          <textarea
            ref="textareaRef"
            v-model="userInput"
            placeholder="Type a task..."
            rows="2"
            class="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
            :disabled="
              isRunning || (!geminiAvailable && needsGemini(currentRoleId))
            "
            @keydown.enter="
              !$event.isComposing && !$event.shiftKey
                ? (sendMessage(), $event.preventDefault())
                : undefined
            "
          />
          <button
            class="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="
              isRunning || (!geminiAvailable && needsGemini(currentRoleId))
            "
            @click="sendMessage()"
          >
            <span class="material-icons text-base">send</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Canvas -->
    <div class="flex-1 overflow-hidden bg-white text-gray-900 min-w-0">
      <component
        v-if="
          selectedResult && getPlugin(selectedResult.toolName)?.viewComponent
        "
        :is="getPlugin(selectedResult.toolName)?.viewComponent"
        :selected-result="selectedResult"
        :send-text-message="sendMessage"
        @update-result="handleUpdateResult"
      />
      <div v-else-if="selectedResult" class="h-full overflow-auto p-6">
        <pre class="text-sm text-gray-700 whitespace-pre-wrap">{{
          JSON.stringify(selectedResult, null, 2)
        }}</pre>
      </div>
      <div v-else class="flex items-center justify-center h-full text-gray-600">
        <p>Start a conversation</p>
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
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { v4 as uuidv4 } from "uuid";
import { ROLES, type Role } from "./config/roles";
import { getPlugin } from "./tools";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import RightSidebar from "./components/RightSidebar.vue";
import type { ToolCallHistoryItem } from "./components/RightSidebar.vue";

interface SessionSummary {
  id: string;
  roleId: string;
  startedAt: string;
  preview: string;
}

interface SessionEntry {
  type?: string;
  source?: string;
  roleId?: string;
  message?: string;
  result?: ToolResultComplete;
}

interface TextEntry extends SessionEntry {
  source: "user" | "assistant";
  type: "text";
  message: string;
}

interface ToolResultEntry extends SessionEntry {
  source: "tool";
  type: "tool_result";
  result: ToolResultComplete;
}

const isTextEntry = (e: SessionEntry): e is TextEntry =>
  (e.source === "user" || e.source === "assistant") &&
  e.type === "text" &&
  typeof e.message === "string";

const isToolResultEntry = (e: SessionEntry): e is ToolResultEntry =>
  e.source === "tool" && e.type === "tool_result" && e.result !== undefined;

interface SseToolCall {
  type: "tool_call";
  toolUseId: string;
  toolName: string;
  args: unknown;
}

interface SseToolCallResult {
  type: "tool_call_result";
  toolUseId: string;
  content: string;
}

interface SseStatus {
  type: "status";
  message: string;
}

interface SseSwitchRole {
  type: "switch_role";
  roleId: string;
}

interface SseText {
  type: "text";
  message: string;
}

interface SseToolResult {
  type: "tool_result";
  result: ToolResultComplete;
}

interface SseRolesUpdated {
  type: "roles_updated";
}

type SseEvent =
  | SseToolCall
  | SseToolCallResult
  | SseStatus
  | SseSwitchRole
  | SseText
  | SseToolResult
  | SseRolesUpdated;

const roles = ref<Role[]>(ROLES);
const currentRoleId = ref(ROLES[0].id);
const currentRole = computed(
  () => roles.value.find((r) => r.id === currentRoleId.value) ?? roles.value[0],
);
const chatSessionId = ref(uuidv4());

const userInput = ref("");
const isRunning = ref(false);
const statusMessage = ref("");
const toolResults = ref<ToolResultComplete[]>([]);
const selectedResultUuid = ref<string | null>(null);

const showHistory = ref(false);
const sessions = ref<SessionSummary[]>([]);
const geminiAvailable = ref(true);

const chatListRef = ref<HTMLDivElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

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

const showRightSidebar = ref(
  localStorage.getItem("right_sidebar_visible") === "true",
);
const toolCallHistory = ref<ToolCallHistoryItem[]>([]);
const rightSidebarRef = ref<InstanceType<typeof RightSidebar> | null>(null);

const availableTools = computed(() => currentRole.value.availablePlugins);

const PENDING_MIN_MS = 500;
const displayTick = ref(0);
let tickInterval: ReturnType<typeof setInterval> | null = null;

watch(isRunning, (running) => {
  if (running) {
    tickInterval = setInterval(() => {
      displayTick.value++;
    }, 50);
  } else {
    if (tickInterval !== null) {
      clearInterval(tickInterval);
      tickInterval = null;
      // One final tick so the computed clears after the minimum duration
      setTimeout(() => {
        displayTick.value++;
      }, PENDING_MIN_MS);
    }
  }
});

const pendingCalls = computed(() => {
  void displayTick.value; // reactive dependency on tick
  const now = Date.now();
  return toolCallHistory.value.filter(
    (c) =>
      (c.result === undefined && c.error === undefined) ||
      now < c.timestamp + PENDING_MIN_MS,
  );
});

const toolDescriptions = computed(() => {
  const map: Record<string, string> = {};
  for (const name of currentRole.value.availablePlugins) {
    const desc = getPlugin(name)?.toolDefinition.description;
    if (desc) map[name] = desc;
  }
  return map;
});

const selectedResult = computed(
  () =>
    toolResults.value.find((r) => r.uuid === selectedResultUuid.value) ?? null,
);

const showQueries = computed(
  () =>
    !!currentRole.value.queries?.length &&
    !isRunning.value &&
    toolResults.value.length < 4,
);

function roleIcon(roleId: string): string {
  return roles.value.find((r) => r.id === roleId)?.icon ?? "star";
}

function roleName(roleId: string): string {
  return roles.value.find((r) => r.id === roleId)?.name ?? roleId;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function extractImageData(
  result: ToolResultComplete | undefined,
): string | undefined {
  const data = result?.data;
  if (typeof data === "object" && data !== null && "imageData" in data) {
    return typeof data.imageData === "string" ? data.imageData : undefined;
  }
  return undefined;
}

function makeTextResult(
  text: string,
  role: "user" | "assistant",
): ToolResultComplete {
  return {
    uuid: uuidv4(),
    toolName: "text-response",
    message: text,
    title: role === "user" ? "You" : "Assistant",
    data: { text, role, transportKind: "text-rest" },
  };
}

function handleUpdateResult(updatedResult: ToolResultComplete) {
  const index = toolResults.value.findIndex(
    (r) => r.uuid === updatedResult.uuid,
  );
  if (index !== -1) {
    Object.assign(toolResults.value[index], updatedResult);
  }
}

const GEMINI_PLUGINS = new Set([
  "generateImage",
  "presentDocument",
  "generateHtml",
  "editHtml",
]);
const needsGemini = (roleId: string) =>
  (roles.value.find((r) => r.id === roleId)?.availablePlugins ?? []).some((p) =>
    GEMINI_PLUGINS.has(p),
  );

function toggleRightSidebar() {
  showRightSidebar.value = !showRightSidebar.value;
  localStorage.setItem("right_sidebar_visible", String(showRightSidebar.value));
}

function onRoleChange() {
  toolResults.value = [];
  selectedResultUuid.value = null;
  statusMessage.value = "";
  chatSessionId.value = uuidv4();
  toolCallHistory.value = [];
}

async function refreshRoles() {
  try {
    const res = await fetch("/api/roles");
    const customRoles: Role[] = await res.json();
    const customIds = new Set(customRoles.map((r) => r.id));
    roles.value = [
      ...ROLES.filter((r) => !customIds.has(r.id)),
      ...customRoles,
    ];
  } catch {
    // keep current roles on error
  }
}

async function fetchHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    geminiAvailable.value = !!data.geminiAvailable;
  } catch {
    geminiAvailable.value = false;
  }
}

async function fetchSessions(): Promise<SessionSummary[]> {
  try {
    const res = await fetch("/api/sessions");
    const data: SessionSummary[] = await res.json();
    sessions.value = data;
    return data;
  } catch {
    sessions.value = [];
    return [];
  }
}

async function toggleHistory() {
  showHistory.value = !showHistory.value;
  if (showHistory.value) await fetchSessions();
}

async function loadSession(id: string) {
  const res = await fetch(`/api/sessions/${id}`);
  const entries: SessionEntry[] = await res.json();

  const meta = entries.find((e) => e.type === "session_meta");
  if (meta?.roleId) currentRoleId.value = meta.roleId;
  chatSessionId.value = id;
  localStorage.setItem("lastSessionId", id);

  toolResults.value = [];
  for (const entry of entries) {
    if (entry.type === "session_meta") continue;
    if (isTextEntry(entry)) {
      toolResults.value.push(makeTextResult(entry.message, entry.source));
    } else if (isToolResultEntry(entry)) {
      toolResults.value.push(entry.result);
    }
  }

  // Select last non-text result, or last result
  const lastTool = [...toolResults.value]
    .reverse()
    .find((r) => r.toolName !== "text-response");
  selectedResultUuid.value =
    lastTool?.uuid ??
    toolResults.value[toolResults.value.length - 1]?.uuid ??
    null;

  showHistory.value = false;
}

async function sendMessage(text?: string) {
  const message = typeof text === "string" ? text : userInput.value.trim();
  if (!message || isRunning.value) return;
  userInput.value = "";
  isRunning.value = true;
  statusMessage.value = "Thinking...";

  toolResults.value.push(makeTextResult(message, "user"));
  localStorage.setItem("lastSessionId", chatSessionId.value);

  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        roleId: currentRoleId.value,
        chatSessionId: chatSessionId.value,
        selectedImageData: extractImageData(selectedResult.value ?? undefined),
      }),
    });

    if (!response.body) {
      statusMessage.value = "No response body received from server.";
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let data: SseEvent;
        try {
          data = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (data.type === "tool_call") {
          toolCallHistory.value.push({
            toolUseId: data.toolUseId,
            toolName: data.toolName,
            args: data.args,
            timestamp: Date.now(),
          });
          rightSidebarRef.value?.scrollToBottom();
        } else if (data.type === "tool_call_result") {
          const entry = toolCallHistory.value
            .slice()
            .reverse()
            .find(
              (c) =>
                c.toolUseId === data.toolUseId &&
                c.result === undefined &&
                c.error === undefined,
            );
          if (entry) entry.result = data.content;
          rightSidebarRef.value?.scrollToBottom();
        } else if (data.type === "status") {
          statusMessage.value = data.message;
        } else if (data.type === "switch_role") {
          setTimeout(() => {
            currentRoleId.value = data.roleId;
            onRoleChange();
          }, 0);
        } else if (data.type === "roles_updated") {
          await refreshRoles();
        } else if (data.type === "text") {
          toolResults.value.push(makeTextResult(data.message, "assistant"));
        } else if (data.type === "tool_result") {
          const { result } = data;
          const existing = toolResults.value.findIndex(
            (r) => r.uuid === result.uuid,
          );
          if (existing >= 0) {
            toolResults.value[existing] = result;
          } else {
            toolResults.value.push(result);
            selectedResultUuid.value = result.uuid;
          }
        }
      }
    }
  } finally {
    isRunning.value = false;
    statusMessage.value = "";
  }
}

onMounted(async () => {
  fetchHealth();
  refreshRoles();
  window.addEventListener("roles-updated", refreshRoles);

  const allSessions = await fetchSessions();
  const lastSessionId = localStorage.getItem("lastSessionId");
  const targetSession =
    allSessions.find((s) => s.id === lastSessionId) ?? allSessions[0];
  if (targetSession) {
    await loadSession(targetSession.id);
  }
});

onUnmounted(() => {
  window.removeEventListener("roles-updated", refreshRoles);
  if (tickInterval !== null) clearInterval(tickInterval);
});
</script>
