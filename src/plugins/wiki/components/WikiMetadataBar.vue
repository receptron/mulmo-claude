<template>
  <div
    data-testid="wiki-page-metadata-bar"
    class="shrink-0 border-b border-gray-100 px-6 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500"
  >
    <span v-if="meta.created" data-testid="wiki-page-metadata-created">
      <span class="text-gray-400">{{ $t("pluginWiki.metadataCreated") }}:</span>
      {{ meta.created }}
    </span>
    <span v-if="meta.updated" data-testid="wiki-page-metadata-updated">
      <span class="text-gray-400">{{ $t("pluginWiki.metadataUpdated") }}:</span>
      {{ formatUpdated(meta.updated) }}
    </span>
    <span v-if="meta.editor" data-testid="wiki-page-metadata-editor">
      <span class="text-gray-400">{{ $t("pluginWiki.metadataEditor") }}:</span>
      {{ meta.editor }}
    </span>
    <span v-if="meta.tags.length > 0" class="flex flex-wrap gap-1" data-testid="wiki-page-metadata-tags">
      <button v-for="tag in meta.tags" :key="tag" class="entry-tag-chip" :data-testid="`wiki-page-metadata-tag-${tag}`" @click="emit('tagClick', tag)">
        {{ `#${tag}` }}
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
import { formatUpdated } from "../helpers";

export interface WikiPageMeta {
  created: string | null;
  updated: string | null;
  editor: string | null;
  tags: string[];
}

defineProps<{ meta: WikiPageMeta }>();

const emit = defineEmits<{ tagClick: [tag: string] }>();
</script>

<style scoped>
/* Mirrors `.entry-tag-chip` in View.vue's scoped block — the index-list
   per-entry chips keep their copy there. Scoped CSS can't cross the component
   boundary, so the metadata-bar chips carry the rule locally. */
.entry-tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 0.375rem;
  font-size: 0.7rem;
  line-height: 1rem;
  border-radius: 9999px;
  background-color: #f3f4f6;
  color: #4b5563;
  border: 1px solid transparent;
  cursor: pointer;
}
.entry-tag-chip:hover {
  background-color: #dbeafe;
  color: #1d4ed8;
}
</style>
