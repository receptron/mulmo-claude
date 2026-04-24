// Workspace file naming conventions.
//
// Centralizes the `slug-${Date.now()}.ext` pattern used across
// multiple plugins (chart, presentHtml, markdown, spreadsheet, image).
// Call sites pass a human title + extension; this module handles
// slugification and timestamp suffixing.

import path from "node:path";
import { shortId } from "../id.js";
import { slugify } from "../slug.js";

/**
 * UTC-based `YYYY/MM` partition segment for new artifacts (#764).
 * Keeps each artifact directory from accumulating a flat list of
 * thousands of files. UTC is used (rather than local time) so a
 * workspace synced across machines / timezones still groups files
 * into the same bucket.
 *
 * Exported for unit tests and callers that need the partition without
 * also generating a filename (e.g. saveImage / saveSpreadsheet).
 */
export function yearMonthUtc(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

/**
 * Build a workspace-relative path for a new artifact file.
 *
 * @param dir  Workspace-relative directory (e.g. WORKSPACE_DIRS.charts)
 * @param title  Human-readable title (slugified for the filename)
 * @param ext  File extension with leading dot (e.g. ".html", ".json")
 * @param fallbackSlug  Slug to use when title is empty/undefined
 * @returns  Workspace-relative path like "artifacts/charts/2026/04/sales-1776135210389.chart.json"
 */
export function buildArtifactPath(dir: string, title: string | undefined, ext: string, fallbackSlug = "file"): string {
  const slug = title ? slugify(title) || fallbackSlug : fallbackSlug;
  const fname = `${slug}-${Date.now()}${ext}`;
  return path.posix.join(dir, yearMonthUtc(), fname);
}

/**
 * Like `buildArtifactPath`, but appends a random hex id instead of a
 * timestamp. Use when multiple concurrent writers may share the same
 * prefix within the same millisecond (e.g. LLM-supplied `filenamePrefix`
 * on the `presentDocument` route).
 *
 * @param dir  Workspace-relative directory
 * @param prefix  Human-readable prefix (slugified via `slugify`)
 * @param ext  File extension with leading dot
 * @param fallbackSlug  Slug to use when the sanitized prefix is empty
 */
export function buildArtifactPathRandom(dir: string, prefix: string, ext: string, fallbackSlug = "file"): string {
  // Pass fallbackSlug as slugify's default so it overrides slugify's
  // built-in "page" default when `prefix` sanitizes to empty.
  const slug = slugify(prefix, fallbackSlug);
  const fname = `${slug}-${shortId()}${ext}`;
  return path.posix.join(dir, yearMonthUtc(), fname);
}
