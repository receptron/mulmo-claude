// Path helpers for presentShapeScript artifacts. The generic build primitives
// (slug, the `""`/`.`/`..` traversal guard) live in the shared, browser-safe
// `@mulmoclaude/core/artifacts`; only the ShapeScript-specific rules (`.shape`
// extension, `artifacts/shapes/` prefix) stay here. All filesystem access
// happens through the host's generic `files.artifacts` FileOps (rooted at
// `<workspace>/artifacts`), so this module imports no `node:*` builtin — it is
// reached from the browser entry through `core/plugin`.

import {
  ARTIFACTS_ROOT,
  buildArtifactRelPath,
  classifyFilePath,
  hasUnsafePathSegment,
  slugifyArtifact,
  toWorkspaceArtifactPath,
} from "@mulmoclaude/core/artifacts";

const SHAPE_DIR = "shapes";
const SHAPE_FALLBACK_SLUG = "shape";

/** The extension a ShapeScript source carries — upstream ShapeScript's own. */
export const SHAPE_EXTENSIONS = [".shape"] as const;

/** Lowercase-hyphen slug, capped, leading/trailing hyphens stripped; falls back
 *  to `fallback` for empty/undefined/non-ASCII input. */
export function slugify(title: string | undefined, fallback = SHAPE_FALLBACK_SLUG): string {
  return slugifyArtifact(title, fallback);
}

export interface ShapePath {
  /** Path relative to the artifacts root — what `files.artifacts.write` takes
   *  (e.g. `shapes/a-lamp-1718765432101.shape`). */
  relPath: string;
  /** Workspace-relative path for display / tool-result data
   *  (e.g. `artifacts/shapes/a-lamp-1718765432101.shape`). */
  filePath: string;
}

/** Build a fresh, collision-safe artifact path for a new ShapeScript source.
 *  Flat rather than `YYYY/MM`-partitioned (the `artifacts/stories` shape): a
 *  model is something the user opens by name, and one directory keeps that
 *  browsable. */
export function shapeArtifactPath(title: string | undefined, now: Date = new Date()): ShapePath {
  const relPath = buildArtifactRelPath({ dir: SHAPE_DIR, title, ext: ".shape", fallback: SHAPE_FALLBACK_SLUG, now, partitioned: false });
  return { relPath, filePath: toWorkspaceArtifactPath(relPath) };
}

/**
 * Strict guard for a workspace-relative path the caller claims is an existing
 * ShapeScript artifact. Rejects anything outside `artifacts/shapes/`,
 * non-`.shape`, or with traversal / non-canonical segments — the primary
 * defence before a `files.artifacts` read/write.
 */
export function isShapeArtifactPath(value: string): boolean {
  if (!value.startsWith(`${ARTIFACTS_ROOT}/${SHAPE_DIR}/`)) return false;
  if (!value.endsWith(".shape")) return false;
  return !hasUnsafePathSegment(value);
}

/** Convert a workspace-relative artifacts path (`artifacts/shapes/…`) to the
 *  `files.artifacts`-relative form (`shapes/…`) that FileOps expects. Assumes
 *  the input already passed `isShapeArtifactPath`. */
export function toArtifactsRelative(workspaceRelPath: string): string {
  return workspaceRelPath.startsWith(`${ARTIFACTS_ROOT}/`) ? workspaceRelPath.slice(ARTIFACTS_ROOT.length + 1) : workspaceRelPath;
}

/** The `path` argument's gate: ANY ShapeScript source, not just the ones this
 *  tool wrote — a workspace-relative path (`models/lamp.shape`) or, where the
 *  host permits it, an absolute one. Lexical only; the host's `files.byPath`
 *  capability decides which of those it will actually open. */
export function isPresentableShapePath(value: string): boolean {
  return classifyFilePath(value, SHAPE_EXTENSIONS) !== null;
}
