// Generic runtime-translation composable: translate a reactive list of English
// UI strings into the user's locale via the host's /api/translation route. The
// host-agnostic cache (de-dup, memo, length validation) lives in
// `@mulmoclaude/core/translation/client`; this file is the thin Vue layer —
// reactivity + the `en`/empty fallback. `useTranslatedQueries` (role chips) and
// any future caller share the one module-singleton cache below.
//
// `locale` and `sentences` are taken as Refs (not read from `useI18n()`) so the
// composable can be unit-tested outside a Vue setup context.

import { computed, watchEffect, type ComputedRef, type Ref, ref } from "vue";
import { createTranslationCache, loadTranslated, type TranslateResponse } from "@mulmoclaude/core/translation/client";
import { apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const cache = createTranslationCache((req) =>
  apiPost<TranslateResponse>(API_ROUTES.translation.translate, req).then((result) => (result.ok ? result.data : null)),
);

/** Pure projection: the translated batch when present, else the English source. */
export function pickTranslated(translated: readonly string[] | null, sources: readonly string[]): string[] {
  return [...(translated ?? sources)];
}

/** Translated strings when available, falling back to the English source while
 *  the request is in flight or on failure. `en` and empty inputs never fetch. */
export function useTranslatedStrings(namespace: string, sentences: Ref<readonly string[]>, locale: Ref<string>): ComputedRef<string[]> {
  const translated = ref<readonly string[] | null>(null);
  watchEffect(() => {
    const lang = locale.value;
    const sources = sentences.value;
    translated.value = null; // reset on any input change → source shows meanwhile
    if (lang === "en" || sources.length === 0) return;
    const req = { namespace, targetLanguage: lang, sentences: sources };
    loadTranslated(
      cache,
      req,
      () => locale.value === lang && sentences.value === sources,
      (value) => (translated.value = value),
    );
  });
  return computed<string[]>(() => pickTranslated(translated.value, sentences.value));
}

// ── Test-only hook ──────────────────────────────────────────────────
// Vitest / node:test usually gets a fresh worker per file, but suites that
// share a worker reset the singleton cache between cases through this.
export function __resetTranslatedStringsCacheForTests(): void {
  cache.clear();
}
