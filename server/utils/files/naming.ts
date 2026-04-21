// Workspace file naming conventions.
//
// Centralizes the `slug-${Date.now()}.ext` pattern used across
// multiple plugins (chart, presentHtml, markdown, spreadsheet, image).
// Call sites pass a human title + extension; this module handles
// slugification and timestamp suffixing.

import path from "node:path";
import crypto from "node:crypto";
import { slugify } from "../slug.js";

// Length of the random hex suffix appended by `buildArtifactPathRandom`.
// 16 chars = 64 bits ≈ birthday-collision at 2^32 entries — effectively
// impossible for any realistic per-workspace artifact volume.
const RANDOM_SUFFIX_LEN = 16;

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
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, RANDOM_SUFFIX_LEN);
  const fname = `${slug}-${suffix}${ext}`;
  return path.posix.join(dir, fname);
}
