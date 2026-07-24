// Runtime translation of the collection starter cards (title / description /
// prompt) into the active locale, via the host's injected `translate` transport
// and the host-agnostic cache in `@mulmoclaude/core/translation/client`. The
// host's role-query chips use the same mechanism; here it's plugin-side because
// the modal lives in the package. Falls back to the English source while the
// request is in flight, on `en`, or when the host hasn't wired `translate`.

import { computed, ref, watchEffect, type ComputedRef, type Ref } from "vue";
import { createTranslationCache, loadTranslated } from "@mulmoclaude/core/translation/client";
import { collectionUi } from "./uiContext";
import { COLLECTION_STARTERS, type CollectionStarter } from "./starters";

const NAMESPACE = "collection-starters";

// One flat sentence list — [title, description, prompt] per starter, in order —
// so a single batch request translates every card face and prompt at once.
const SOURCES: readonly string[] = COLLECTION_STARTERS.flatMap((starter) => [starter.title, starter.description, starter.prompt]);
const FIELDS_PER_STARTER = 3;

// Lazy through `collectionUi()` so the binding is resolved at fetch time (after
// the host configures it), and `null` when no transport is wired → English.
const cache = createTranslationCache((req) => collectionUi().translate?.(req) ?? Promise.resolve(null));

/** Pure projection: map a flat [title, description, prompt, …] batch back onto the
 *  starters, field by field. `null` batch (en / in flight / failed) → English source. */
export function applyStarterTranslations(starters: readonly CollectionStarter[], batch: readonly string[] | null): CollectionStarter[] {
  if (batch === null) return [...starters];
  return starters.map((starter, index) => {
    const base = index * FIELDS_PER_STARTER;
    return {
      ...starter,
      title: batch[base] ?? starter.title,
      description: batch[base + 1] ?? starter.description,
      prompt: batch[base + 2] ?? starter.prompt,
    };
  });
}

/** The starters with `title` / `description` / `prompt` translated into `locale`,
 *  reactively swapping in once the batch resolves. English source meanwhile. */
export function useTranslatedStarters(locale: Ref<string> | ComputedRef<string>): ComputedRef<CollectionStarter[]> {
  const translated = ref<readonly string[] | null>(null);
  watchEffect(() => {
    const lang = locale.value;
    translated.value = null;
    if (lang === "en") return;
    const req = { namespace: NAMESPACE, targetLanguage: lang, sentences: SOURCES };
    loadTranslated(
      cache,
      req,
      () => locale.value === lang,
      (value) => (translated.value = value),
    );
  });
  return computed<CollectionStarter[]>(() => applyStarterTranslations(COLLECTION_STARTERS, translated.value));
}
