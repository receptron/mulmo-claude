<template>
  <div class="h-full bg-white flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <div>
        <h2 class="text-lg font-semibold text-gray-800">{{ t("pluginManageSkills.heading") }}</h2>
        <p class="text-xs text-gray-400 mt-0.5">{{ t("pluginManageSkills.subheading", { count: skills.length }) }}</p>
        <i18n-t keypath="pluginManageSkills.sectionLegendActive" tag="p" class="text-xs text-gray-400 mt-0.5">
          <template #system>
            <span class="material-icons !text-sm align-middle leading-none text-gray-500" aria-hidden="true">lock</span>
          </template>
          <template #project>
            <span class="material-icons !text-sm align-middle leading-none text-green-600" aria-hidden="true">folder</span>
          </template>
          <template #user>
            <span class="material-icons !text-sm align-middle leading-none text-blue-500" aria-hidden="true">home</span>
          </template>
        </i18n-t>
        <i18n-t keypath="pluginManageSkills.sectionLegendCatalog" tag="p" class="text-xs text-gray-400 mt-0.5">
          <template #star>
            <span class="material-icons !text-sm align-middle leading-none text-amber-500" aria-hidden="true">star</span>
          </template>
        </i18n-t>
      </div>
    </div>

    <!-- List load error (standalone mode) -->
    <div v-if="listError" class="px-6 py-3 text-sm text-red-600 bg-red-50 border-b border-red-100">
      {{ listError }}
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- Left: two collapsible sections — Active (discovered by
           Claude Code, loaded into the prompt) and Catalog (browse /
           ★ star / ▶ run once without bloating the prompt). Aligns
           with the #1335 catalog/active model. -->
      <div class="w-64 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50">
        <!-- ★ Active -->
        <div data-testid="skill-section-active">
          <button
            type="button"
            data-testid="skill-section-toggle-active"
            class="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-100 border-b border-gray-100"
            :aria-expanded="isSectionOpen('active')"
            aria-controls="skill-section-panel-active"
            @click="toggleSection('active')"
          >
            <span class="flex items-center gap-1">
              <span class="material-icons text-base">{{ isSectionOpen("active") ? "expand_more" : "chevron_right" }}</span>
              {{ t("pluginManageSkills.sectionActive") }}
            </span>
            <span data-testid="skill-section-count-active" class="text-gray-400 font-normal normal-case">{{ activeSkills.length }}</span>
          </button>
          <div v-show="isSectionOpen('active')" id="skill-section-panel-active" role="group">
            <div
              v-for="skill in activeSkills"
              :key="skill.name"
              :data-testid="`skill-item-${skill.name}`"
              class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
              :class="selectedName === skill.name && !selectedCatalog ? 'bg-white border-l-2 border-l-blue-500' : ''"
              role="button"
              tabindex="0"
              :aria-pressed="selectedName === skill.name && !selectedCatalog"
              @click="selectActiveSkill(skill.name)"
              @keydown.enter.prevent="selectActiveSkill(skill.name)"
              @keydown.space.prevent="selectActiveSkill(skill.name)"
            >
              <div class="flex items-center gap-2">
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-gray-800 truncate">{{ skill.name }}</div>
                  <div class="text-xs text-gray-500 truncate mt-0.5">
                    {{ skill.description }}
                  </div>
                </div>
                <span class="shrink-0 material-icons text-sm" :class="skillBadge(skill).colour" :title="skillBadge(skill).title" aria-hidden="true">{{
                  skillBadge(skill).icon
                }}</span>
              </div>
            </div>
            <i18n-t v-if="activeSkills.length === 0" keypath="pluginManageSkills.emptyWithPath" tag="p" class="p-4 text-sm text-gray-400 italic">
              <template #path>
                <code class="text-[11px]">{{ t("pluginManageSkills.emptySkillPath") }}</code>
              </template>
            </i18n-t>
          </div>
        </div>

        <!-- 📚 Catalog: launcher-managed presets. Rows behave like the
             active list — click selects an entry, loading its detail
             into the right pane with ★ Star / ▶ Run once actions.
             Anthropic + Community sub-catalogs land with #1335 PR-C. -->
        <div data-testid="skill-section-catalog" class="border-t border-gray-200">
          <button
            type="button"
            data-testid="skill-section-toggle-catalog"
            class="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-100 border-b border-gray-100"
            :aria-expanded="isSectionOpen('catalog')"
            aria-controls="skill-section-panel-catalog"
            @click="toggleSection('catalog')"
          >
            <span class="flex items-center gap-1">
              <span class="material-icons text-base">{{ isSectionOpen("catalog") ? "expand_more" : "chevron_right" }}</span>
              {{ t("pluginManageSkills.sectionCatalog") }}
            </span>
            <span data-testid="skill-section-count-catalog" class="text-gray-400 font-normal normal-case">{{
              catalogPresets.length + catalogExternal.length
            }}</span>
          </button>
          <div v-show="isSectionOpen('catalog')" id="skill-section-panel-catalog" role="group">
            <div class="px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 font-semibold" data-testid="skill-catalog-section-heading">
              {{ t("pluginManageSkills.catalogPresetHeading") }}
            </div>
            <div
              v-for="entry in catalogPresets"
              :key="`catalog-preset-${entryKey(entry)}`"
              :data-testid="`skill-catalog-item-${entryKey(entry)}`"
              class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
              :class="selectedCatalogKey === entryKey(entry) ? 'bg-white border-l-2 border-l-blue-500' : ''"
              role="button"
              tabindex="0"
              :aria-pressed="selectedCatalogKey === entryKey(entry)"
              @click="selectCatalogEntry(entry)"
              @keydown.enter.prevent="selectCatalogEntry(entry)"
              @keydown.space.prevent="selectCatalogEntry(entry)"
            >
              <div class="flex items-center gap-2">
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-gray-700 truncate">{{ entry.name }}</div>
                  <div class="text-xs text-gray-500 truncate mt-0.5">{{ entry.description }}</div>
                </div>
                <span
                  v-if="entry.alreadyActive"
                  class="shrink-0 material-icons text-sm text-yellow-500"
                  :title="t('pluginManageSkills.catalogStarred')"
                  :data-testid="`skill-catalog-starred-indicator-${entryKey(entry)}`"
                  aria-hidden="true"
                  >star</span
                >
                <span class="shrink-0 material-icons text-sm" :class="presetSourceMeta.colour" :title="presetSourceMeta.title" aria-hidden="true">{{
                  presetSourceMeta.icon
                }}</span>
              </div>
            </div>
            <p v-if="catalogPresets.length === 0 && !catalogError" class="px-4 py-3 text-xs text-gray-400 italic" data-testid="skill-catalog-empty">
              {{ t("pluginManageSkills.catalogEmpty") }}
            </p>
            <div v-if="catalogError" class="px-4 py-2 text-xs text-red-600">{{ catalogError }}</div>

            <!-- External repos (#1383 PR-C2): one collapsible subgroup
                 per installed repo. Rows behave exactly like preset
                 rows (select → right pane with ★ Star / ▶ Run once). -->
            <div
              v-for="group in externalGroups"
              :key="`catalog-repo-${group.repo.repoId}`"
              :data-testid="`skill-catalog-repo-${group.repo.repoId}`"
              class="border-t border-gray-100"
            >
              <div class="w-full flex items-center hover:bg-gray-100">
                <button
                  type="button"
                  :data-testid="`skill-catalog-repo-toggle-${group.repo.repoId}`"
                  class="flex-1 min-w-0 flex items-center gap-1 px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 font-semibold"
                  :aria-expanded="isRepoOpen(group.repo.repoId)"
                  @click="toggleRepo(group.repo.repoId)"
                >
                  <span class="material-icons text-sm">{{ isRepoOpen(group.repo.repoId) ? "expand_more" : "chevron_right" }}</span>
                  <span class="truncate normal-case text-gray-600">{{ repoLabel(group.repo) }}</span>
                  <span class="text-gray-400 font-normal">({{ group.entries.length }})</span>
                </button>
                <button
                  type="button"
                  class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-blue-600 disabled:opacity-40"
                  :data-testid="`skill-catalog-repo-update-${group.repo.repoId}`"
                  :disabled="updatingRepoId === group.repo.repoId || uninstallingRepoId === group.repo.repoId"
                  :title="t('pluginManageSkills.catalogUpdateRepo')"
                  :aria-label="t('pluginManageSkills.catalogUpdateRepo')"
                  :aria-busy="updatingRepoId === group.repo.repoId"
                  @click="updateRepo(group.repo)"
                >
                  <span class="material-icons text-sm" :class="updatingRepoId === group.repo.repoId ? 'animate-spin' : ''" aria-hidden="true">refresh</span>
                </button>
                <button
                  type="button"
                  class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-red-600 disabled:opacity-40"
                  :data-testid="`skill-catalog-repo-uninstall-${group.repo.repoId}`"
                  :disabled="uninstallingRepoId === group.repo.repoId || updatingRepoId === group.repo.repoId"
                  :title="t('pluginManageSkills.catalogUninstallRepo')"
                  :aria-label="t('pluginManageSkills.catalogUninstallRepo')"
                  :aria-busy="uninstallingRepoId === group.repo.repoId"
                  @click="uninstallRepo(group.repo.repoId)"
                >
                  <span class="material-icons text-sm" aria-hidden="true">delete_outline</span>
                </button>
              </div>
              <div v-show="isRepoOpen(group.repo.repoId)" role="group">
                <div
                  v-for="entry in group.entries"
                  :key="`catalog-ext-${entryKey(entry)}`"
                  :data-testid="`skill-catalog-item-${entryKey(entry)}`"
                  class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
                  :class="selectedCatalogKey === entryKey(entry) ? 'bg-white border-l-2 border-l-blue-500' : ''"
                  role="button"
                  tabindex="0"
                  :aria-pressed="selectedCatalogKey === entryKey(entry)"
                  @click="selectCatalogEntry(entry)"
                  @keydown.enter.prevent="selectCatalogEntry(entry)"
                  @keydown.space.prevent="selectCatalogEntry(entry)"
                >
                  <div class="flex items-center gap-2">
                    <div class="flex-1 min-w-0">
                      <div class="font-medium text-gray-700 truncate">{{ entry.name }}</div>
                      <div class="text-xs text-gray-500 truncate mt-0.5">{{ entry.description }}</div>
                    </div>
                    <span
                      v-if="entry.alreadyActive"
                      class="shrink-0 material-icons text-sm text-yellow-500"
                      :title="t('pluginManageSkills.catalogStarred')"
                      :data-testid="`skill-catalog-starred-indicator-${entryKey(entry)}`"
                      aria-hidden="true"
                      >star</span
                    >
                    <span class="shrink-0 material-icons text-sm text-gray-400" :title="t('pluginManageSkills.sourceExternalTitle')" aria-hidden="true"
                      >cloud</span
                    >
                  </div>
                </div>
                <p v-if="group.entries.length === 0" class="px-4 py-3 text-xs text-gray-400 italic">
                  {{ t("pluginManageSkills.catalogRepoEmpty") }}
                </p>
              </div>
            </div>

            <button
              type="button"
              data-testid="skill-catalog-add-repo"
              class="w-full flex items-center gap-1 px-4 py-3 text-sm text-blue-600 hover:bg-white border-t border-gray-100"
              @click="openAddRepo"
            >
              <span class="material-icons text-sm" aria-hidden="true">add</span>
              {{ t("pluginManageSkills.catalogAddRepo") }}
            </button>
          </div>
        </div>
      </div>

      <!-- Right: detail pane -->
      <div class="flex-1 min-w-0 overflow-y-auto">
        <CatalogDetailPane
          v-if="selectedCatalog"
          :entry="selectedCatalog"
          :source-meta="presetSourceMeta"
          :actioning-key="catalogActioningKey"
          :loading="catalogDetailLoading"
          :error="catalogError"
          :detail="catalogDetail"
          @star="starCatalogEntry"
        />

        <div v-else-if="!selected" class="p-6 text-sm text-gray-400 italic">{{ t("pluginManageSkills.selectHint") }}</div>
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
                  v-if="isSelectedEditable"
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  :disabled="detailLoading"
                  data-testid="skill-edit-btn"
                  @click="startEdit"
                >
                  <span class="material-icons text-sm">edit</span>
                  {{ t("pluginManageSkills.btnEdit") }}
                </button>
                <button
                  v-if="isSelectedEditable"
                  class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  :class="isSelectedPreset ? '' : 'border-red-300 text-red-600 hover:bg-red-50'"
                  :disabled="detailLoading || deleting"
                  :data-testid="isSelectedPreset ? 'skill-unstar-btn' : 'skill-delete-btn'"
                  :title="isSelectedPreset ? t('pluginManageSkills.unstarPresetSkill') : t('pluginManageSkills.deleteProjectSkill')"
                  @click="deleteSkill"
                >
                  <span class="material-icons text-sm" :class="isSelectedPreset ? 'text-amber-500' : ''">{{
                    isSelectedPreset ? "star_border" : "delete"
                  }}</span>
                  {{ isSelectedPreset ? t("pluginManageSkills.btnUnstar") : t("pluginManageSkills.btnDelete") }}
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
          <!-- eslint-disable vue/no-v-html -- sanitized via DOMPurify; multi-line element so disable/enable pair (CLAUDE.md UI rule) instead of -next-line -->
          <div
            v-else-if="detail && renderedBody"
            ref="skillMarkdownRef"
            class="markdown-content text-gray-700"
            data-testid="skill-body-rendered"
            @click="handleExternalLinkClick"
            v-html="renderedBody"
          ></div>
          <!-- eslint-enable vue/no-v-html -->
          <p v-else-if="detail" class="text-sm text-gray-400 italic">{{ t("pluginManageSkills.emptyBody") }}</p>
        </div>
      </div>
    </div>

    <AddRepoModal
      v-if="addRepoOpen"
      v-model:url="addRepoUrl"
      v-model:subpath="addRepoSubpath"
      :error="addRepoError"
      :busy="addRepoBusy"
      :suggestions="suggestions"
      :selected-suggestion-url="selectedSuggestionUrl"
      @close="addRepoOpen = false"
      @install="installRepo(addRepoUrl, addRepoSubpath)"
      @select-suggestion="selectSuggestion"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSkillsData, SkillSummary } from "./index";
