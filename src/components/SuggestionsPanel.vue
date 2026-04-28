<template>
  <div v-if="expanded" ref="panelRef" class="border-t border-gray-200 flex flex-col">
    <div ref="listRef" class="px-4 pt-2 pb-2 max-h-64 overflow-y-auto flex flex-col gap-1">
      <template v-if="activeTab === 'suggestions'">
        <button
          v-for="query in queries"
          :key="query"
          class="text-left text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded px-3 py-1.5 border border-gray-300 transition-colors"
          @click="onSuggestionClick($event, query)"
        >
          {{ query }}
        </button>
        <p v-if="queries.length === 0" class="text-center text-xs text-gray-400 italic py-2">{{ t("suggestionsPanel.emptySuggestions") }}</p>
      </template>
      <template v-else>
        <p v-if="skillsError" class="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5" data-testid="suggestions-skills-error">
          {{ t("suggestionsPanel.skillsError", { error: skillsError }) }}
        </p>
        <button
          v-for="skill in skills"
          :key="skill.name"
          class="text-left text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded px-3 py-1.5 border border-gray-300 transition-colors"
          @click="onSkillClick($event, skill)"
        >
          /{{ skill.name }}
        </button>
        <p v-if="!skillsError && skills.length === 0" class="text-center text-xs text-gray-400 italic py-2">
          {{ t("suggestionsPanel.emptySkills") }}
        </p>
      </template>
    </div>
    <p class="text-center text-[10px] text-gray-400 py-0.5">{{ t("suggestionsPanel.sendEditHint") }}</p>
    <div class="flex border-t border-gray-200 bg-gray-50">
      <button
        class="flex-1 py-1.5 text-xs transition-colors"
        :class="activeTab === 'suggestions' ? 'text-blue-600 font-medium bg-white border-t-2 border-blue-600 -mt-px' : 'text-gray-500 hover:text-gray-700'"
        data-testid="suggestions-tab-suggestions"
        @click="setActiveTab('suggestions')"
      >
        {{ t("suggestionsPanel.suggestions") }}
      </button>
      <button
        class="flex-1 py-1.5 text-xs transition-colors"
        :class="activeTab === 'skills' ? 'text-blue-600 font-medium bg-white border-t-2 border-blue-600 -mt-px' : 'text-gray-500 hover:text-gray-700'"
        data-testid="suggestions-tab-skills"
        @click="setActiveTab('skills')"
      >
        {{ t("suggestionsPanel.skills") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSkillsList, type SkillSummary } from "../composables/useSkillsList";
import { useClickOutside } from "../composables/useClickOutside";

const { t } = useI18n();

type TabId = "suggestions" | "skills";
const TAB_STORAGE_KEY = "suggestionsPanel.activeTab";

const props = defineProps<{
  queries: string[];
  expanded: boolean;
  triggerRef?: HTMLElement | null;
}>();

const emit = defineEmits<{
  "update:expanded": [value: boolean];
  send: [query: string];
  edit: [query: string];
}>();

const { skills, error: skillsError, refresh: refreshSkills } = useSkillsList();

const listRef = ref<HTMLDivElement | null>(null);
const panelRef = ref<HTMLDivElement | null>(null);

const expandedRef = computed({
  get: () => props.expanded,
  set: (value: boolean) => emit("update:expanded", value),
});
const triggerElRef = computed(() => props.triggerRef ?? null);

const { handler: onDocumentMousedown } = useClickOutside({
  isOpen: expandedRef,
  buttonRef: triggerElRef,
  popupRef: panelRef,
});

onMounted(() => document.addEventListener("mousedown", onDocumentMousedown));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocumentMousedown));

function readStoredTab(): TabId {
  const raw = localStorage.getItem(TAB_STORAGE_KEY);
  return raw === "skills" ? "skills" : "suggestions";
}

const activeTab = ref<TabId>(readStoredTab());

function setActiveTab(tab: TabId): void {
  activeTab.value = tab;
  localStorage.setItem(TAB_STORAGE_KEY, tab);
  nextTick(() => scrollToBottom());
}

function scrollToBottom(): void {
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight;
  }
}

watch(
  () => props.expanded,
  (isExpanded) => {
    if (!isExpanded) return;
    void refreshSkills();
    nextTick(() => scrollToBottom());
  },
);

function onSuggestionClick(event: MouseEvent, query: string): void {
  emit("update:expanded", false);
  if (event.shiftKey) {
    emit("edit", query);
    return;
  }
  emit("send", query);
}

function onSkillClick(event: MouseEvent, skill: SkillSummary): void {
  emit("update:expanded", false);
  const command = `/${skill.name}`;
  if (event.shiftKey) {
    emit("edit", command);
    return;
  }
  emit("send", command);
}
</script>
