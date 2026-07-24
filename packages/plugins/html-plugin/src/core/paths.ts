// Path helpers for presentHtml artifacts. The generic build primitives (slug,
// YYYY/MM partition, the `""`/`.`/`..` traversal guard) live in the shared,
// browser-safe `@mulmoclaude/core/artifacts` (#2405); only the html-specific
// rules (`.html` extension, `artifacts/html/` prefix, preview URL) stay here.
// All filesystem access happens through the host's generic `files.artifacts`
// FileOps (rooted at `<workspace>/artifacts`).

import { ARTIFACTS_ROOT, buildArtifactRelPath, hasUnsafePathSegment, slugifyArtifact, toWorkspaceArtifactPath } from "@mulmoclaude/core/artifacts";

const HTML_DIR = "html";
const HTML_FALLBACK_SLUG = "page";

/** Lowercase-hyphen slug, capped, leading/trailing hyphens stripped; falls back
 *  to `fallback` for empty/undefined/non-ASCII input. */
export function slugify(title: string | undefined, fallback = HTML_FALLBACK_SLUG): string {
  return slugifyArtifact(title, fallback);
}

export interface HtmlPath {
  /** Path relative to the artifacts root — what `files.artifacts.write` takes
   *  (e.g. `html/2026/06/the-cell-1718765432101.html`). */
  relPath: string;
  /** Workspace-relative path for display / tool-result data
   *  (e.g. `artifacts/html/2026/06/the-cell-1718765432101.html`). */
  filePath: string;
}

/** Build a fresh, collision-safe artifact path for a new HTML page. */
export function htmlArtifactPath(title: string | undefined, now: Date = new Date()): HtmlPath {
  const relPath = buildArtifactRelPath({ dir: HTML_DIR, title, ext: ".html", fallback: HTML_FALLBACK_SLUG, now });
  return { relPath, filePath: toWorkspaceArtifactPath(relPath) };
}

/**
 * Strict guard for a workspace-relative path the caller claims is an existing
 * HTML artifact. Rejects anything outside `artifacts/html/`, non-`.html`, or
 * with traversal / non-canonical segments — the primary defence before a
 * `files.artifacts` read/write (the FileOps path is the strip of this, below).
 */
export function isHtmlArtifactPath(value: string): boolean {
  if (!value.startsWith(`${ARTIFACTS_ROOT}/${HTML_DIR}/`)) return false;
  if (!value.endsWith(".html")) return false;
  return !hasUnsafePathSegment(value);
}

/** Convert a workspace-relative artifacts path (`artifacts/html/…`) to the
 *  `files.artifacts`-relative form (`html/…`) that FileOps expects. Assumes
 *  the input already passed `isHtmlArtifactPath`. */
export function toArtifactsRelative(workspaceRelPath: string): string {
  return workspaceRelPath.startsWith(`${ARTIFACTS_ROOT}/`) ? workspaceRelPath.slice(ARTIFACTS_ROOT.length + 1) : workspaceRelPath;
}

/**
 * Default browser URL for an HTML artifact, derived purely from its
 * workspace-relative `filePath` — `artifacts/html/2026/04/p.html` →
 * `/artifacts/html/2026/04/p.html` (per-segment URL-encoded). The View uses
 * this when the host hasn't injected a `previewUrl`, so already-presented
 * results (whose stored data predates that field) still render. A host that
 * serves `artifacts/html/…` at a different URL injects `previewUrl` to override.
 * Returns null for non-HTML / out-of-tree paths.
 */
export function htmlArtifactPreviewUrl(filePath: string | null): string | null {
  if (!filePath) return null;
  const lower = filePath.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".htm")) return null;
  const prefix = `${ARTIFACTS_ROOT}/${HTML_DIR}/`;
  if (!filePath.startsWith(prefix)) return null;
  // Reject traversal / non-canonical segments so the derived URL can never point
  // the iframe outside artifacts/html/ — defence-in-depth even though `filePath`
  // is normally produced by `htmlArtifactPath` / validated by `presentExisting`.
  if (hasUnsafePathSegment(filePath)) return null;
  const rest = filePath.slice(prefix.length);
  if (rest.length === 0) return null;
  return `/${ARTIFACTS_ROOT}/${HTML_DIR}/${rest.split("/").map(encodeURIComponent).join("/")}`;
}
