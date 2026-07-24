// Chart artifact path — a thin wrapper over the shared, browser-safe builders
// in `@mulmoclaude/core/artifacts` (#2405). The `Date.now()` suffix
// disambiguates filenames, so a plain ASCII slug (falling back to "chart") is
// enough; no crypto-hash fallback for non-ASCII titles.

import { buildArtifactRelPath, slugifyArtifact, toWorkspaceArtifactPath } from "@mulmoclaude/core/artifacts";

const CHART_DIR = "charts";
const CHART_FALLBACK_SLUG = "chart";

/** Lowercase ASCII slug; empty / non-ASCII input falls back to `fallback`. */
export function slugify(title: string | undefined, fallback = CHART_FALLBACK_SLUG): string {
  return slugifyArtifact(title, fallback);
}

export interface ChartPath {
  /** Path relative to the artifacts root — what `files.artifacts.write` takes. */
  relPath: string;
  /** Workspace-relative path — surfaced to the host/LLM for display. */
  filePath: string;
}

/** Build the `charts/<YYYY>/<MM>/<slug>-<ts>.chart.json` location for a document. */
export function chartArtifactPath(title: string | undefined, now: Date = new Date()): ChartPath {
  const relPath = buildArtifactRelPath({ dir: CHART_DIR, title, ext: ".chart.json", fallback: CHART_FALLBACK_SLUG, now });
  return { relPath, filePath: toWorkspaceArtifactPath(relPath) };
}
