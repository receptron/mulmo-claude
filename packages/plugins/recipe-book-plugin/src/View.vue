<script setup lang="ts">
// Recipe-book plugin View — renders inside the host's canvas via the
// runtime plugin loader. Two-pane layout: list on the left, detail
// (rendered markdown) on the right. Subscribes to the plugin's
// "changed" channel so multi-tab views stay in sync.

import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { z } from "zod";
import { useT, format } from "./lang";
import ConfirmModal from "../../shared/components/ConfirmModal.vue";
import { useConfirm } from "../../shared/components/confirm";

const { openConfirm } = useConfirm();

const RecipeSummary = z.object({
  slug: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  servings: z.number().nullable(),
  updated: z.string(),
});
type RecipeSummary = z.infer<typeof RecipeSummary>;

const RecipeDetail = RecipeSummary.extend({
  prepTime: z.number().nullable(),
  cookTime: z.number().nullable(),
  created: z.string(),
  body: z.string(),
});
type RecipeDetail = z.infer<typeof RecipeDetail>;

// `dispatch` returns `unknown` unless given a reader (protocol 2.0.0).
// Naming the type at the call site was an assertion in disguise — nothing
// on this side had seen the response. These readers are what make the
// fields below real rather than claimed.
const ListResult = z.object({ ok: z.boolean(), recipes: z.array(RecipeSummary).optional() });
const ReadResult = z.object({ ok: z.boolean(), recipe: RecipeDetail.optional(), error: z.string().optional() });

// Tool-result shape the host hands us. After list / save / update we
// get a `recipes[]`; after delete we get just `{ ok, slug }`. The
// View always re-fetches via dispatch on mount so the pane stays
// current regardless of which action triggered it.
export interface Props {
  selectedResult: { recipes?: RecipeSummary[]; recipe?: RecipeSummary };
}
const props = defineProps<Props>();

const { pubsub, dispatch, log } = useRuntime();
const t = useT();

const recipes = ref<RecipeSummary[]>(props.selectedResult.recipes ?? []);
const selectedSlug = ref<string | null>(recipes.value[0]?.slug ?? null);
const detail = ref<RecipeDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const deleting = ref(false);

const selected = computed(() => recipes.value.find((recipe) => recipe.slug === selectedSlug.value) ?? null);

const renderedBody = computed(() => {
  const body = detail.value?.body;
  if (!body) return "";
  return renderMarkdownLite(body);
});

// Mirror new tool results (e.g. after the LLM saves a new recipe).
watch(
  () => props.selectedResult.recipes,
  (next) => {
    if (next) {
      recipes.value = next;
      if (!selectedSlug.value || !next.find((recipe) => recipe.slug === selectedSlug.value)) {
        selectedSlug.value = next[0]?.slug ?? null;
      }
    }
  },
);

