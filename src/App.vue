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
          <input
            v-model="userInput"
            type="text"
            placeholder="Type a task..."
            class="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="
              isRunning || (!geminiAvailable && needsGemini(currentRoleId))
            "
            @keydown.enter="$event.isComposing || sendMessage()"
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
        <p v-if="statusMessage" class="mt-2 text-xs text-gray-500">
          {{ statusMessage }}
        </p>
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
        <pre class="text-sm text-gray-300 whitespace-pre-wrap">{{
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
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
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

const showRightSidebar = ref(
  localStorage.getItem("right_sidebar_visible") === "true",
);
const toolCallHistory = ref<ToolCallHistoryItem[]>([]);
const rightSidebarRef = ref<InstanceType<typeof RightSidebar> | null>(null);

const availableTools = computed(() => currentRole.value.availablePlugins);

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
  } as ToolResultComplete;
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
    roles.value = await res.json();
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
  const entries: Record<string, unknown>[] = await res.json();

  const meta = entries.find((e) => e.type === "session_meta");
  if (meta?.roleId) currentRoleId.value = meta.roleId as string;
  chatSessionId.value = id;
  localStorage.setItem("lastSessionId", id);

  toolResults.value = [];
  for (const entry of entries) {
    if (entry.type === "session_meta") continue;
    if (entry.source === "user" && entry.type === "text") {
      toolResults.value.push(makeTextResult(entry.message as string, "user"));
    } else if (entry.source === "assistant" && entry.type === "text") {
      toolResults.value.push(
        makeTextResult(entry.message as string, "assistant"),
      );
    } else if (entry.source === "tool" && entry.type === "tool_result") {
      toolResults.value.push(entry.result as ToolResultComplete);
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
        selectedImageData:
          (selectedResult.value?.data as Record<string, unknown> | undefined)
            ?.imageData ?? undefined,
      }),
    });

    const reader = response.body!.getReader();
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
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (data.type === "tool_call") {
          toolCallHistory.value.push({
            toolUseId: data.toolUseId as string,
            toolName: data.toolName as string,
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
                c.toolUseId === (data.toolUseId as string) &&
                c.result === undefined &&
                c.error === undefined,
            );
          if (entry) entry.result = data.content as string;
          rightSidebarRef.value?.scrollToBottom();
        } else if (data.type === "status") {
          statusMessage.value = data.message as string;
        } else if (data.type === "switch_role") {
          setTimeout(() => {
            currentRoleId.value = data.roleId as string;
            onRoleChange();
          }, 0);
        } else if (data.type === "roles_updated") {
          await refreshRoles();
        } else if (data.type === "text") {
          toolResults.value.push(
            makeTextResult(data.message as string, "assistant"),
          );
        } else if (data.type === "tool_result") {
          const result: ToolResultComplete = data.result as ToolResultComplete;
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
});
</script>
