// Host markdown→HTML pipeline for wiki/View.vue. The pure
// `[[wiki-link]]` walker now lives in `@mulmoclaude/core/wiki`
// (shared with MulmoTerminal); this file owns only the host-specific
// wrapping (image-ref rewrite + marked + interactive task lists).

import { marked } from "marked";
import { renderWikiLinks, WIKI_ACTION } from "@mulmoclaude/core/wiki";
import { rewriteMarkdownImageRefs } from "@mulmoclaude/markdown-utils/image/rewriteMarkdownImageRefs";
import { findTaskLines, makeTasksInteractive, toggleTaskAt } from "@mulmoclaude/markdown-utils/markdown/taskList";
import { splitFrontmatter } from "@mulmoclaude/markdown-utils/markdown/frontmatter";

// Re-export so existing host importers (and tests) keep a single
// `./helpers` entry point for the renderer.
export { renderWikiLinks } from "@mulmoclaude/core/wiki";

/**
 * Markdown→HTML pipeline shared between the standalone /wiki view
 * and the chat-inline preview (Stage 3a). Caller passes a body that
 * already has frontmatter stripped, plus the workspace-relative base
 * dir used to rewrite image refs (`data/wiki/pages` for a page,
 * `data/wiki` for log/lint).
 */
export function renderWikiPageHtml(body: string, baseDir: string): string {
  if (!body) return "";
  const withImages = rewriteMarkdownImageRefs(body, baseDir);
  return makeTasksInteractive(marked.parse(renderWikiLinks(withImages)) as string);
}

/** String accessor that survives the `unknown` type from FAILSAFE
 *  YAML — `meta` values are all strings under FAILSAFE schema, but
 *  type-narrowing requires a runtime check. Empty strings collapse to
 *  `null` so the metadata bar skips the field entirely. */
export function metaString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

/** Array-of-strings accessor for `tags`. Drops non-string members so
 *  a malformed `tags:` list can't leak a non-string into the chips. */
export function metaStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Render an `updated` ISO timestamp as `YYYY-MM-DD HH:MM` in the
 *  viewer's local timezone. On-disk values are UTC ISO
 *  (`2026-04-27T14:32:56.789Z`) — showing the raw `14:32` would read
 *  like local wall time on a non-UTC machine and mislead the reader.
 *  Falls back to the raw value when it doesn't parse as a Date
 *  (user-supplied frontmatter may hold any string here). `sv-SE` gives
 *  the ISO-like space-separated shape; `hour12: false` defends against
 *  AM/PM locales. */
export function formatUpdated(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

/** Per-tag usage counts across page entries. Kept separate from
 *  `computeTagChips` so the fallback chip (an active filter the
 *  adaptive cutoff hides) can look up a real count instead of
 *  understating a dropped non-singleton tag as `1`. */
export function computeTagCounts(entries: readonly { tags?: readonly string[] }[]): Map<string, number> {
  const counts = new Map<string, number>();
  entries.forEach((entry) => (entry.tags ?? []).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
  return counts;
}

/** Adaptive tag chips for the filter bar: sorted by count desc then
 *  name asc, singletons dropped (a tag on one page adds no filtering
 *  value, only noise — the per-row `#tag` chips still render it). Once
 *  more than `target` tags qualify, the minimum count is raised to the
 *  count at the target position, which keeps tied-popularity tags
 *  grouped rather than sliced arbitrarily — so the row can exceed
 *  `target` when a tie straddles the boundary. */
export function computeTagChips(entries: readonly { tags?: readonly string[] }[], target: number): [string, number][] {
  const meaningful = [...computeTagCounts(entries).entries()]
    .filter(([, count]) => count > 1)
    .sort(([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB));
  if (meaningful.length <= target) return meaningful;
  const [, cutoff] = meaningful[target - 1];
  return meaningful.filter(([, count]) => count >= cutoff);
}

/** Whether a page view should lazily fetch the global link graph to populate
 *  its "Linked references" panel. The graph is global, so one fetch serves
 *  every page — only fetch on a page that exists and only when the graph hasn't
 *  already loaded. A wrong condition here fails silently (backlinks never
 *  appear), so it is unit-tested. */
export function shouldLazyLoadGraph(action: string, pageExists: boolean, hasGraph: boolean): boolean {
  return action === WIKI_ACTION.page && pageExists && !hasGraph;
}

/** Outcome of a task-checkbox click, computed purely from the clicked
 *  input, its rendered container, and the current markdown source:
 *  - `toggled` — the new full document to persist.
 *  - `mismatch` — source task count differs from the rendered
 *    `input.md-task` count (source/DOM drift); the caller surfaces the
 *    error and reverts.
 *  - `skip` — the click can't be mapped (target not among the tasks,
 *    or an out-of-range toggle); the caller reverts silently. */
export type TaskToggleResult = { readonly status: "toggled"; readonly content: string } | { readonly status: "mismatch" } | { readonly status: "skip" };

/** Compute the new document from a task-checkbox click. Pure: the DOM
 *  is passed in (`root` is queried, never `document`), and the source
 *  arrives as `content` rather than being read from a reactive ref, so
 *  the toggle rule is testable in isolation. */
export function computeToggledContent(target: HTMLInputElement, root: HTMLElement, content: string): TaskToggleResult {
  const taskInputs = root.querySelectorAll<HTMLInputElement>("input.md-task");
  const taskIndex = Array.from(taskInputs).indexOf(target);
  if (taskIndex < 0) return { status: "skip" };

  const { prefix, body } = splitFrontmatter(content);
  if (findTaskLines(body).length !== taskInputs.length) return { status: "mismatch" };

  const updatedBody = toggleTaskAt(body, taskIndex);
  if (updatedBody === null) return { status: "skip" };
  return { status: "toggled", content: prefix + updatedBody };
}
