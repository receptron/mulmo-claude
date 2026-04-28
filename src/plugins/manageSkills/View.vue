<template>
  <div class="h-full bg-white flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <div>
        <h2 class="text-lg font-semibold text-gray-800">{{ t("pluginManageSkills.heading") }}</h2>
        <p class="text-xs text-gray-400 mt-0.5">{{ t("pluginManageSkills.subheading", { count: skills.length }) }}</p>
      </div>
    </div>

    <!-- List load error (standalone mode) -->
    <div v-if="listError" class="px-6 py-3 text-sm text-red-600 bg-red-50 border-b border-red-100">
      {{ listError }}
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- Left: skill list -->
      <div class="w-64 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50">
        <div
          v-for="skill in skills"
          :key="skill.name"
          :data-testid="`skill-item-${skill.name}`"
          class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors"
          :class="selectedName === skill.name ? 'bg-white border-l-2 border-l-blue-500' : ''"
          @click="selectedName = skill.name"
        >
          <div class="font-medium text-gray-800 truncate">{{ skill.name }}</div>
          <div class="text-xs text-gray-500 truncate mt-0.5">
            {{ skill.description }}
          </div>
          <div class="text-[10px] text-gray-400 uppercase mt-0.5">
            {{ skill.source }}
          </div>
        </div>
        <i18n-t v-if="skills.length === 0" keypath="pluginManageSkills.emptyWithPath" tag="p" class="p-4 text-sm text-gray-400 italic">
          <template #path>
            <code class="text-[11px]">{{ t("pluginManageSkills.emptySkillPath") }}</code>
          </template>
        </i18n-t>
      </div>

      <!-- Right: detail pane -->
      <div class="flex-1 min-w-0 overflow-y-auto">
        <div v-if="!selected" class="p-6 text-sm text-gray-400 italic">{{ t("pluginManageSkills.selectHint") }}</div>
        <div v-else class="p-6">
          <div class="flex items-start justify-between gap-4 mb-4">
            <div class="min-w-0">
              <h3 class="text-xl font-semibold text-gray-800 truncate">
                {{ selected.name }}
              </h3>
              <p class="text-sm text-gray-600 mt-1">
                {{ selected.description }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <template v-if="editing">
                <button
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  data-testid="skill-cancel-btn"
                  @click="cancelEdit"
                >
                  {{ t("common.cancel") }}
                </button>
                <button
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-40"
                  :disabled="saving"
                  data-testid="skill-save-btn"
                  @click="saveEdit"
                >
                  <span class="material-icons text-sm">save</span>
                  {{ t("common.save") }}
                </button>
              </template>
              <template v-else>
                <button
                  v-if="detail && detail.source === 'project'"
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  :disabled="detailLoading"
                  data-testid="skill-edit-btn"
                  @click="startEdit"
                >
                  <span class="material-icons text-sm">edit</span>
                  {{ t("pluginManageSkills.btnEdit") }}
                </button>
                <button
                  v-if="detail && detail.source === 'project'"
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40"
                  :disabled="detailLoading || deleting"
                  data-testid="skill-delete-btn"
                  :title="t('pluginManageSkills.deleteProjectSkill')"
                  @click="deleteSkill"
                >
                  <span class="material-icons text-sm">delete</span>
                  {{ t("pluginManageSkills.btnDelete") }}
                </button>
                <button
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
                  :disabled="detailLoading || !detail"
                  data-testid="skill-run-btn"
                  @click="runSkill"
                >
                  <span class="material-icons text-sm">play_arrow</span>
                  {{ t("pluginManageSkills.btnRun") }}
                </button>
              </template>
            </div>
          </div>
          <div v-if="detailLoading" class="text-sm text-gray-400 italic">{{ t("pluginManageSkills.loading") }}</div>
          <div v-else-if="detailError" class="text-sm text-red-600">
            {{ detailError }}
          </div>
          <!-- Edit mode -->
          <div v-else-if="editing && detail" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1"> {{ t("pluginManageSkills.fieldDescription") }} </label>
              <input
                v-model="editDescription"
                data-testid="skill-edit-description"
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800"
              />
            </div>
            <div class="flex-1">
              <label class="block text-xs font-medium text-gray-500 mb-1"> {{ t("pluginManageSkills.fieldBody") }} </label>
              <textarea
                v-model="editBody"
                data-testid="skill-edit-body"
                class="w-full h-96 px-3 py-2 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800 resize-y"
              ></textarea>
            </div>
          </div>
          <!-- View mode -->
          <!-- eslint-disable-next-line vue/no-v-html -- sanitized via DOMPurify -->
          <div v-else-if="detail && renderedBody" class="markdown-content text-gray-700" data-testid="skill-body-rendered" v-html="renderedBody"></div>
          <p v-else-if="detail" class="text-sm text-gray-400 italic">{{ t("pluginManageSkills.emptyBody") }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSkillsData, SkillSummary } from "./index";
import { useAppApi } from "../../composables/useAppApi";
import { apiGet, apiPut, apiDelete } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

const { t } = useI18n();

interface SkillDetail {
  name: string;
  description: string;
  body: string;
  source: "user" | "project";
  path: string;
}

const props = defineProps<{
  selectedResult?: ToolResultComplete<ManageSkillsData>;
}>();

// Local mutable copy of the skill list so the Delete button can
// remove rows without waiting for a fresh tool_result push.
// Re-seeded whenever the underlying tool result changes.
const skills = ref<SkillSummary[]>(props.selectedResult?.data?.skills ?? []);
const selectedName = ref<string | null>(skills.value[0]?.name ?? null);
const detail = ref<SkillDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const deleting = ref(false);
const editing = ref(false);
const saving = ref(false);
const editDescription = ref("");
const editBody = ref("");

const selected = computed(() => skills.value.find((skill) => skill.name === selectedName.value) ?? null);

const renderedBody = computed(() => {
  const body = detail.value?.body;
  if (!body) return "";
  return DOMPurify.sanitize(marked(body) as string);
});

// Reset the selection when the tool result is replaced (e.g. the
// user opens a newer `manageSkills` invocation from the sidebar).
watch(
  () => props.selectedResult?.uuid,
  () => {
    skills.value = props.selectedResult?.data?.skills ?? [];
    selectedName.value = skills.value[0]?.name ?? null;
  },
);

const listError = ref<string | null>(null);

// Standalone mode: if no selectedResult was passed, fetch the skill
// list from the API on mount so the view is populated.
onMounted(async () => {
  if (props.selectedResult || skills.value.length > 0) return;
  const response = await apiGet<{ skills: SkillSummary[] }>(API_ROUTES.skills.list);
  if (!response.ok) {
    listError.value = t("pluginManageSkills.errListFailed", { error: response.error });
    return;
  }
  if (Array.isArray(response.data.skills)) {
    skills.value = response.data.skills;
    selectedName.value = skills.value[0]?.name ?? null;
  }
});

// Fetch detail when the selection changes. Failures surface inline
// so the Run button stays disabled and the user sees why. Each request
// captures the `name` it was issued for — if the user clicks another
// skill while the first fetch is in flight, the slower response is
// discarded (otherwise stale detail can land under the new selection
// and break deleteSkill(), which reads `detail.value.name`).
watch(
  selectedName,
  async (name) => {
    if (!name) {
      detail.value = null;
      editing.value = false;
      return;
    }
    editing.value = false;
    detailLoading.value = true;
    detailError.value = null;
    const response = await apiGet<{ skill: SkillDetail }>(API_ROUTES.skills.detail.replace(":name", encodeURIComponent(name)));
    if (selectedName.value !== name) {
      // Selection changed while this request was in flight — drop it.
      return;
    }
    if (!response.ok) {
      detailError.value = t("pluginManageSkills.errDetailFailed", { error: response.error });
      detail.value = null;
    } else {
      detail.value = response.data.skill;
    }
    detailLoading.value = false;
  },
  { immediate: true },
);

function startEdit(): void {
  if (!detail.value) return;
  editDescription.value = detail.value.description;
  editBody.value = detail.value.body;
  editing.value = true;
}

function cancelEdit(): void {
  editing.value = false;
}

async function saveEdit(): Promise<void> {
  if (!detail.value) return;
  const { name } = detail.value;
  saving.value = true;
  detailError.value = null;
  const result = await apiPut<{ updated: boolean; path: string }>(API_ROUTES.skills.update.replace(":name", encodeURIComponent(name)), {
    description: editDescription.value,
    body: editBody.value,
  });
  saving.value = false;
  if (!result.ok) {
    detailError.value = t("pluginManageSkills.errSaveFailed", { error: result.error });
    return;
  }
  detail.value = {
    ...detail.value,
    description: editDescription.value,
    body: editBody.value,
  };
  // Update the sidebar summary too.
  const idx = skills.value.findIndex((skill) => skill.name === name);
  if (idx >= 0) {
    skills.value[idx] = {
      ...skills.value[idx],
      description: editDescription.value,
    };
  }
  editing.value = false;
}

// Run = send the skill invocation as a Claude Code slash command.
// Claude CLI already knows about every ~/.claude/skills/<name>/SKILL.md
// at spawn, so sending `/<name>` is enough — no need to ship the body.
// Uses startNewChat (not sendMessage) so the user is routed to /chat
// to see the response — Skills view is only rendered on /skills.
const appApi = useAppApi();

function runSkill(): void {
  if (!selectedName.value) return;
  appApi.startNewChat(`/${selectedName.value}`);
}

// Delete is project-scope only — see saveProjectSkill / deleteProjectSkill
// in server/skills/writer.ts. The button is hidden in the template
// when source !== "project". A native confirm() is enough for phase 1
// since the action is reversible by re-saving via the conversation.
async function deleteSkill(): Promise<void> {
  if (!detail.value || detail.value.source !== "project") return;
  const { name } = detail.value;
  if (!window.confirm(t("pluginManageSkills.confirmDelete", { name }))) {
    return;
  }
  deleting.value = true;
  const result = await apiDelete<unknown>(API_ROUTES.skills.remove.replace(":name", encodeURIComponent(name)));
  deleting.value = false;
  if (!result.ok) {
    detailError.value = result.error || t("pluginManageSkills.errDeleteFailed");
    return;
  }
  // Remove from the local list, advance selection, clear detail.
  const idx = skills.value.findIndex((skill) => skill.name === name);
  if (idx >= 0) {
    skills.value.splice(idx, 1);
  }
  selectedName.value = skills.value[0]?.name ?? null;
  detail.value = null;
}
</script>