import { apiGet, apiPut, apiDelete } from "../../utils/api";
import { handleExternalLinkClick } from "@mulmoclaude/markdown-utils/dom/externalLink";
import { pluginEndpoints } from "../api";
import { buildRouteUrl } from "../meta-types";
import type { SkillsEndpoints } from "./definition";
import {
  loadCollapsedSections,
  persistCollapsedSections,
  pickInitialSelection,
  entryKey,
  repoLabel,
  toggleInSet,
  skillBadgeMeta,
  PRESET_SOURCE_META,
  type SkillSectionKey,
  type SourceMeta,
} from "./categories";
import { isPresetActivation } from "./presetDetection";
import { updateSkillDescription, removeSkillByName } from "./skillListEdits";
import { useSkillMarkdown } from "./useSkillMarkdown";
import { useSkillCatalog } from "./useSkillCatalog";
import { useExternalRepos } from "./useExternalRepos";
import AddRepoModal from "./AddRepoModal.vue";
import CatalogDetailPane from "./CatalogDetailPane.vue";

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

// Local copy of the skill list so the Delete button can remove rows
// without waiting for a fresh tool_result push. Shallow-copied (not the
// prop array by reference) so local edits never rewrite the shared
// tool result the Preview / chat export also read. Re-seeded whenever
// the underlying tool result changes.
const skills = ref<SkillSummary[]>([...(props.selectedResult?.data?.skills ?? [])]);

