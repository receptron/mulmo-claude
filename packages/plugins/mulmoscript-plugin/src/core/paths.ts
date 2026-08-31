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

/**
 * The slice of `node:path` this rule needs.
 *
 * Injected with no default, and this module imports no `node:*` builtin: it is
 * reached from the browser entry through `core/plugin`, so a `node:path`
 * import here lands in the Vue bundle (Codex on #3017). The server passes its
 * own `path`; tests pass `path.win32` to reach the case below.
 */
export interface PathRules {
  relative: (from: string, to: string) => string;
  isAbsolute: (p: string) => boolean;
  sep: string;
}

/**
 * The wire ref for an absolute path inside a stories root, or `null` when it
 * is not inside one.
 *
 * Pure, and taking its path rules as an argument, because the case that
 * matters is unreachable on the machine this is written on. `path.relative`
 * says "not under the base" in TWO ways and only one looks like an escape:
 * `../…` is the familiar one, and across Windows DRIVES there is no relative
 * path at all, so `relative("C:\\base", "D:\\x")` answers `"D:\\x"` —
 * absolute, with no `..` for the escape check to catch. That minted
 * `stories/D:/anything`, a wire ref that reads back as a DIFFERENT file, which
 * is the substitution this function exists to refuse. Only Windows CI caught
 * it; here there is one root and always a relative route (#3015 post-merge).
 */
export function storyRefWithin(base: string, absolutePath: string, rules: PathRules): string | null {
  const relative = rules.relative(base, absolutePath);
  if (rules.isAbsolute(relative)) return null;
  const rel = relative.split(rules.sep).join("/");
  if (rel === ".." || rel.startsWith("../")) return null;
  return rel ? `${STORIES_DIR}/${rel}` : STORIES_DIR;
}

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
