<template>
  <!-- Catalog (preset / external) detail. Selecting a row from the
       "Preset catalog" section in the left column routes here. Shows
       description + body + Star actions. (#1335 PR-B2 follow-up —
       replaces the inline buttons and the Preview modal with a single
       right-pane that mirrors the active-skill view.) -->
  <div class="p-6" data-testid="skill-catalog-detail-pane">
    <div class="flex items-start justify-between gap-4 mb-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="material-icons text-sm" :class="sourceMeta.colour" :title="sourceMeta.title" aria-hidden="true">{{ sourceMeta.icon }}</span>
          <h3 class="text-xl font-semibold text-gray-800 truncate">{{ entry.name }}</h3>
        </div>
        <p class="text-sm text-gray-600 mt-1">{{ entry.description }}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          v-if="!entry.alreadyActive"
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-yellow-400 text-yellow-600 hover:bg-yellow-50 disabled:opacity-40"
          :disabled="actioningKey !== null"
          :title="t('pluginManageSkills.catalogStar')"
          data-testid="skill-catalog-detail-star-btn"
          @click="emit('star', entry)"
        >
          <span class="material-icons text-sm" aria-hidden="true">star_border</span>
          {{ t("pluginManageSkills.catalogStar") }}
        </button>
        <button
          v-else
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded text-yellow-500 cursor-not-allowed"
          :title="t('pluginManageSkills.catalogStarred')"
          data-testid="skill-catalog-detail-starred"
          disabled
        >
          <span class="material-icons text-sm" aria-hidden="true">star</span>
          {{ t("pluginManageSkills.catalogStarred") }}
        </button>
      </div>
    </div>
    <div v-if="loading" class="text-sm text-gray-400 italic">{{ t("pluginManageSkills.loading") }}</div>
    <div v-else-if="error" class="text-sm text-red-600">{{ error }}</div>
    <!-- eslint-disable vue/no-v-html -- markdown sanitized via sanitizeMarkdownHtml; same trust chain as the active-skill body in View.vue -->
    <div v-else-if="detail" ref="markdownRef" class="markdown-content text-gray-700" @click="handleExternalLinkClick" v-html="renderedBody"></div>
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { handleExternalLinkClick } from "@mulmoclaude/markdown-utils/dom/externalLink";
import type { SourceMeta } from "./categories";
import type { CatalogDetail, CatalogEntry } from "./useSkillCatalog";
import { useSkillMarkdown } from "./useSkillMarkdown";

const { t } = useI18n();

const props = defineProps<{
  entry: CatalogEntry;
  sourceMeta: SourceMeta;
  actioningKey: string | null;
  loading: boolean;
  error: string | null;
  detail: CatalogDetail | null;
}>();

const emit = defineEmits<{
  star: [entry: CatalogEntry];
}>();

// The pane owns rendering its own body: the markdown ref must sit on the
// v-html element that lives here, so mermaid post-processing can reach it.
const { markdownRef, renderedBody } = useSkillMarkdown(() => props.detail?.body);
</script>
