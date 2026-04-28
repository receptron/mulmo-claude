// Composable: parse a reactive markdown source into frontmatter +
// body, plus an insertion-ordered `fields` array for properties-panel
// rendering. Used by every Vue component that displays markdown
// from disk (wiki / files / journal / news / skills / markdown
// plugin) so frontmatter handling lives in one place (#895 PR A).
//
// `parseFrontmatter` always returns an object — never throws — so a
// malformed header degrades to "render the whole input as body"
// instead of breaking the view.

import { computed, type ComputedRef, type Ref } from "vue";
import { parseFrontmatter, type ParsedMarkdown } from "../utils/markdown/frontmatter";

export interface MarkdownDocField {
  key: string;
  /** YAML value as-is — `string`, `string[]`, `number`, `boolean`,
   *  nested object, or `null`. Templates typically branch on
   *  `Array.isArray(value)` and pass scalars through
   *  `formatScalarField` so a nested object doesn't render as
   *  `[object Object]` (codex review iter-1 #902). */
  value: unknown;
}

/** Render a non-array `MarkdownDocField.value` as a string for
 *  the properties-panel template. Branch:
 *    - `null`/`undefined` → empty string (keep cell visually empty)
 *    - object → compact JSON (so nested frontmatter doesn't print
 *      `[object Object]`)
 *    - everything else → `String(value)` (string / number / boolean) */
export function formatScalarField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      // Cyclic objects can't be JSON-stringified — fall back to a
      // pragmatic placeholder rather than throwing in a template.
      return String(value);
    }
  }
  return String(value);
}

export interface MarkdownDocView extends ParsedMarkdown {
  /** Insertion-ordered field list. Empty when `meta` is empty. */
  fields: MarkdownDocField[];
}

/** Reactively parse a markdown string. Re-runs whenever `content`
 *  changes. Pass `null`/`undefined` to get the empty state
 *  (`{ meta: {}, body: "", hasHeader: false, fields: [] }`) — so
 *  callers can wire it directly to a load-state ref without a
 *  null-guard wrapper. */
export function useMarkdownDoc(content: Ref<string | null | undefined>): ComputedRef<MarkdownDocView> {
  return computed(() => {
    const raw = content.value ?? "";
    const parsed = parseFrontmatter(raw);
    const fields = Object.entries(parsed.meta).map(([key, value]) => ({ key, value }));
    return { ...parsed, fields };
  });
}
