// Workspace file naming conventions.
//
// Centralizes the `slug-${Date.now()}.ext` pattern used across
// multiple plugins (chart, presentHtml, markdown, spreadsheet, image).
// Call sites pass a human title + extension; this module handles
// slugification and timestamp suffixing.

import path from "node:path";
import { slugify } from "../slug.js";

/**
 * Build a workspace-relative path for a new artifact file.
 *
 * @param dir  Workspace-relative directory (e.g. WORKSPACE_DIRS.charts)
 * @param title  Human-readable title (slugified for the filename)
 * @param ext  File extension with leading dot (e.g. ".html", ".json")
 * @param fallbackSlug  Slug to use when title is empty/undefined
 * @returns  Workspace-relative path like "artifacts/charts/sales-1776135210389.chart.json"
 */
export function buildArtifactPath(dir: string, title: string | undefined, ext: string, fallbackSlug = "file"): string {
  const slug = title ? slugify(title) || fallbackSlug : fallbackSlug;
  const fname = `${slug}-${Date.now()}${ext}`;
  return path.posix.join(dir, fname);
}
