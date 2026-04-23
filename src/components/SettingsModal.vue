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
          class="px-3 py-2 text-sm border-b-2 flex items-center gap-1"
          :class="activeTab === 'gemini' ? 'border-yellow-500 text-yellow-700' : 'border-transparent text-yellow-700 hover:text-yellow-800'"
          data-testid="settings-tab-gemini"
          @click="activeTab = 'gemini'"
        >
          <span class="material-icons text-sm leading-none">warning</span>
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

        <div v-if="activeTab === 'gemini' && !geminiAvailable" class="space-y-4" data-testid="settings-gemini-panel">
          <div class="rounded border border-yellow-400 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            <span class="material-icons text-sm align-middle mr-1">warning</span>
            <i18n-t keypath="settingsGeminiTab.warningHeading" tag="strong">
              <template #envKey><code class="font-mono bg-yellow-100 px-1 rounded">GEMINI_API_KEY</code></template>
            </i18n-t>
          </div>
          <p class="text-sm text-gray-700 leading-relaxed">
            {{ t("settingsGeminiTab.impact") }}
          </p>
          <div>
            <h3 class="text-sm font-semibold text-gray-800 mb-2">{{ t("settingsGeminiTab.stepsHeading") }}</h3>
            <ol class="list-decimal list-inside space-y-2 text-sm text-gray-700">
              <li>
                <i18n-t keypath="settingsGeminiTab.step1" tag="span">
                  <template #link>
                    <a class="text-blue-600 hover:underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                      {{ t("settingsGeminiTab.step1Link") }}
                    </a>
                  </template>
                </i18n-t>
              </li>
              <li>
                <i18n-t keypath="settingsGeminiTab.step2" tag="span">
                  <template #createKey>
                    <strong>{{ t("settingsGeminiTab.step2CreateKey") }}</strong>
                  </template>
                </i18n-t>
              </li>
              <li>
                <i18n-t keypath="settingsGeminiTab.step3" tag="span">
                  <template #envFile><code class="font-mono bg-gray-100 px-1 rounded">.env</code></template>
                </i18n-t>
                <pre class="mt-1 text-xs bg-gray-900 text-gray-100 rounded px-3 py-2 font-mono overflow-x-auto">GEMINI_API_KEY=AIza…</pre>
              </li>
              <li>{{ t("settingsGeminiTab.step4") }}</li>
            </ol>
          </div>
          <p class="text-xs text-gray-500 italic">{{ t("settingsGeminiTab.freeNote") }}</p>
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

      <div v-if="activeTab !== 'gemini'" class="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-3">
        <span v-if="statusMessage" class="text-xs" :class="statusError ? 'text-red-600' : 'text-green-600'" data-testid="settings-status">
          {{ statusMessage }}
        </span>
        <span v-else class="text-xs text-gray-500"> {{ t("settingsModal.changesHint") }} </span>
        <div class="flex gap-2">
          <button class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" data-testid="settings-cancel-btn" @click="close">
            {{ t("common.cancel") }}
          </button>
          <button
            class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            :disabled="saving || loading || !!loadError"
            :title="loadError ? t('settingsModal.cannotSaveTooltip') : undefined"
            data-testid="settings-save-btn"
            @click="save"
          >
            {{ saving ? t("settingsModal.saving") : loading ? t("settingsModal.loadingLabel") : t("common.save") }}
          </button>
        </div>
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

interface Props {
  open: boolean;
  dockerMode?: boolean;
  // Drives the "Gemini" warning tab. True (optimistic) by default so
  // we don't flash the warning tab during boot before useHealth has
  // returned. See src/composables/useHealth.ts for the first-fetch
  // fallback that flips this to false when the /api/health probe
  // confirms the key is missing.
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
}>();

// Typed ref to the SettingsMcpTab so save() can flush a pending draft
// before PUTing (eliminates the "user typed but forgot the inner Add
// button" footgun). Null when the MCP tab isn't the active one.
const mcpTabRef = ref<{ flushDraft: () => boolean } | null>(null);

const activeTab = ref<"gemini" | "tools" | "mcp" | "dirs" | "refs">("tools");
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
    .map((line) => line.trim())
    .filter((line) => line.length > 0),
);

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
    statusMessage.value = "Finish or cancel the pending MCP server entry first.";
    return;
  }
  saving.value = true;
  statusMessage.value = "";
  statusError.value = false;
  // Single atomic endpoint — avoids the partial-save state where
  // extraAllowedTools is persisted but MCP config write fails.
  const response = await apiPut<unknown>(API_ROUTES.config.base, {
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
      // Default to the Gemini warning tab when the key is missing —
      // that's the most likely reason the user opened settings. When
      // the key is present the tab isn't rendered at all, so fall back
      // to "tools" (or whatever tab was last active across opens).
      if (!props.geminiAvailable) activeTab.value = "gemini";
      else if (activeTab.value === "gemini") activeTab.value = "tools";
      loadConfig();
      statusMessage.value = "";
      statusError.value = false;
    }
  },
  { immediate: true },
);
</script>
