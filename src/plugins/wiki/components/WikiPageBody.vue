<template>
  <!-- eslint-disable-next-line vue/no-v-html -- marked.parse output of app-owned wiki page body; trusted in-process render -->
  <div ref="rootRef" data-testid="wiki-page-body" class="px-6 py-4 prose prose-sm max-w-none wiki-content" @click="onClick" v-html="renderedHtml" />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { renderWikiPageHtml } from "../helpers";
import { handleExternalLinkClick } from "../../../utils/dom/externalLink";
import { classifyWorkspacePath, resolveWikiHref } from "../../../utils/path/workspaceLinkRouter";

const props = defineProps<{
  body: string;
  baseDir: string;
}>();

const emit = defineEmits<{
  taskCheckboxClick: [event: MouseEvent, target: HTMLInputElement];
  wikiLinkClick: [slug: string];
  workspaceLinkClick: [path: string];
}>();

const rootRef = ref<HTMLElement | null>(null);

const renderedHtml = computed(() => renderWikiPageHtml(props.body, props.baseDir));

defineExpose({ rootRef });

function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.type === "checkbox" && target.classList.contains("md-task")) {
    emit("taskCheckboxClick", event, target);
    return;
  }
  const link = target.closest(".wiki-link") as HTMLElement | null;
  if (link?.dataset.page) {
    emit("wikiLinkClick", link.dataset.page);
    return;
  }
  if (handleExternalLinkClick(event)) return;
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const anchor = target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return;
  const resolved = resolveWikiHref(href, props.baseDir);
  if (classifyWorkspacePath(resolved)) {
    event.preventDefault();
    emit("workspaceLinkClick", resolved);
  }
}
</script>

<style scoped>
.wiki-content :deep(.wiki-link) {
  color: #2563eb;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
}
.wiki-content :deep(.wiki-link:hover) {
  text-decoration-style: solid;
}
.wiki-content :deep(h1) {
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  color: #111827;
}
.wiki-content :deep(h1:first-child),
.wiki-content :deep(h2:first-child),
.wiki-content :deep(h3:first-child),
.wiki-content :deep(p:first-child) {
  margin-top: 0;
}
.wiki-content :deep(h2) {
  font-size: 1.2rem;
  font-weight: 600;
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  color: #1f2937;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.25rem;
}
.wiki-content :deep(h3) {
  font-size: 1rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  color: #374151;
}
.wiki-content :deep(p) {
  margin-bottom: 0.75rem;
  line-height: 1.6;
  color: #374151;
}
.wiki-content :deep(ul),
.wiki-content :deep(ol) {
  margin-left: 1.5rem;
  margin-bottom: 0.75rem;
}
.wiki-content :deep(li) {
  margin-bottom: 0.25rem;
  line-height: 1.5;
  color: #374151;
}
.wiki-content :deep(ul) {
  list-style-type: disc;
}
.wiki-content :deep(ol) {
  list-style-type: decimal;
}
.wiki-content :deep(hr) {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 1rem 0;
}
.wiki-content :deep(code) {
  background: #f3f4f6;
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
  font-family: monospace;
}
.wiki-content :deep(pre) {
  background: #f3f4f6;
  padding: 0.75rem;
  border-radius: 0.375rem;
  overflow-x: auto;
  margin-bottom: 0.75rem;
}
.wiki-content :deep(pre code) {
  background: none;
  padding: 0;
}
.wiki-content :deep(blockquote) {
  border-left: 3px solid #d1d5db;
  padding-left: 1rem;
  color: #6b7280;
  margin: 0.75rem 0;
}
.wiki-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
}
.wiki-content :deep(th),
.wiki-content :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 0.5rem 0.75rem;
  text-align: left;
}
.wiki-content :deep(th) {
  background: #f9fafb;
  font-weight: 600;
}
</style>
