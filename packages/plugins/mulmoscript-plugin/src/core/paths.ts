// Path helpers for MulmoScript story artifacts. The generic build primitives
// (slug + the `""`/`.`/`..` traversal guard) live in the shared, browser-safe
// `@mulmoclaude/core/artifacts` (#2405); only the story-specific wire-path
// rules stay here.
//
// Path model: the stories directory lives at `<workspace>/artifacts/stories`
// and the FileOps scope root is `<workspace>/artifacts`, so the
// FileOps-relative path and the historical `stories/<name>.json` wire form
// (which every mulmoScript endpoint keys on) are the SAME string. Stories are
// NOT `YYYY/MM`-partitioned, so `storyFilePath` opts out of partitioning.

import { ARTIFACTS_ROOT, buildArtifactRelPath, hasUnsafePathSegment, slugifyArtifact } from "@mulmoclaude/core/artifacts";

const STORIES_DIR = "stories";
const STORY_FALLBACK_SLUG = "story";

/** Lowercase-hyphen slug, capped, leading/trailing hyphens stripped; falls back
 *  to `fallback` for empty/undefined/non-ASCII input. */
export function slugify(title: string | undefined, fallback = STORY_FALLBACK_SLUG): string {
  return slugifyArtifact(title, fallback);
}

/** Build a fresh, collision-safe story path for a new script —
 *  `stories/<slug>-<epoch-ms>.json`, valid as both the FileOps-relative
 *  write path and the wire `filePath`. */
export function storyFilePath(slugSource: string, now: Date = new Date()): string {
  return buildArtifactRelPath({ dir: STORIES_DIR, title: slugSource, ext: ".json", fallback: STORY_FALLBACK_SLUG, now, partitioned: false });
}

/**
 * Normalize a caller-supplied wire path to the canonical
 * `stories/<rel>` form, or null when it can't be trusted. Accepts the
 * canonical `stories/foo.json` convention, bare `foo.json` (the host route
 * historically allowed either), and the workspace-relative spelling
 * `artifacts/stories/foo.json` — the tool description called `filePath`
 * "workspace-relative" for a long time, so agents legitimately send it.
 * A leading `artifacts` segment is dropped only when `stories` follows;
 * a bare `artifacts/foo.json` keeps its historical meaning (a file named
 * `artifacts/foo.json` under the stories dir). Rejects absolute paths,
 * backslashes, and any empty / `.` / `..` segment — the lexical guard
 * before every `files.artifacts` read/write (FileOps re-checks
 * containment as defence-in-depth).
 */
export function normalizeStoryPath(filePath: string): string | null {
  if (filePath.length === 0 || filePath.includes("\\")) return null;
  // Absolute POSIX path or Windows drive prefix.
  if (filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath)) return null;
  if (hasUnsafePathSegment(filePath)) return null;
  const segments = filePath.split("/");
  const trimmed = segments[0] === ARTIFACTS_ROOT && segments[1] === STORIES_DIR ? segments.slice(1) : segments;
  const rest = trimmed[0] === STORIES_DIR ? trimmed.slice(1) : trimmed;
  if (rest.length === 0) return null;
  return [STORIES_DIR, ...rest].join("/");
}