// Collapsed-section state for the sidebar (active / catalog). Persisted
// to localStorage so each user's preference survives reloads.
// shallowRef because we always replace the Set wholesale (toggleSection
// builds a fresh Set), avoiding the deep-proxy that ref() would create.
const collapsedSections = shallowRef<Set<SkillSectionKey>>(loadCollapsedSections());

// Active skills, alphabetised. Provenance (system / project / user) is
// shown as a per-row badge via sourceMeta, not as its own collapsible
// group — the sidebar groups by section, not by provenance.
const activeSkills = computed(() => [...skills.value].sort((leftSkill, rightSkill) => leftSkill.name.localeCompare(rightSkill.name)));

function isSectionOpen(key: SkillSectionKey): boolean {
  return !collapsedSections.value.has(key);
}

function toggleSection(key: SkillSectionKey): void {
  const next = toggleInSet(collapsedSections.value, key);
  collapsedSections.value = next;
  persistCollapsedSections(next);
}

const selectedName = ref<string | null>(pickInitialSelection(activeSkills.value, collapsedSections.value));
const detail = ref<SkillDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const deleting = ref(false);
const editing = ref(false);
const saving = ref(false);
const editDescription = ref("");
const editBody = ref("");

const selected = computed(() => skills.value.find((skill) => skill.name === selectedName.value) ?? null);

