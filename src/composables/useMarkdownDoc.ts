// #895 PR A: shared frontmatter handling for every markdown-from-disk view. parseFrontmatter never throws —
// malformed header degrades to "render the whole input as body" instead of breaking the view.

import { computed, type ComputedRef, type Ref } from "vue";
import { parseFrontmatter, type ParsedMarkdown } from "../utils/markdown/frontmatter";

export interface MarkdownDocField {
  key: string;
  // Templates branch on Array.isArray and pass scalars through formatScalarField — nested objects would otherwise
  // render as `[object Object]` (codex review iter-1 #902).
  value: unknown;
}

export function formatScalarField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      // Cyclic object → can't stringify; fall back to String() rather than throw inside a template.
      return String(value);
    }
  }
  return String(value);
}

export interface MarkdownDocView extends ParsedMarkdown {
  fields: MarkdownDocField[];
}

// Pass null/undefined to get the empty state — so callers can wire a load-state ref without a null-guard wrapper.
export function useMarkdownDoc(content: Ref<string | null | undefined>): ComputedRef<MarkdownDocView> {
  return computed(() => {
    const raw = content.value ?? "";
    const parsed = parseFrontmatter(raw);
    const fields = Object.entries(parsed.meta).map(([key, value]) => ({ key, value }));
    return { ...parsed, fields };
  });
}
