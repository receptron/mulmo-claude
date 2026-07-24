// @mulmoclaude/core/translation/client — framework-neutral runtime-translation
// cache. Both hosts (MulmoClaude, MulmoTerminal) translate UI strings (role
// query chips, collection starters, …) into the user's locale at runtime by
// POSTing batches to their own `/api/translation` route; the LLM step and the
// transport/auth differ per host, so BOTH are injected. This module owns only
// the host-agnostic parts: the request/response contract, in-flight de-dup,
// length validation, and an in-memory memo keyed by (namespace, locale,
// sentence-set). No framework dependency — the host wraps this in its own
// reactivity (Vue refs, …), mirroring `@mulmoclaude/core/whisper/client`.
//
// `en` and empty inputs are NOT special-cased here — that's a UI fallback
// decision the caller makes (it already holds the English source).

export interface TranslateRequest {
  /** Cache + server-cache partition, e.g. "role-queries", "collection-starters". */
  namespace: string;
  /** BCP-47 target language, e.g. "ja", "pt-BR". */
  targetLanguage: string;
  /** English source strings to translate, in order. */
  sentences: readonly string[];
}

export interface TranslateResponse {
  /** Translations in the same order and length as `sentences`. */
  translations: string[];
}

/** Host-injected transport. Performs the POST however the host likes (auth,
 *  URL, error shape are the host's concern) and resolves to the response, or
 *  `null` on any network / HTTP failure — the cache treats `null` as a miss and
 *  the caller falls back to the English source. */
export type TranslateTransport = (req: TranslateRequest) => Promise<TranslateResponse | null>;

export interface TranslationCache {
  /** Memoized translations for this exact request, or `null` if not resolved
   *  yet (never fetched, in flight, or the last attempt failed). Synchronous —
   *  a reactive caller reads this after being nudged by `fetch`'s resolution. */
  peek: (req: TranslateRequest) => readonly string[] | null;
  /** Ensure a translation is fetched (de-duped across concurrent callers and
   *  memoized). Resolves to the translations, or `null` on transport failure or
   *  a length mismatch. Repeat calls with the same key return the memoized
   *  value without re-hitting the transport. */
  fetch: (req: TranslateRequest) => Promise<readonly string[] | null>;
  /** Drop all memoized + in-flight state. Primarily for tests that share a
   *  worker; production callers never need it. */
  clear: () => void;
}

function cacheKey(req: TranslateRequest): string {
  // Join the parts with a NUL separator (written as an escaped NUL so the
  // SOURCE stays plain text — a raw NUL byte here made Git classify the file as
  // binary and blocked diff review). NUL can't occur in any part, so two
  // different (namespace, locale, sentence-set) tuples can never collide. The
  // sentence set is part of the key (not just namespace+locale) so callers
  // needn't supply a stable id — identical inputs share a slot, which is correct.
  return [req.namespace, req.targetLanguage, ...req.sentences].join("\u0000");
}

/** Resolve `req` through `cache` (peek-then-fetch) and hand the result to
 *  `apply`, but only while `isCurrent()` still holds — so a slow response can't
 *  overwrite a newer locale/input's translation. A synchronous peek hit skips
 *  the guard (the caller just built `req`, so it is current by construction).
 *  A rejected fetch is swallowed: the caller keeps its English fallback. */
export function loadTranslated(cache: TranslationCache, req: TranslateRequest, isCurrent: () => boolean, apply: (value: readonly string[]) => void): void {
  const hit = cache.peek(req);
  if (hit !== null) {
    apply(hit);
    return;
  }
  cache
    .fetch(req)
    .then((result) => {
      if (result !== null && isCurrent()) apply(result);
    })
    .catch(() => {
      /* transport rejected — keep the English fallback */
    });
}

export function createTranslationCache(transport: TranslateTransport): TranslationCache {
  const memo = new Map<string, readonly string[]>();
  const inflight = new Map<string, Promise<readonly string[] | null>>();

  async function run(key: string, req: TranslateRequest): Promise<readonly string[] | null> {
    const response = await transport(req);
    const translations = response?.translations;
    if (!Array.isArray(translations) || translations.length !== req.sentences.length) {
      return null;
    }
    const frozen = Object.freeze([...translations]);
    memo.set(key, frozen);
    return frozen;
  }

  return {
    peek(req) {
      return memo.get(cacheKey(req)) ?? null;
    },
    fetch(req) {
      const key = cacheKey(req);
      const hit = memo.get(key);
      if (hit) return Promise.resolve(hit);
      const pending = inflight.get(key);
      if (pending) return pending;
      const started = run(key, req).finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, started);
      return started;
    },
    clear() {
      memo.clear();
      inflight.clear();
    },
  };
}