const { markdownRef: skillMarkdownRef, renderedBody } = useSkillMarkdown(() => detail.value?.body);

// Edit/Delete follows the backend writer contract (writer.ts rejects
// only source === "user"), NOT the mc- name heuristic. Under #1335
// PR-A the launcher syncs presets to data/skills/catalog/preset/ and
// leaves .claude/skills/ untouched, so a ★-starred mc- preset is a
// normal project-scope skill — gating it read-only by name would make
// activation one-way (no un-star / edit from /skills). The mc- =
// "system" classification survives only as the provenance badge.
const isSelectedEditable = computed(() => detail.value?.source === "project");

const listError = ref<string | null>(null);

const endpoints = pluginEndpoints<SkillsEndpoints>("skills");

async function refreshActiveList(): Promise<void> {
  // Mirrors the onMounted fetch so the left-column list reflects a
  // newly-starred skill without waiting for the next manageSkills tool
  // result. Errors here are non-fatal — the catalog state is the source
  // of truth for the "Starred" badge.
  const response = await apiGet<{ skills: SkillSummary[] }>(endpoints.list.url);
  if (response.ok && Array.isArray(response.data.skills)) {
    skills.value = response.data.skills;
  }
}

// Active and catalog selections are mutually exclusive — selecting a
// catalog row clears the active selection (and vice versa) so the right
// pane has a single source of truth.
function clearActiveSelection(): void {
  selectedName.value = null;
}

