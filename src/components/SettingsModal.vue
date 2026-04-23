<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16" data-testid="settings-modal-backdrop" @click="close">
    <div
      class="bg-white rounded-lg shadow-xl w-[36rem] max-h-[85vh] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      data-testid="settings-modal"
      @click.stop
    >
      <div class="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 id="settings-modal-title" class="text-base font-semibold text-gray-900">{{ t("settingsModal.title") }}</h2>
        <button class="text-gray-400 hover:text-gray-700" :title="t('common.close')" data-testid="settings-close-btn" @click="close">
          <span class="material-icons">close</span>
        </button>
      </div>

      <div class="flex border-b border-gray-200 px-5">
        <button
          v-if="!geminiAvailable"
          class="px-3 py-2 text-sm border-b-2"
          :class="activeTab === 'gemini' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'"
          data-testid="settings-tab-gemini"
          @click="activeTab = 'gemini'"
        >
          {{ t("settingsModal.tabs.gemini") }}
        </button>
        <button
          class="px-3 py-2 text-sm border-b-2"
          :class="activeTab === 'tools' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'"
          data-testid="settings-tab-tools"
          @click="activeTab = 'tools'"
        >
          {{ t("settingsModal.tabs.tools") }}
        </button>
        <button
          class="px-3 py-2 text-sm border-b-2"
          :class="activeTab === 'mcp' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'"
          data-testid="settings-tab-mcp"
          @click="activeTab = 'mcp'"
        >
          {{ t("settingsModal.tabs.mcp") }}
        </button>
        <button
          class="px-3 py-2 text-sm border-b-2"
          :class="activeTab === 'dirs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'"
          data-testid="settings-tab-dirs"
          @click="activeTab = 'dirs'"
        >
          {{ t("settingsModal.tabs.dirs") }}
        </button>
        <button
          class="px-3 py-2 text-sm border-b-2"
          :class="activeTab === 'refs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'"
          data-testid="settings-tab-refs"
          @click="activeTab = 'refs'"
        >
          {{ t("settingsModal.tabs.refs") }}
        </button>
      </div>

      <div class="px-5 py-4 overflow-y-auto flex-1 space-y-4 text-gray-900">
        <div v-if="loadError" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2" role="alert" data-testid="settings-load-error">
          ⚠ {{ loadError }}
        </div>

        <div v-if="activeTab === 'gemini'" class="space-y-3">
          <div class="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800" data-testid="settings-gemini-warning">
            <span class="material-icons text-sm align-middle mr-1">warning</span>
            <i18n-t keypath="settingsModal.geminiRequired" tag="span">
              <template #envKey><code class="font-mono">GEMINI_API_KEY</code></template>
              <template #envFile><code class="font-mono">.env</code></template>
            </i18n-t>
          </div>
          <button class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600" data-testid="settings-gemini-ask-btn" @click="askAboutGemini">
            {{ t("settingsModal.geminiAskButton") }}
          </button>
        </div>

        <div v-else-if="activeTab === 'tools'" class="space-y-3">
          <i18n-t keypath="settingsToolsTab.explanation" tag="p" class="text-xs text-gray-600 leading-relaxed">
            <template #allowedTools><code class="bg-gray-100 px-1 rounded">--allowedTools</code></template>
            <template #claudeMcp><code class="bg-gray-100 px-1 rounded">claude mcp</code></template>
          </i18n-t>
          <label class="block">
            <span class="text-xs font-semibold text-gray-700">{{ t("settingsModal.toolNamesLabel") }}</span>
            <textarea
              v-model="toolsText"
              class="mt-1 w-full h-48 px-2 py-1.5 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
              placeholder="mcp__claude_ai_Gmail&#10;mcp__claude_ai_Google_Calendar"
              data-testid="settings-tools-textarea"
              @keydown.stop
            ></textarea>
          </label>
          <p v-if="invalidToolNames.length > 0" class="text-xs text-amber-700">
            {{ t("settingsModal.invalidToolNamesPrefix") }}
            <code class="bg-gray-100 px-1 rounded">mcp__</code>{{ t("settingsModal.invalidToolNamesSuffix") }}
            {{ invalidToolNames.join(", ") }}
          </p>
          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              :disabled="toolsSaving || loading || !!loadError || !toolsDirty"
              :title="loadError ? t('settingsModal.cannotSaveTooltip') : undefined"
              data-testid="settings-tools-save-btn"
              @click="saveTools"
            >
              {{ toolsSaving ? t("settingsModal.saving") : t("common.save") }}
            </button>
            <span v-if="toolsDirty" class="text-xs text-amber-600" data-testid="settings-tools-dirty">
              {{ t("settingsModal.unsavedMarker") }}
            </span>
          </div>
        </div>

        <div v-else-if="activeTab === 'mcp'" class="space-y-3">
          <div
            v-if="mcpToolsError"
            class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1"
            role="alert"
            data-testid="mcp-tools-error"
          >
            {{ t("settingsModal.mcpToolsError", { error: mcpToolsError }) }}
          </div>
          <SettingsMcpTab
            ref="mcpTabRef"
            :servers="mcpServers"
            :docker-mode="dockerMode"
            @add="addMcpServer"
            @update="updateMcpServer"
            @remove="removeMcpServer"
          />
        </div>

        <SettingsWorkspaceDirsTab v-else-if="activeTab === 'dirs'" />

        <SettingsReferenceDirsTab v-else-if="activeTab === 'refs'" />
      </div>

      <!-- Footer: status strip only. MCP / Workspace Dirs / Reference
           Dirs auto-save; Allowed Tools has its own Save button inside
           the tab body. So no global Save/Cancel — close the modal
           via the ✕ button in the header (which prompts on unsaved
           tools edits or a pending MCP draft). Hidden on the gemini
           tab since it has no settings to save. -->
      <div v-if="activeTab !== 'gemini'" class="px-5 py-3 border-t border-gray-200 min-h-[2.75rem] flex items-center gap-3">
        <span v-if="statusMessage" class="text-xs" :class="statusError ? 'text-red-600' : 'text-green-600'" data-testid="settings-status">
          {{ statusMessage }}
        </span>
        <span v-else class="text-xs text-gray-500"> {{ t("settingsModal.changesHint") }} </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import SettingsMcpTab from "./SettingsMcpTab.vue";
