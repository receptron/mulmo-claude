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

import { ARTIFACTS_ROOT, buildArtifactRelPath, classifyFilePath, hasUnsafePathSegment, slugifyArtifact } from "@mulmoclaude/core/artifacts";

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
/**
 * The path INSIDE a stories root that a wire path names, or null when it does
 * not name one.
 *
 * The default root's FileOps is rooted one level up, at `<workspace>/artifacts`,
 * so there the wire path and the FileOps path are the SAME string and nothing
 * is stripped. A named root's FileOps is rooted at the stories directory
 * itself — which is what a host naturally writes, having registered exactly
 * that directory in `extraRoots` — so the `stories/` prefix has to come off,
 * or the write lands in `<root>/stories/<rel>` while the read looks in
 * `<root>/<rel>` and the two are different files (#3020 review H1).
 */
export function storiesRelativePath(wirePath: string): string | null {
  const normalized = normalizeStoryPath(wirePath);
  if (normalized === null) return null;
  return normalized.slice(`${STORIES_DIR}/`.length);
}

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

// ── The absolute `filePath` form ─────────────────────────────────────────────
//
// `filePath` may also name a script that lives OUTSIDE the stories dir, by
// absolute path — a deck kept in a repo, a script another tool wrote. The rule
// is deliberately the same one `presentDocument` / `presentHtml` already apply
// to their `path` argument (`@mulmoclaude/core/files`' byPath ops): a lexical
// shape check, and no containment check, because opening a file the caller
// named is the documented purpose of the form and the agent can already read
// and write those files directly. What is new is that the VIEW can too.
//
// A RELATIVE `filePath` keeps its exact pre-existing meaning — `normalizeStoryPath`
// resolves it under the stories dir, unchanged.

/** Extensions the tool's `filePath` argument may name. */
export const STORY_SCRIPT_EXTENSIONS = [".json"] as const;

/**
 * Extensions a wire path may carry once the server mints one, i.e. the script
 * itself plus every generated artifact mulmocast writes beside it (`.mp4` for
 * the assembled movie and animated beats, `.mov` for per-beat clips, `.pdf`
 * for the handout). Closed on purpose: a format this list does not know is
 * refused loudly at the download route rather than resolved by a looser rule.
 */
export const STORY_TARGET_EXTENSIONS = [".json", ".mp4", ".mov", ".pdf"] as const;

/**
 * True when `value` is the absolute form — safe to open AS NAMED.
 *
 * Lexical only, and platform-independent by design (`classifyFilePath`
 * recognises `C:\proj\x.json` on POSIX too), because the value may arrive from
 * a remote host. Whether the path is absolute on THIS machine is the server's
 * question, answered where the path meets the filesystem: `resolveStory`
 * requires native absoluteness and a real regular file.
 */
export function isAbsoluteStoryPath(value: string, extensions: readonly string[] = STORY_SCRIPT_EXTENSIONS): boolean {
  return classifyFilePath(value, extensions) === "absolute";
}