// Preset-catalog cluster (#1335 PR-B): browse / select / ★ Star / preview.
const catalog = useSkillCatalog({ refreshActiveList, clearActiveSelection });
const {
  catalogPresets,
  catalogExternal,
  catalogError,
  selectedCatalog,
  catalogDetail,
  catalogDetailLoading,
  catalogActioningKey,
  selectedCatalogKey,
  loadCatalog,
  selectCatalogEntry,
  starCatalogEntry,
} = catalog;

// True when the selected active skill has a matching entry in the preset
// catalog — meaning a "delete" from `.claude/skills/<slug>/` is
// recoverable (the launcher re-syncs the catalog copy on every boot). We
// expose this case as "Unstar" with a non-destructive confirm; the DELETE
// endpoint is identical. Catalog membership (not the `mc-` slug prefix) is
// the authoritative signal — see isPresetActivation tests.
const isSelectedPreset = computed(() => isPresetActivation(detail.value?.name, catalogPresets.value));

// External-repo cluster (#1383 PR-C2): installed repos + add-repo modal.
const repos = useExternalRepos({
  catalogExternal,
  catalogError,
  reloadCatalog: loadCatalog,
  refreshActiveList,
  clearCatalogSelectionForRepo: catalog.clearSelectionIfRepo,
});
const {
  externalGroups,
  isRepoOpen,
  toggleRepo,
  addRepoOpen,
  addRepoUrl,
  addRepoSubpath,
  addRepoError,
  addRepoBusy,
  suggestions,
  selectedSuggestionUrl,
  uninstallingRepoId,
  updatingRepoId,
  loadExternalRepos,
  openAddRepo,
  selectSuggestion,
  installRepo,
  uninstallRepo,
  updateRepo,
} = repos;

// Visual key for the provenance badge on every active row + the
// preset rows. Provenance is derived via categorizeSkill (NOT the raw
// `source`, which can't express "system") so the badge stays
// consistent with sectionLegend and the edit gate:
//   - system  `mc-` bundled, read-only      — launcher-owned
//   - project `<workspace>/.claude/skills/` — this workspace only
//   - user    `~/.claude/skills/`           — global across workspaces
//   - preset  catalog (not yet ★ Starred)   — launcher-managed
// Icons + colours are deliberately monochromatic except for the
// preset case where we hint "library / shelf" with the inventory
// glyph. The yellow ★ for "starred" is rendered separately so the
// scope badge stays semantically about provenance, not state.
//
// Thin view wrapper: the pure skillBadgeMeta returns an i18n title KEY;
// resolve it here through the live t() so the template keeps its
// { icon, title, colour } contract.
function skillBadge(skill: SkillSummary): SourceMeta {
  const meta = skillBadgeMeta(skill);
  return { icon: meta.icon, colour: meta.colour, title: t(meta.titleKey) };
}