async function refetchList(): Promise<void> {
  try {
    const json = await dispatch({ kind: "list" }, (raw) => ListResult.parse(raw));
    if (json.ok && json.recipes) {
      recipes.value = json.recipes;
      if (!selectedSlug.value || !json.recipes.find((recipe) => recipe.slug === selectedSlug.value)) {
        selectedSlug.value = json.recipes[0]?.slug ?? null;
      }
    }
  } catch (err) {
    log.warn("refetchList failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

watch(
  selectedSlug,
  async (slug) => {
    if (!slug) {
      detail.value = null;
      return;
    }
    detailLoading.value = true;
    detailError.value = null;
    try {
      const result = await dispatch({ kind: "read", slug }, (raw) => ReadResult.parse(raw));
      if (selectedSlug.value !== slug) return;
      if (result.ok && result.recipe) {
        detail.value = result.recipe;
      } else {
        detailError.value = result.error ?? `recipe not found: ${slug}`;
        detail.value = null;
      }
    } catch (err) {
      if (selectedSlug.value !== slug) return;
      detailError.value = err instanceof Error ? err.message : String(err);
      detail.value = null;
    }
    if (selectedSlug.value === slug) detailLoading.value = false;
  },
  { immediate: true },
);

async function deleteRecipe(): Promise<void> {
  if (!detail.value) return;
  const { slug, title } = detail.value;
  if (
    !(await openConfirm({
      title: t.value.delete || "Delete",
      message: format(t.value.confirmDelete, { title }),
      confirmText: t.value.delete || "Delete",
      variant: "danger",
    }))
  )
    return;
  deleting.value = true;
  try {
    await dispatch({ kind: "delete", slug });
  } catch (err) {
    log.warn("delete failed", { slug, error: err instanceof Error ? err.message : String(err) });
  }
  deleting.value = false;
  // The "changed" pubsub event will trigger refetchList, which removes
  // the deleted slug from the list and advances the selection.
}

const unsubs: Array<() => void> = [];
onMounted(() => {
  unsubs.push(pubsub.subscribe("changed", () => void refetchList()));
  void refetchList();
});
onUnmounted(() => {
  for (const unsub of unsubs) unsub();
});

// Tiny markdown subset: headings, paragraphs, bullet / numbered
// lists, **bold**, *em*. Avoids pulling in a markdown library to
// keep the plugin bundle small. Anything else renders as plain text.
function renderMarkdownLite(input: string): string {
  const escaped = input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let buffer: string[] = [];
  const flushPara = (): void => {
    if (buffer.length === 0) return;
    out.push(`<p>${buffer.join(" ")}</p>`);
    buffer = [];
  };
  const closeLists = (): void => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };
  for (const line of lines) {
    const [, hashes, headingText] = line.match(/^(#{1,6})\s+(.+)$/) ?? [];
    if (hashes !== undefined && headingText !== undefined) {
      flushPara();
      closeLists();
      const level = hashes.length;
      out.push(`<h${level}>${formatInline(headingText)}</h${level}>`);
      continue;
    }
    const [, ulItem] = line.match(/^[-*]\s+(.+)$/) ?? [];
    if (ulItem !== undefined) {
      flushPara();
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${formatInline(ulItem)}</li>`);
      continue;
    }
    const [, olItem] = line.match(/^\d+\.\s+(.+)$/) ?? [];
    if (olItem !== undefined) {
      flushPara();
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${formatInline(olItem)}</li>`);
      continue;
    }
    if (line.trim().length === 0) {
      flushPara();
      closeLists();
      continue;
    }
    buffer.push(formatInline(line));
  }
  flushPara();
  closeLists();
  return out.join("\n");
}

function formatInline(input: string): string {
  return input.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
</script>

<template>
  <div class="recipes-view">
    <header class="recipes-header">
      <h2 class="recipes-title">
        {{ t.title }} <span class="recipes-count">({{ recipes.length }} {{ t.countSuffix }})</span>
      </h2>
    </header>

    <div class="recipes-body">
      <ul class="recipes-list" :aria-label="t.title">
        <li v-for="recipe in recipes" :key="recipe.slug">
          <button
            type="button"
            class="recipes-list-row"
            :class="{ 'is-active': selectedSlug === recipe.slug }"
            :aria-current="selectedSlug === recipe.slug ? 'true' : undefined"
            @click="selectedSlug = recipe.slug"
          >
            <span class="recipes-list-title">{{ recipe.title }}</span>
            <span v-if="recipe.tags.length > 0" class="recipes-list-tags">{{ recipe.tags.join(" · ") }}</span>
            <span v-if="recipe.servings !== null" class="recipes-list-servings">{{ format(t.servingsLabel, { count: recipe.servings }) }}</span>
          </button>
        </li>
        <li v-if="recipes.length === 0" class="recipes-empty">{{ t.empty }}</li>
      </ul>

      <section class="recipes-detail">
        <p v-if="!selected" class="recipes-detail-hint">{{ t.selectHint }}</p>
        <template v-else>
          <div class="recipes-detail-head">
            <div class="recipes-detail-meta">
              <h3 class="recipes-detail-title">{{ selected.title }}</h3>
              <div class="recipes-detail-chips">
                <span v-if="detail && detail.servings !== null">{{ format(t.servingsLabel, { count: detail.servings }) }}</span>
                <span v-if="detail && detail.prepTime !== null">{{ format(t.prepLabel, { mins: detail.prepTime }) }}</span>
                <span v-if="detail && detail.cookTime !== null">{{ format(t.cookLabel, { mins: detail.cookTime }) }}</span>
              </div>
              <div v-if="detail && detail.tags.length > 0" class="recipes-detail-tags">
                <span v-for="tag in detail.tags" :key="tag" class="recipes-detail-tag">{{ tag }}</span>
              </div>
            </div>
            <div class="recipes-detail-actions">
              <button type="button" class="recipes-delete" :disabled="detailLoading || deleting" @click="deleteRecipe">{{ t.delete }}</button>
            </div>
          </div>
          <p v-if="detailError" class="recipes-detail-error">{{ detailError }}</p>
          <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdownLite escapes raw input first, so the HTML never carries user-provided unescaped markup -->
          <div v-else-if="detail && renderedBody" class="recipes-detail-body" v-html="renderedBody"></div>
          <p v-else class="recipes-detail-empty">{{ t.emptyBody }}</p>
        </template>
      </section>
    </div>
    <ConfirmModal />
  </div>
</template>

<style scoped>
.recipes-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  background: white;
}
.recipes-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e5e7eb;
}
.recipes-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}
.recipes-count {
  color: #6b7280;
  font-weight: 400;
  font-size: 0.875rem;
  margin-left: 0.5rem;
}
.recipes-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.recipes-list {
  flex: 0 0 16rem;
  list-style: none;
  margin: 0;
  padding: 0;
  border-right: 1px solid #f3f4f6;
  overflow-y: auto;
  background: #fafafa;
}
.recipes-list-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.625rem 1rem;
  border: none;
  border-bottom: 1px solid #f3f4f6;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.recipes-list-row:hover {
  background: white;
}
.recipes-list-row:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: -2px;
}
.recipes-list-row.is-active {
  background: white;
  box-shadow: inset 2px 0 0 0 #3b82f6;
}
.recipes-list-title {
  font-weight: 500;
  color: #1f2937;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.recipes-list-tags,
.recipes-list-servings {
  font-size: 0.75rem;
  color: #6b7280;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.recipes-empty {
  padding: 1rem;
  font-size: 0.875rem;
  color: #9ca3af;
  font-style: italic;
}
.recipes-detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 1.5rem;
}
.recipes-detail-hint {
  color: #9ca3af;
  font-style: italic;
  font-size: 0.875rem;
}
.recipes-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.recipes-detail-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
  color: #1f2937;
}
.recipes-detail-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: #6b7280;
}
.recipes-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.5rem;
}
.recipes-detail-tag {
  font-size: 0.6875rem;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  background: #f3f4f6;
  color: #4b5563;
}
.recipes-detail-actions {
  flex-shrink: 0;
}
.recipes-delete {
  font-size: 0.875rem;
  padding: 0.375rem 0.75rem;
  border: 1px solid #fca5a5;
  background: white;
  color: #dc2626;
  border-radius: 0.25rem;
  cursor: pointer;
}
.recipes-delete:hover:not(:disabled) {
  background: #fef2f2;
}
.recipes-delete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.recipes-detail-error {
  color: #dc2626;
  font-size: 0.875rem;
}
.recipes-detail-body {
  color: #374151;
  line-height: 1.6;
}
.recipes-detail-body :deep(h2) {
  font-size: 1.0625rem;
  font-weight: 600;
  margin: 1.25rem 0 0.5rem;
  color: #1f2937;
}
.recipes-detail-body :deep(h3) {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 1rem 0 0.5rem;
  color: #1f2937;
}
.recipes-detail-body :deep(ul),
.recipes-detail-body :deep(ol) {
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}
.recipes-detail-body :deep(li) {
  margin: 0.25rem 0;
}
.recipes-detail-body :deep(p) {
  margin: 0.5rem 0;
}
.recipes-detail-empty {
  color: #9ca3af;
  font-style: italic;
}
</style>
