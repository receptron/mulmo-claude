<template>
  <div class="h-full bg-white flex flex-col">
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
      <h2 class="text-lg font-semibold text-gray-800">{{ t("pluginManageRoles.heading") }}</h2>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-500">{{ t("pluginManageRoles.roleCount", customRoles.length, { named: { count: customRoles.length } }) }}</span>
        <button v-if="!creating" data-testid="role-add-btn" class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600" @click="startCreate">
          {{ t("pluginManageRoles.addButton") }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- New role creation panel -->
      <div v-if="creating" class="m-4 border border-blue-300 bg-blue-50 rounded-lg p-4 space-y-3">
        <div class="text-sm font-semibold text-gray-700">{{ t("pluginManageRoles.createPanel") }}</div>

        <!-- ID + Name + Icon row -->
        <div class="flex gap-3">
          <div class="w-40">
            <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageRoles.fieldId") }}</label>
            <input
              v-model="newForm.id"
              type="text"
              placeholder="unique-id"
              class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono focus:outline-none focus:border-blue-400"
            />
          </div>
          <div class="flex-1">
            <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageRoles.fieldName") }}</label>
            <input
              v-model="newForm.name"
              type="text"
              class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            />
          </div>
          <div class="w-32">
            <label class="block text-xs font-medium text-gray-600 mb-1">
              {{ t("pluginManageRoles.fieldIcon") }}
              <a class="text-blue-400 font-normal ml-1" href="https://fonts.google.com/icons" target="_blank" rel="noopener">{{
                t("pluginManageRoles.helpLink")
              }}</a>
            </label>
            <input
              v-model="newForm.icon"
              type="text"
              class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>

        <!-- Prompt -->
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageRoles.fieldPrompt") }}</label>
          <textarea
            v-model="newForm.prompt"
            rows="6"
            class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono resize-y focus:outline-none focus:border-blue-400"
            spellcheck="false"
          />
        </div>

        <!-- Plugins -->
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-2">{{ t("pluginManageRoles.fieldPlugins") }}</label>
          <div class="grid gap-x-4 gap-y-1 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            <label
              v-for="plugin in availablePlugins"
              :key="plugin.name"
              class="flex items-center gap-2 text-sm cursor-pointer"
              :class="plugin.enabled ? 'text-gray-700' : 'text-gray-400 cursor-not-allowed'"
              :title="plugin.enabled ? '' : t('pluginManageRoles.requiresEnv', { env: plugin.requiredEnv.join(', ') })"
            >
              <input
                v-model="newForm.selectedPlugins"
                type="checkbox"
                :value="plugin.name"
                :disabled="!plugin.enabled"
                class="cursor-pointer disabled:cursor-not-allowed"
              />
              {{ plugin.name }}
              <span v-if="!plugin.enabled" class="text-xs text-gray-400">{{ t("pluginManageRoles.missingEnv", { env: plugin.requiredEnv.join(", ") }) }}</span>
            </label>
          </div>
        </div>

        <!-- Starter queries -->
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">
            {{ t("pluginManageRoles.fieldStarterQueries") }}
            <span class="text-gray-400 font-normal">{{ t("pluginManageRoles.onePerLine") }}</span>
          </label>
          <textarea
            v-model="newForm.queriesText"
            rows="3"
            class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-y focus:outline-none focus:border-blue-400"
          />
        </div>

        <!-- Buttons -->
        <div class="flex gap-2 pt-1">
          <button
            class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="saving || !!newFormError"
            :title="newFormError ?? ''"
            @click="saveNew"
          >
            {{ saving ? t("pluginManageRoles.creating") : t("pluginManageRoles.create") }}
          </button>
          <button class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" @click="cancelCreate">
            {{ t("common.cancel") }}
          </button>
        </div>
        <div v-if="newFormError" class="text-xs text-gray-500" data-testid="role-form-hint">
          {{ newFormError }}
        </div>
        <div v-if="createError" class="text-xs text-red-500">
          {{ createError }}
        </div>
      </div>

      <div v-if="!creating && customRoles.length === 0" class="h-full flex items-center justify-center text-gray-400 text-sm">
        {{ t("pluginManageRoles.emptyHint") }}
      </div>

      <ul v-if="customRoles.length > 0" class="p-4 space-y-2">
        <li v-for="role in customRoles" :key="role.id" class="rounded-lg border" :class="selectedId === role.id ? 'border-blue-400' : 'border-gray-200'">
          <!-- Role header row -->
          <div
            class="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 rounded-lg"
            :class="selectedId === role.id ? 'rounded-b-none' : ''"
            @click="selectRole(role)"
          >
            <span class="material-icons text-gray-500">{{ role.icon }}</span>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm text-gray-800">
                {{ role.name }}
                <span class="ml-1 text-xs font-mono text-gray-400">{{ t("pluginManageRoles.idFormatted", { id: role.id }) }}</span>
              </div>
              <div class="text-xs text-gray-400 truncate">
                {{ role.availablePlugins.join(", ") }}
              </div>
            </div>
            <span
              class="material-icons text-gray-400 text-sm"
              :title="selectedId === role.id ? t('pluginManageRoles.collapse') : t('pluginManageRoles.expand')"
            >
              {{ selectedId === role.id ? "expand_less" : "expand_more" }}
            </span>
          </div>

          <!-- Inline editor -->
          <div v-if="selectedId === role.id" class="border-t border-blue-100 bg-blue-50 p-4 space-y-3 rounded-b-lg">
            <!-- ID + Name + Icon row -->
            <div class="flex gap-3">
              <div class="w-40">
                <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageRoles.fieldId") }}</label>
                <input
                  v-model="editForm.id"
                  type="text"
                  class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono focus:outline-none focus:border-blue-400"
                />
              </div>
              <div class="flex-1">
                <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageRoles.fieldName") }}</label>
                <input
                  v-model="editForm.name"
                  type="text"
                  class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                  @keydown.enter="saveEdit(role.id)"
                />
              </div>
              <div class="w-32">
                <label class="block text-xs font-medium text-gray-600 mb-1">
                  {{ t("pluginManageRoles.fieldIcon") }}
                  <a class="text-blue-400 font-normal ml-1" href="https://fonts.google.com/icons" target="_blank" rel="noopener">{{
                    t("pluginManageRoles.helpLink")
                  }}</a>
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
              <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageRoles.fieldPrompt") }}</label>
              <textarea
                v-model="editForm.prompt"
                rows="6"
                class="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono resize-y focus:outline-none focus:border-blue-400"
                spellcheck="false"
              />
            </div>

            <!-- Plugins -->
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-2">{{ t("pluginManageRoles.fieldPlugins") }}</label>
              <div class="grid gap-x-4 gap-y-1 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
                <label
                  v-for="plugin in availablePlugins"
                  :key="plugin.name"
                  class="flex items-center gap-2 text-sm cursor-pointer"
                  :class="plugin.enabled ? 'text-gray-700' : 'text-gray-400 cursor-not-allowed'"
                  :title="plugin.enabled ? '' : t('pluginManageRoles.requiresEnv', { env: plugin.requiredEnv.join(', ') })"
                >
                  <input
                    v-model="editForm.selectedPlugins"
                    type="checkbox"
                    :value="plugin.name"
                    :disabled="!plugin.enabled"
                    class="cursor-pointer disabled:cursor-not-allowed"
                  />
                  {{ plugin.name }}
                  <span v-if="!plugin.enabled" class="text-xs text-gray-400">{{
                    t("pluginManageRoles.missingEnv", { env: plugin.requiredEnv.join(", ") })
                  }}</span>
                </label>
              </div>
            </div>

            <!-- Starter queries -->
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">
                {{ t("pluginManageRoles.fieldStarterQueries") }}
                <span class="text-gray-400 font-normal">{{ t("pluginManageRoles.onePerLine") }}</span>
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
                  class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="saving || !!editFormError"
                  :title="editFormError ?? ''"
                  @click="saveEdit(role.id)"
                >
                  {{ saving ? t("pluginManageRoles.updating") : t("pluginManageRoles.update") }}
                </button>
                <button class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" @click="selectedId = null">
                  {{ t("common.cancel") }}
                </button>
              </div>
              <button
                class="px-3 py-1.5 text-sm rounded border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50"
                :disabled="saving"
                @click="deleteRole(role.id)"
              >
                {{ t("pluginManageRoles.delete") }}
              </button>
            </div>
            <div v-if="editFormError" class="text-xs text-gray-500">
              {{ editFormError }}
            </div>
            <div v-if="saveError" class="text-xs text-red-500">
              {{ saveError }}
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useFreshPluginData } from "../../composables/useFreshPluginData";
import { useAppApi } from "../../composables/useAppApi";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { CustomRole, ManageRolesData } from "./index";
import { getAllPluginNames } from "../../tools/index";
import { apiGet, apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

const { t } = useI18n();

interface PluginEntry {
  name: string;
  enabled: boolean;
  requiredEnv: string[];
}

// Plugins the user can assign — exclude internal/auto-managed ones
const EXCLUDED = new Set(["text-response", "switchRole"]);
const guiPlugins: PluginEntry[] = getAllPluginNames()
  .filter((name) => !EXCLUDED.has(name))
  .map((name) => ({ name, enabled: true, requiredEnv: [] }));

const availablePlugins = ref<PluginEntry[]>(guiPlugins);

onMounted(async () => {
  const result = await apiGet<PluginEntry[]>(API_ROUTES.mcpTools.list);
  if (result.ok) {
    availablePlugins.value = [...guiPlugins, ...result.data];
  }
  // Non-critical: MCP tools enrich the plugin palette for role editing
  // but the view works fine with GUI plugins alone. No error banner needed.
});

const props = defineProps<{
  selectedResult?: ToolResultComplete<ManageRolesData>;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const appApi = useAppApi();

const customRoles = ref<CustomRole[]>(props.selectedResult?.data?.customRoles ?? []);

const { refresh: refreshCustomRoles } = useFreshPluginData<CustomRole[]>({
  endpoint: () => API_ROUTES.roles.list,
  extract: (json) => (Array.isArray(json) ? (json as CustomRole[]) : null),
  apply: (data) => {
    customRoles.value = data;
  },
});

watch(
  () => props.selectedResult?.uuid,
  () => {
    customRoles.value = props.selectedResult?.data?.customRoles ?? [];
    void refreshCustomRoles();
  },
);

// ── Selection & edit form ─────────────────────────────────────────────────────

const selectedId = ref<string | null>(null);
const saving = ref(false);
const saveError = ref("");

interface EditForm {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  selectedPlugins: string[];
  queriesText: string;
}

const editForm = ref<EditForm>({
  id: "",
  name: "",
  icon: "",
  prompt: "",
  selectedPlugins: [],
  queriesText: "",
});

const creating = ref(false);
const createError = ref("");
const newForm = ref<EditForm>({
  id: "",
  name: "",
  icon: "person",
  prompt: "",
  selectedPlugins: [],
  queriesText: "",
});

function startCreate() {
  selectedId.value = null;
  createError.value = "";
  newForm.value = {
    id: "",
    name: "",
    icon: "person",
    prompt: "",
    selectedPlugins: [],
    queriesText: "",
  };
  creating.value = true;
}

function cancelCreate() {
  creating.value = false;
  createError.value = "";
}

function selectRole(role: CustomRole) {
  if (selectedId.value === role.id) {
    selectedId.value = null;
    return;
  }
  selectedId.value = role.id;
  saveError.value = "";
  editForm.value = {
    id: role.id,
    name: role.name,
    icon: role.icon,
    prompt: role.prompt,
    selectedPlugins: role.availablePlugins.filter((plugin) => plugin !== "switchRole"),
    queriesText: (role.queries ?? []).join("\n"),
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

interface ManageResult {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

async function callManage(body: Record<string, unknown>): Promise<ManageResult> {
  const result = await apiPost<ManageResult>(API_ROUTES.roles.manage, body);
  if (!result.ok) {
    // Prefer the backend's error message (e.g. validation failure
    // details). Fall back to a status code only when the server didn't
    // give us anything useful.
    return {
      success: false,
      error:
        result.status === 0
          ? result.error || t("pluginManageRoles.errNetworkError")
          : result.error || t("pluginManageRoles.errServerError", { status: result.status }),
    };
  }
  return result.data;
}

async function refreshList() {
  const result = await callManage({ action: "list" });
  if (result.success) {
    const data = result as { data?: { customRoles?: CustomRole[] } };
    customRoles.value = data.data?.customRoles ?? [];
    if (props.selectedResult) {
      emit("updateResult", {
        ...props.selectedResult,
        ...result,
        uuid: props.selectedResult.uuid,
      });
    }
    // Let App.vue know the dropdown needs to refresh.
    await Promise.resolve(appApi.refreshRoles());
  }
}

function validateRoleForm(form: EditForm, excludeId: string | null): string | null {
  const trimmedId = form.id.trim();
  const trimmedName = form.name.trim();
  if (!trimmedId) return t("pluginManageRoles.errIdRequired");
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
    return t("pluginManageRoles.errIdInvalid");
  }
  if (!trimmedName) return t("pluginManageRoles.errNameRequired");
  if (customRoles.value.some((existing) => existing.id === trimmedId && existing.id !== excludeId)) {
    return t("pluginManageRoles.errIdDuplicate", { id: trimmedId });
  }
  return null;
}

const newFormError = computed<string | null>(() => validateRoleForm(newForm.value, null));

const editFormError = computed<string | null>(() => validateRoleForm(editForm.value, selectedId.value));

function buildNewRole(): CustomRole {
  return {
    id: newForm.value.id.trim(),
    name: newForm.value.name.trim(),
    icon: newForm.value.icon.trim() || "person",
    prompt: newForm.value.prompt,
    availablePlugins: newForm.value.selectedPlugins,
    queries: newForm.value.queriesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

async function saveNew() {
  if (newFormError.value) {
    createError.value = newFormError.value;
    return;
  }
  saving.value = true;
  createError.value = "";
  const result = await callManage({ action: "create", role: buildNewRole() });
  if (result.success) {
    creating.value = false;
    await refreshList();
  } else {
    createError.value = result.error ?? t("pluginManageRoles.errCreateFailed");
  }
  saving.value = false;
}

async function saveEdit(originalId: string) {
  if (editFormError.value) {
    saveError.value = editFormError.value;
    return;
  }
  saving.value = true;
  saveError.value = "";
  const role: CustomRole = {
    id: editForm.value.id.trim(),
    name: editForm.value.name.trim(),
    icon: editForm.value.icon.trim(),
    prompt: editForm.value.prompt,
    availablePlugins: editForm.value.selectedPlugins,
    queries: editForm.value.queriesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
  const result = await callManage({
    action: "update",
    role,
    oldRoleId: originalId,
  });
  if (result.success) {
    selectedId.value = null;
    await refreshList();
  } else {
    saveError.value = result.error ?? t("pluginManageRoles.errSaveFailed");
  }
  saving.value = false;
}

async function deleteRole(roleId: string) {
  saving.value = true;
  saveError.value = "";
  const result = await callManage({ action: "delete", roleId });
  if (result.success) {
    selectedId.value = null;
    await refreshList();
  } else {
    saveError.value = result.error ?? t("pluginManageRoles.errDeleteFailed");
  }
  saving.value = false;
}
</script>