const presetSourceMeta = computed<SourceMeta>(() => ({
  icon: PRESET_SOURCE_META.icon,
  colour: PRESET_SOURCE_META.colour,
  title: t(PRESET_SOURCE_META.titleKey),
}));

function selectActiveSkill(name: string): void {
  catalog.clearSelection();
  selectedName.value = name;
}

// Reset the selection when the tool result is replaced (e.g. the user
// opens a newer `manageSkills` invocation from the sidebar).
watch(
  () => props.selectedResult?.uuid,
  () => {
    skills.value = [...(props.selectedResult?.data?.skills ?? [])];
    selectedName.value = pickInitialSelection(activeSkills.value, collapsedSections.value);
    catalog.reset();
    repos.resetModalState();
  },
);

// Standalone mode: if no selectedResult was passed, fetch the skill
// list from the API on mount so the view is populated.
onMounted(async () => {
  // Always load the catalog so the section appears even when the
  // view was opened from a tool result (which only carries the
  // active list). External repos load in parallel — failure of one
  // doesn't block the other (each sets its own inline error).
  await Promise.all([loadCatalog(), loadExternalRepos()]);
  if (props.selectedResult || skills.value.length > 0) return;
  const response = await apiGet<{ skills: SkillSummary[] }>(endpoints.list.url);
  if (!response.ok) {
    listError.value = t("pluginManageSkills.errListFailed", { error: response.error });
    return;
  }
  if (Array.isArray(response.data.skills)) {
    skills.value = response.data.skills;
    selectedName.value = pickInitialSelection(activeSkills.value, collapsedSections.value);
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
    const response = await apiGet<{ skill: SkillDetail }>(buildRouteUrl(endpoints.detail, { name }));
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
  const result = await apiPut<{ updated: boolean; path: string }>(buildRouteUrl(endpoints.update, { name }), {
    description: editDescription.value,
    body: editBody.value,
  });
  saving.value = false;
  if (!result.ok) {
    detailError.value = t("pluginManageSkills.errSaveFailed", { error: result.error });
    return;
  }
  // The sidebar summary keys off the captured `name`, so it stays correct
  // even if the selection changed mid-save.
  skills.value = updateSkillDescription(skills.value, name, editDescription.value);
  // But `detail.value` may now describe a different skill (the user clicked
  // away while the PUT was in flight) — only patch it when it is still ours,
  // or we would graft skill A's edits onto skill B's pane.
  if (detail.value?.name === name) {
    detail.value = {
      ...detail.value,
      description: editDescription.value,
      body: editBody.value,
    };
    editing.value = false;
  }
}

// Delete is project-scope only — see saveProjectSkill / deleteProjectSkill
// in server/skills/writer.ts. The button is hidden in the template
// when source !== "project". A native confirm() is enough for phase 1
// since the action is reversible by re-saving via the conversation.
// For preset (mc-*) entries the same endpoint is invoked, but the
// confirm copy reflects that the catalog copy survives — see
// `isSelectedPreset` above and `syncPresetSkills` in skills-preset.ts.
async function deleteSkill(): Promise<void> {
  if (!detail.value || detail.value.source !== "project") return;
  const { name } = detail.value;
  const confirmKey = isSelectedPreset.value ? "pluginManageSkills.confirmUnstar" : "pluginManageSkills.confirmDelete";
  if (!window.confirm(t(confirmKey, { name }))) {
    return;
  }
  deleting.value = true;
  const result = await apiDelete<unknown>(buildRouteUrl(endpoints.remove, { name }));
  deleting.value = false;
  if (!result.ok) {
    detailError.value = result.error || t("pluginManageSkills.errDeleteFailed");
    return;
  }
  // Remove from the local list, advance selection, clear detail.
  skills.value = removeSkillByName(skills.value, name);
  selectedName.value = pickInitialSelection(activeSkills.value, collapsedSections.value);
  detail.value = null;
  // Refresh the catalog so a deleted star reverts to ☆ Star.
  // `alreadyActive` is computed from disk at list time — without
  // this call the badge + right-pane state would lag until the
  // next mount. (#1335 PR-B2 follow-up.)
  await loadCatalog();
  catalog.reconcileAfterDelete(name);
}
</script>
