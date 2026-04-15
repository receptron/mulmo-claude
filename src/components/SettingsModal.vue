<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
    data-testid="settings-modal-backdrop"
    @click="close"
  >
    <div
      class="bg-white rounded-lg shadow-xl w-[36rem] max-h-[85vh] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      data-testid="settings-modal"
      @click.stop
    >
      <div
        class="px-5 py-4 border-b border-gray-200 flex items-center justify-between"
      >
        <h2
          id="settings-modal-title"
          class="text-base font-semibold text-gray-900"
        >
          Settings
        </h2>
        <button
          class="text-gray-400 hover:text-gray-700"
          title="Close"
          data-testid="settings-close-btn"
          @click="close"
        >
          <span class="material-icons">close</span>
        </button>
      </div>

      <div class="flex border-b border-gray-200 px-5">
        <button
          class="px-3 py-2 text-sm border-b-2"
          :class="
            activeTab === 'tools'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          "
          data-testid="settings-tab-tools"
          @click="activeTab = 'tools'"
        >
          Allowed Tools
        </button>
        <button
          class="px-3 py-2 text-sm border-b-2"
          :class="
            activeTab === 'mcp'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          "
          data-testid="settings-tab-mcp"
          @click="activeTab = 'mcp'"
        >
          MCP Servers
        </button>
      </div>

      <div class="px-5 py-4 overflow-y-auto flex-1 space-y-4 text-gray-900">
        <div v-if="loadError" class="text-sm text-red-600">
          {{ loadError }}
        </div>

        <div v-if="activeTab === 'tools'" class="space-y-3">
          <p class="text-xs text-gray-600 leading-relaxed">
            Extra tool names to pass to Claude via
            <code class="bg-gray-100 px-1 rounded">--allowedTools</code>. One
            per line. Useful for built-in Claude Code MCP servers like Gmail /
            Google Calendar after you have authenticated via
            <code class="bg-gray-100 px-1 rounded">claude mcp</code>.
          </p>
          <label class="block">
            <span class="text-xs font-semibold text-gray-700">Tool names</span>
            <textarea
              v-model="toolsText"
              class="mt-1 w-full h-48 px-2 py-1.5 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
              placeholder="mcp__claude_ai_Gmail&#10;mcp__claude_ai_Google_Calendar"
              data-testid="settings-tools-textarea"
              @keydown.stop
            ></textarea>
          </label>
          <p v-if="invalidToolNames.length > 0" class="text-xs text-amber-700">
            These look non-standard (expected prefix
            <code class="bg-gray-100 px-1 rounded">mcp__</code>):
            {{ invalidToolNames.join(", ") }}
          </p>
        </div>

        <div v-else-if="activeTab === 'mcp'" class="space-y-3">
          <SettingsMcpTab
            ref="mcpTabRef"
            :servers="mcpServers"
            :docker-mode="dockerMode"
            @add="addMcpServer"
            @update="updateMcpServer"
            @remove="removeMcpServer"
          />
        </div>
      </div>

      <div
        class="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-3"
      >
        <span
          v-if="statusMessage"
          class="text-xs"
          :class="statusError ? 'text-red-600' : 'text-green-600'"
          data-testid="settings-status"
        >
          {{ statusMessage }}
        </span>
        <span v-else class="text-xs text-gray-500">
          Changes apply on the next message. No restart needed.
        </span>
        <div class="flex gap-2">
          <button
            class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            data-testid="settings-cancel-btn"
            @click="close"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300"
            :disabled="saving || loading"
            data-testid="settings-save-btn"
            @click="save"
          >
            {{ saving ? "Saving…" : loading ? "Loading…" : "Save" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import SettingsMcpTab from "./SettingsMcpTab.vue";
import type { McpServerEntry } from "./SettingsMcpTab.vue";
import { apiGet, apiPut } from "../utils/api";

interface Props {
  open: boolean;
  dockerMode?: boolean;
}

const props = withDefaults(defineProps<Props>(), { dockerMode: false });
const emit = defineEmits<{
  "update:open": [value: boolean];
  saved: [];
}>();

// Typed ref to the SettingsMcpTab so save() can flush a pending draft
// before PUTing (eliminates the "user typed but forgot the inner Add
// button" footgun). Null when the MCP tab isn't the active one.
const mcpTabRef = ref<{ flushDraft: () => boolean } | null>(null);

const activeTab = ref<"tools" | "mcp">("tools");
const toolsText = ref("");
const mcpServers = ref<McpServerEntry[]>([]);
const loadError = ref("");
const statusMessage = ref("");
const statusError = ref(false);
const saving = ref(false);
// `true` from the moment the modal opens until the first loadConfig()
// call resolves. Prevents the Save button from submitting the initial
// empty arrays before the real config arrives, and prevents stale
// responses (from a previous open) from overwriting fresh input.
const loading = ref(false);
// Monotonically increasing token so an in-flight loadConfig() whose
// modal has been reopened can notice it's stale and discard its result.
let loadToken = 0;

const parsedToolNames = computed(() =>
  toolsText.value
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

const invalidToolNames = computed(() =>
  parsedToolNames.value.filter((n) => !n.startsWith("mcp__") && !isBuiltIn(n)),
);

function isBuiltIn(name: string): boolean {
  return [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
  ].includes(name);
}

async function loadConfig(): Promise<void> {
  const token = ++loadToken;
  loading.value = true;
  loadError.value = "";
  statusMessage.value = "";
  const response = await apiGet<{
    settings: { extraAllowedTools: string[] };
    mcp?: { servers: McpServerEntry[] };
  }>("/api/config");
  // A newer open() has already started another load — drop this one.
  if (token !== loadToken) return;
  if (!response.ok) {
    loadError.value =
      response.status === 0
        ? response.error || "Network error"
        : `Failed to load settings (HTTP ${response.status})`;
  } else {
    toolsText.value = response.data.settings.extraAllowedTools.join("\n");
    mcpServers.value = response.data.mcp?.servers ?? [];
  }
  if (token === loadToken) loading.value = false;
}

async function save(): Promise<void> {
  // Extra safety: the button is already disabled while loading, but
  // guard the function body too so any programmatic caller can't
  // submit a half-loaded form.
  if (loading.value) return;
  // Auto-commit any half-entered draft on the MCP tab. If the draft
  // is invalid the tab sets its own inline error — abort the save so
  // the user can fix it.
  if (mcpTabRef.value && !mcpTabRef.value.flushDraft()) {
    statusError.value = true;
    statusMessage.value =
      "Finish or cancel the pending MCP server entry first.";
    return;
  }
  saving.value = true;
  statusMessage.value = "";
  statusError.value = false;
  // Single atomic endpoint — avoids the partial-save state where
  // extraAllowedTools is persisted but MCP config write fails.
  const response = await apiPut<unknown>("/api/config", {
    settings: { extraAllowedTools: parsedToolNames.value },
    mcp: { servers: mcpServers.value },
  });
  if (!response.ok) {
    statusError.value = true;
    statusMessage.value = response.error || "Save failed";
  } else {
    emit("saved");
    // Close on success. Changes take effect on the next message, so
    // the user has no reason to stay in the modal after a good save.
    close();
  }
  saving.value = false;
}

function close(): void {
  emit("update:open", false);
}

function addMcpServer(entry: McpServerEntry): void {
  mcpServers.value = [...mcpServers.value, entry];
}

function updateMcpServer(index: number, entry: McpServerEntry): void {
  const next = [...mcpServers.value];
  next[index] = entry;
  mcpServers.value = next;
}

function removeMcpServer(index: number): void {
  const next = [...mcpServers.value];
  next.splice(index, 1);
  mcpServers.value = next;
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      loadConfig();
      statusMessage.value = "";
      statusError.value = false;
    }
  },
  { immediate: true },
);
</script>
