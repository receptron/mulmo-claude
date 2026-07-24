// Framework-agnostic logic behind `useMarkdownDoc`, kept Vue-free so the frontmatter →
// view transform and the scalar formatter are testable without a Vue runtime.
//
// #895 PR A: shared frontmatter handling for every markdown-from-disk view.
// parseFrontmatter never throws — malformed header degrades to "render the whole input
// as body" instead of breaking the view.

import { parseFrontmatter, type ParsedMarkdown } from "@mulmoclaude/markdown-utils/markdown/frontmatter";

export interface MarkdownDocField {
  key: string;
  // Templates branch on Array.isArray and pass scalars through formatScalarField — nested
  // objects would otherwise render as `[object Object]` (codex review iter-1 #902).
  value: unknown;
}

export interface MarkdownDocView extends ParsedMarkdown {
  fields: MarkdownDocField[];
}

// Runs in template scope, so it must render every shape `unknown` can hold without
// throwing. Explicit per-type branches keep `String()` off the object path, which is what
// would otherwise produce `[object Object]` (and trip @typescript-eslint/no-base-to-string).
export function formatScalarField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  if (typeof value === "symbol" || typeof value === "function") return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    // Cyclic object → can't stringify; degrade to the default object tag rather than throw
    // mid-render. Frontmatter (YAML) can't produce cycles, so this is defensive.
    return Object.prototype.toString.call(value);
  }
}

export function buildMarkdownDocView(raw: string): MarkdownDocView {
  const parsed = parseFrontmatter(raw);
  const fields = Object.entries(parsed.meta).map(([key, value]) => ({ key, value }));
  return { ...parsed, fields };
}
