<template>
  <div class="h-full bg-white flex flex-col overflow-hidden">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0"
    >
      <div>
        <h2 class="text-lg font-semibold text-gray-800">Skills</h2>
        <p class="text-xs text-gray-400 mt-0.5">
          {{ skills.length }} available · click one to view · "Run" sends its
          SKILL.md as a message
        </p>
      </div>
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- Left: skill list -->
      <div
        class="w-64 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50"
      >
        <div
          v-for="skill in skills"
          :key="skill.name"
          :data-testid="`skill-item-${skill.name}`"
          class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors"
          :class="
            selectedName === skill.name
              ? 'bg-white border-l-2 border-l-blue-500'
              : ''
          "
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
        <p v-if="skills.length === 0" class="p-4 text-sm text-gray-400 italic">
          No skills found. Add skill folders under
          <code class="text-[11px]">~/.claude/skills/</code>.
        </p>
      </div>

      <!-- Right: detail pane -->
      <div class="flex-1 min-w-0 overflow-y-auto">
        <div v-if="!selected" class="p-6 text-sm text-gray-400 italic">
          Select a skill on the left to view its SKILL.md.
        </div>
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
              <button
                v-if="detail && detail.source === 'project'"
                class="px-3 py-1.5 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40 flex items-center gap-1"
                :disabled="detailLoading || deleting"
                data-testid="skill-delete-btn"
                @click="deleteSkill"
                title="Delete this project-scope skill"
              >
                <span class="material-icons text-base">delete</span>
                Delete
              </button>
              <button
                class="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 flex items-center gap-1"
                :disabled="detailLoading || !detail"
                data-testid="skill-run-btn"
                @click="runSkill"
              >
                <span class="material-icons text-base">play_arrow</span>
                Run
              </button>
            </div>
          </div>
          <div v-if="detailLoading" class="text-sm text-gray-400 italic">
            Loading…
          </div>
          <div v-else-if="detailError" class="text-sm text-red-600">
            {{ detailError }}
          </div>
          <pre
            v-else-if="detail"
            class="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded border border-gray-200"
            >{{ detail.body || "(empty body)" }}</pre
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSkillsData, SkillSummary } from "./index";

interface SkillDetail {
  name: string;
  description: string;
  body: string;
  source: "user" | "project";
  path: string;
}

const props = defineProps<{
  selectedResult: ToolResultComplete<ManageSkillsData>;
}>();

// Local mutable copy of the skill list so the Delete button can
// remove rows without waiting for a fresh tool_result push.
// Re-seeded whenever the underlying tool result changes.
const skills = ref<SkillSummary[]>(props.selectedResult.data?.skills ?? []);
const selectedName = ref<string | null>(skills.value[0]?.name ?? null);
const detail = ref<SkillDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const deleting = ref(false);

const selected = computed(
  () => skills.value.find((s) => s.name === selectedName.value) ?? null,
);

// Reset the selection when the tool result is replaced (e.g. the
// user opens a newer `manageSkills` invocation from the sidebar).
watch(
  () => props.selectedResult.uuid,
  () => {
    skills.value = props.selectedResult.data?.skills ?? [];
    selectedName.value = skills.value[0]?.name ?? null;
  },
);

// Fetch detail when the selection changes. Failures surface inline
// so the Run button stays disabled and the user sees why.
watch(
  selectedName,
  async (name) => {
    if (!name) {
      detail.value = null;
      return;
    }
    detailLoading.value = true;
    detailError.value = null;
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
      if (!res.ok) {
        detailError.value = `Failed to load skill: ${res.statusText}`;
        detail.value = null;
        return;
      }
      const body: { skill: SkillDetail } = await res.json();
      detail.value = body.skill;
    } catch (err) {
      detailError.value = err instanceof Error ? err.message : String(err);
      detail.value = null;
    } finally {
      detailLoading.value = false;
    }
  },
  { immediate: true },
);

// Run = send the skill invocation as a Claude Code slash command.
// Claude CLI already knows about every ~/.claude/skills/<name>/SKILL.md
// at spawn, so sending `/<name>` is enough — no need to ship the
// body. App.vue listens for the `skill-run` window event and routes
// to its existing sendMessage pipeline. (See論点 1 on PR #224.)
function runSkill(): void {
  if (!selectedName.value) return;
  window.dispatchEvent(
    new CustomEvent("skill-run", {
      detail: { message: `/${selectedName.value}` },
    }),
  );
}

// Delete is project-scope only — see saveProjectSkill / deleteProjectSkill
// in server/skills/writer.ts. The button is hidden in the template
// when source !== "project". A native confirm() is enough for phase 1
// since the action is reversible by re-saving via the conversation.
async function deleteSkill(): Promise<void> {
  if (!detail.value || detail.value.source !== "project") return;
  const name = detail.value.name;
  if (
    !window.confirm(
      `Delete skill "${name}"? This removes ~/mulmoclaude/.claude/skills/${name}/SKILL.md.`,
    )
  ) {
    return;
  }
  deleting.value = true;
  try {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      detailError.value = body.error ?? `Failed to delete: ${res.statusText}`;
      return;
    }
    // Remove from the local list, advance selection, clear detail.
    const idx = skills.value.findIndex((s) => s.name === name);
    if (idx >= 0) {
      skills.value.splice(idx, 1);
    }
    selectedName.value = skills.value[0]?.name ?? null;
    detail.value = null;
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : String(err);
  } finally {
    deleting.value = false;
  }
}
</script>