import SettingsWorkspaceDirsTab from "./SettingsWorkspaceDirsTab.vue";
import SettingsReferenceDirsTab from "./SettingsReferenceDirsTab.vue";
import type { McpServerEntry } from "./SettingsMcpTab.vue";
import { apiGet, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const { t } = useI18n();

// Settings save model — per #716 follow-up.
//
// Only Allowed Tools needs a Save button: the textarea accumulates
// free-form edits that can't be auto-persisted on every keystroke.
// Every other tab (MCP, Workspace Dirs, Reference Dirs) is append/
// remove only, so each mutation persists through its own endpoint
// the moment it happens. Closing the modal just closes — no global
// Save/Cancel buttons.
//
// If the user closes with unsaved Tools edits, a confirm dialog
// asks whether to discard.

interface Props {
  open: boolean;
  dockerMode?: boolean;
  geminiAvailable?: boolean;
  // Forwarded from useMcpTools — if non-null, the MCP tab shows a
  // small warning strip so the user knows "all tools visible" is a
  // fallback rather than an accurate listing.
  mcpToolsError?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  dockerMode: false,
  geminiAvailable: true,
  mcpToolsError: null,
});
const emit = defineEmits<{
  "update:open": [value: boolean];
  saved: [];
  "ask-gemini": [];
}>();

// Typed ref to the SettingsMcpTab. Needed so close() can check
// whether the user has a pending draft MCP entry open — that's the
// one remaining \"unsaved\" state on the MCP tab (individual add /
// update / remove persist immediately).
const mcpTabRef = ref<{ flushDraft: () => boolean; hasPendingDraft: () => boolean } | null>(null);

const activeTab = ref<"gemini" | "tools" | "mcp" | "dirs" | "refs">("tools");
const toolsText = ref("");
// Server truth for tools — updated on load and on a successful Save
// from the Tools tab. `toolsDirty` compares this against `toolsText`
// so the close-with-unsaved confirm only fires when the user has
// actually edited the list.
const toolsSavedText = ref("");
const mcpServers = ref<McpServerEntry[]>([]);
const loadError = ref("");
const statusMessage = ref("");
const statusError = ref(false);
const toolsSaving = ref(false);
// `true` from the moment the modal opens until the first loadConfig()
// call resolves. Prevents a user Save from submitting the initial
// empty arrays before the real config arrives, and prevents stale
// responses (from a previous open) from overwriting fresh input.
const loading = ref(false);
// Monotonically increasing token so an in-flight loadConfig() whose
// modal has been reopened can notice it's stale and discard its result.
let loadToken = 0;

