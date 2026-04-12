<template>
  <div class="h-full bg-white flex flex-col">
    <div
      class="flex items-center justify-between px-6 py-4 border-b border-gray-100"
    >
      <h2 class="text-lg font-semibold text-gray-800">Custom Roles</h2>
      <span class="text-sm text-gray-500">
        {{ customRoles.length }}
        role{{ customRoles.length !== 1 ? "s" : "" }}
      </span>
    </div>

    <div
      v-if="customRoles.length === 0"
      class="flex-1 flex items-center justify-center text-gray-400 text-sm"
    >
      No custom roles yet. Ask Claude to create one.
    </div>

    <ul v-else class="flex-1 overflow-y-auto p-4 space-y-2">
      <li
        v-for="role in customRoles"
        :key="role.id"
        class="rounded-lg border"
        :class="selectedId === role.id ? 'border-blue-400' : 'border-gray-200'"
      >
        <!-- Role header row -->
        <div
          class="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 rounded-lg"
          :class="selectedId === role.id ? 'rounded-b-none' : ''"
          @click="selectRole(role)"
        >
          <span class="material-icons text-gray-500">{{ role.icon }}</span>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm text-gray-800">{{ role.name }}</div>
            <div class="text-xs text-gray-400 truncate">
              {{ role.availablePlugins.join(", ") }}
            </div>
          </div>
          <span
            class="material-icons text-gray-400 text-sm"
            :title="selectedId === role.id ? 'Collapse' : 'Expand'"
          >
            {{ selectedId === role.id ? "expand_less" : "expand_more" }}
          </span>
        </div>

        <!-- Inline editor -->
        <div
          v-if="selectedId === role.id"
          class="border-t border-blue-100 bg-blue-50 p-4 space-y-3 rounded-b-lg"
        >
          <!-- Name + Icon row -->
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="block text-xs font-medium text-gray-600 mb-1"
                >Name</label
              >
              <input
                v-model="editForm.name"
                type="text"
                class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                @keydown.enter="saveEdit(role.id)"
              />
            </div>
            <div class="w-32">
              <label class="block text-xs font-medium text-gray-600 mb-1">
                Icon
                <a
                  class="text-blue-400 font-normal ml-1"
                  href="https://fonts.google.com/icons"
                  target="_blank"
                  rel="noopener"
                  >?</a
                >
              </label>
              <input
                v-model="editForm.icon"
                type="text"
                class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>

          <!-- Prompt -->
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1"
              >Prompt</label
            >
            <textarea
              v-model="editForm.prompt"
              rows="6"
              class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono resize-y focus:outline-none focus:border-blue-400"
              spellcheck="false"
            />
          </div>

          <!-- Plugins -->
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-2"
              >Plugins</label
            >
            <div class="grid grid-cols-2 gap-x-4 gap-y-1">
              <label
                v-for="plugin in availablePlugins"
                :key="plugin.name"
                class="flex items-center gap-2 text-sm cursor-pointer"
                :class="
                  plugin.enabled
                    ? 'text-gray-700'
                    : 'text-gray-400 cursor-not-allowed'
                "
                :title="
                  plugin.enabled
                    ? ''
                    : `Requires ${plugin.requiredEnv.join(', ')} in .env`
                "
              >
                <input
                  v-model="editForm.selectedPlugins"
                  type="checkbox"
                  :value="plugin.name"
                  :disabled="!plugin.enabled"
                  class="cursor-pointer disabled:cursor-not-allowed"
                />
                {{ plugin.name }}
                <span v-if="!plugin.enabled" class="text-xs text-gray-400"
                  >(missing {{ plugin.requiredEnv.join(", ") }})</span
                >
              </label>
            </div>
          </div>

          <!-- Starter queries -->
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">
              Starter queries
              <span class="text-gray-400 font-normal">(one per line)</span>
            </label>
            <textarea
              v-model="editForm.queriesText"
              rows="3"
              class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-y focus:outline-none focus:border-blue-400"
            />
          </div>

          <!-- Buttons -->
          <div class="flex items-center justify-between pt-1">
            <div class="flex gap-2">
              <button
                class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                :disabled="saving"
                @click="saveEdit(role.id)"
              >
                {{ saving ? "Updating…" : "Update" }}
              </button>
              <button
                class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                @click="selectedId = null"
              >
                Cancel
              </button>
            </div>
            <button
              class="px-3 py-1.5 text-sm rounded border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50"
              :disabled="saving"
              @click="deleteRole(role.id)"
            >
              Delete
            </button>
          </div>
          <div v-if="saveError" class="text-xs text-red-500">
            {{ saveError }}
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { CustomRole, ManageRolesData } from "./index";
import { getAllPluginNames } from "../../tools/index";

