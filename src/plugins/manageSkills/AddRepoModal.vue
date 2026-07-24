<template>
  <!-- Add-repo modal (#1383 PR-C2). URL (+ optional subpath) or a
       one-click seed suggestion. Backend error kinds (invalid-url /
       invalid-subpath / id-collision / no-skills / 502) surface
       inline. -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="skill-add-repo-modal" @click.self="emit('close')">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
      <h3 class="text-base font-semibold text-gray-800 mb-3">{{ t("pluginManageSkills.catalogAddRepoTitle") }}</h3>
      <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageSkills.catalogRepoUrlLabel") }}</label>
      <input
        v-model="url"
        type="text"
        data-testid="skill-add-repo-url"
        class="w-full h-8 px-2 mb-3 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        :placeholder="t('pluginManageSkills.catalogRepoUrlPlaceholder')"
        @keydown.enter="emit('install')"
      />
      <label class="block text-xs font-medium text-gray-600 mb-1">{{ t("pluginManageSkills.catalogRepoSubpathLabel") }}</label>
      <input
        v-model="subpath"
        type="text"
        data-testid="skill-add-repo-subpath"
        class="w-full h-8 px-2 mb-3 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        :placeholder="t('pluginManageSkills.catalogRepoSubpathPlaceholder')"
        @keydown.enter="emit('install')"
      />
      <p v-if="error" class="text-xs text-red-600 mb-3" data-testid="skill-add-repo-error">{{ error }}</p>
      <div class="flex items-center justify-end gap-2 mb-4">
        <button type="button" class="h-8 px-2.5 flex items-center text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" @click="emit('close')">
          {{ t("common.cancel") }}
        </button>
        <button
          type="button"
          data-testid="skill-add-repo-submit"
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
          :disabled="busy"
          @click="emit('install')"
        >
          {{ busy ? t("pluginManageSkills.catalogRepoInstalling") : t("pluginManageSkills.catalogAddRepoSubmit") }}
        </button>
      </div>
      <div v-if="suggestions.length > 0">
        <p class="text-xs font-medium text-gray-600 mb-2">{{ t("pluginManageSkills.catalogAddRepoSuggestions") }}</p>
        <div
          v-for="suggestion in suggestions"
          :key="suggestion.url"
          class="mb-1 rounded border"
          :class="selectedSuggestionUrl === suggestion.url ? 'border-blue-400 bg-blue-50' : 'border-gray-200'"
        >
          <div class="flex items-start">
            <button
              type="button"
              :data-testid="`skill-add-repo-suggestion-${suggestion.url}`"
              class="flex-1 min-w-0 text-left px-3 py-2 text-sm"
              :aria-pressed="selectedSuggestionUrl === suggestion.url"
              @click="emit('select-suggestion', suggestion)"
            >
              <div class="font-medium text-gray-700">{{ suggestion.displayName }}</div>
              <div class="text-xs text-gray-500" :class="selectedSuggestionUrl === suggestion.url ? 'whitespace-normal break-words' : 'truncate'">
                {{ suggestion.description }}
              </div>
            </button>
            <a
              :href="suggestion.url"
              target="_blank"
              rel="noopener noreferrer"
              :data-testid="`skill-add-repo-suggestion-link-${suggestion.url}`"
              class="h-8 w-8 shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-blue-600"
              :title="t('pluginManageSkills.catalogRepoOpenLink')"
              :aria-label="t('pluginManageSkills.catalogRepoOpenLink')"
              @click.stop
            >
              <span class="material-icons text-sm" aria-hidden="true">open_in_new</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ExternalSuggestion } from "./useExternalRepos";

const { t } = useI18n();

const url = defineModel<string>("url", { required: true });
const subpath = defineModel<string>("subpath", { required: true });

defineProps<{
  error: string | null;
  busy: boolean;
  suggestions: ExternalSuggestion[];
  selectedSuggestionUrl: string | null;
}>();

const emit = defineEmits<{
  close: [];
  install: [];
  "select-suggestion": [suggestion: ExternalSuggestion];
}>();
</script>