const parsedToolNames = computed(() =>
  toolsText.value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0),
);

// `toolsSavedText` is stored in normalized form (trimmed, blank lines
// dropped, joined with "\n"). Comparing the raw textarea against it
// would flag blank/trailing whitespace as "dirty" forever, so compare
// the normalized parse instead — the close-confirm then only fires
// when the effective tool list actually differs from the server's.
const toolsDirty = computed(() => parsedToolNames.value.join("\n") !== toolsSavedText.value);

const invalidToolNames = computed(() => parsedToolNames.value.filter((name) => !name.startsWith("mcp__") && !isBuiltIn(name)));

function isBuiltIn(name: string): boolean {
  return ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"].includes(name);
}

async function loadConfig(): Promise<void> {
  const token = ++loadToken;
  loading.value = true;
  loadError.value = "";
  statusMessage.value = "";
  const response = await apiGet<{
    settings: { extraAllowedTools: string[] };
    mcp?: { servers: McpServerEntry[] };
  }>(API_ROUTES.config.base);
  // A newer open() has already started another load — drop this one.
  if (token !== loadToken) return;
  if (!response.ok) {
    loadError.value = response.status === 0 ? response.error || "Network error" : `Failed to load settings (HTTP ${response.status})`;
  } else {
    const text = response.data.settings.extraAllowedTools.join("\n");
    toolsText.value = text;
    toolsSavedText.value = text;
    mcpServers.value = response.data.mcp?.servers ?? [];
  }
  if (token === loadToken) loading.value = false;
}

// Tools tab — Save button hits the settings-only endpoint. MCP
// state is untouched by this path, so an unsaved MCP draft can't
// piggyback on a Tools save.
async function saveTools(): Promise<void> {
  if (loading.value) return;
  toolsSaving.value = true;
  statusMessage.value = "";
  statusError.value = false;
  const response = await apiPut<unknown>(API_ROUTES.config.settings, {
    extraAllowedTools: parsedToolNames.value,
  });
  if (!response.ok) {
    statusError.value = true;
    statusMessage.value = response.error || "Save failed";
  } else {
    toolsSavedText.value = parsedToolNames.value.join("\n");
    emit("saved");
    statusError.value = false;
    statusMessage.value = t("common.saved");
    setTimeout(() => {
      if (statusMessage.value === t("common.saved")) statusMessage.value = "";
    }, 2000);
  }
  toolsSaving.value = false;
}

// MCP mutations — each add/update/remove persists to the mcp-only
// endpoint. Optimistic: the local array updates first so the UI is
// snappy; on failure we roll back and surface the error.
async function persistMcp(next: McpServerEntry[], previous: McpServerEntry[]): Promise<void> {
  mcpServers.value = next;
  const response = await apiPut<unknown>(API_ROUTES.config.mcp, { servers: next });
  if (!response.ok) {
    mcpServers.value = previous;
    statusError.value = true;
    statusMessage.value = response.error || "MCP save failed";
    return;
  }
  emit("saved");
  statusError.value = false;
  statusMessage.value = "";
}

function askAboutGemini(): void {
  emit("ask-gemini");
  close();
}

function addMcpServer(entry: McpServerEntry): void {
  const previous = mcpServers.value.slice();
  void persistMcp([...previous, entry], previous);
}

function updateMcpServer(index: number, entry: McpServerEntry): void {
  const previous = mcpServers.value.slice();
  const next = [...previous];
  next[index] = entry;
  void persistMcp(next, previous);
}

function removeMcpServer(index: number): void {
  const previous = mcpServers.value.slice();
  const next = previous.filter((_, i) => i !== index);
  void persistMcp(next, previous);
}

function close(): void {
  // Guard against silent data loss. The draft forms and dirty text
  // belong to different tabs; warn about each so the user knows
  // which is at risk. English-only confirms — this is an
  // infrequent, destructive prompt and window.confirm is the only
  // blocking primitive we have.
  if (toolsDirty.value) {
    if (!window.confirm("Allowed Tools has unsaved changes. Close anyway?")) return;
  }
  if (mcpTabRef.value?.hasPendingDraft()) {
    if (!window.confirm("MCP server draft is still open. Close anyway?")) return;
  }
  emit("update:open", false);
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      activeTab.value = props.geminiAvailable ? "tools" : "gemini";
      loadConfig();
      statusMessage.value = "";
      statusError.value = false;
    }
  },
  { immediate: true },
);
</script>