interface PluginEntry {
  name: string;
  enabled: boolean;
  requiredEnv: string[];
}

// Plugins the user can assign — exclude internal/auto-managed ones
const EXCLUDED = new Set(["text-response", "switchRole"]);
const guiPlugins: PluginEntry[] = getAllPluginNames()
  .filter((p) => !EXCLUDED.has(p))
  .map((name) => ({ name, enabled: true, requiredEnv: [] }));

const availablePlugins = ref<PluginEntry[]>(guiPlugins);

onMounted(async () => {
  try {
    const res = await fetch("/api/mcp-tools");
    if (res.ok) {
      const mcpTools: PluginEntry[] = await res.json();
      availablePlugins.value = [...guiPlugins, ...mcpTools];
    }
  } catch {
    // silently fall back to GUI plugins only
  }
});

const props = defineProps<{
  selectedResult: ToolResultComplete<ManageRolesData>;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const customRoles = ref<CustomRole[]>(
  props.selectedResult.data?.customRoles ?? [],
);

const { refresh: refreshCustomRoles } = useFreshPluginData<CustomRole[]>({
  endpoint: () => "/api/roles",
  extract: (json) => (Array.isArray(json) ? (json as CustomRole[]) : null),
  apply: (data) => {
    customRoles.value = data;
  },
});

// Sync with parent prop changes when the tool result is swapped
// (e.g. moving between sessions). Previously this component was
// missing a watch entirely, so it never picked up prop changes
// after mount — closing CodeRabbit V1 #2/#4/#7's coverage gap.
watch(
  () => props.selectedResult.uuid,
  () => {
    customRoles.value = props.selectedResult.data?.customRoles ?? [];
    void refreshCustomRoles();
  },
);

// ── Selection & edit form ─────────────────────────────────────────────────────

const selectedId = ref<string | null>(null);
const saving = ref(false);
const saveError = ref("");

interface EditForm {
  name: string;
  icon: string;
  prompt: string;
  selectedPlugins: string[];
  queriesText: string;
}

const editForm = ref<EditForm>({
  name: "",
  icon: "",
  prompt: "",
  selectedPlugins: [],
  queriesText: "",
});

function selectRole(role: CustomRole) {
  if (selectedId.value === role.id) {
    selectedId.value = null;
    return;
  }
  selectedId.value = role.id;
  saveError.value = "";
  editForm.value = {
    name: role.name,
    icon: role.icon,
    prompt: role.prompt,
    selectedPlugins: role.availablePlugins.filter((p) => p !== "switchRole"),
    queriesText: (role.queries ?? []).join("\n"),
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

interface ManageResult {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

async function callManage(
  body: Record<string, unknown>,
): Promise<ManageResult> {
  try {
    const res = await fetch("/api/roles/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok)
      return { success: false, error: `Server error: ${res.status}` };
    return res.json();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

async function refreshList() {
  const result = await callManage({ action: "list" });
  if (result.success) {
    const data = result as { data?: { customRoles?: CustomRole[] } };
    customRoles.value = data.data?.customRoles ?? [];
    emit("updateResult", {
      ...props.selectedResult,
      ...result,
      uuid: props.selectedResult.uuid,
    });
    // Let App.vue know the dropdown needs to refresh
    window.dispatchEvent(new CustomEvent("roles-updated"));
  }
}

async function saveEdit(id: string) {
  saving.value = true;
  saveError.value = "";
  const role: CustomRole = {
    id,
    name: editForm.value.name.trim(),
    icon: editForm.value.icon.trim(),
    prompt: editForm.value.prompt,
    availablePlugins: editForm.value.selectedPlugins,
    queries: editForm.value.queriesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const result = await callManage({ action: "update", role });
  if (result.success) {
    selectedId.value = null;
    await refreshList();
  } else {
    saveError.value = result.error ?? "Save failed";
  }
  saving.value = false;
}

async function deleteRole(id: string) {
  saving.value = true;
  saveError.value = "";
  const result = await callManage({ action: "delete", roleId: id });
  if (result.success) {
    selectedId.value = null;
    await refreshList();
  } else {
    saveError.value = result.error ?? "Delete failed";
  }
  saving.value = false;
}
</script>
