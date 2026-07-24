import path from "node:path";
import { yearMonthUtc } from "@mulmoclaude/core/artifacts";
import { shortId } from "../id.js";
import { slugify } from "../slug.js";

export function buildArtifactPath(dir: string, title: string | undefined, ext: string, fallbackSlug = "file"): string {
  const slug = title ? slugify(title) || fallbackSlug : fallbackSlug;
  const fname = `${slug}-${Date.now()}${ext}`;
  return path.posix.join(dir, yearMonthUtc(), fname);
}

// shortId variant for concurrent writers that share a prefix within the same millisecond (presentDocument route).
export function buildArtifactPathRandom(dir: string, prefix: string, ext: string, fallbackSlug = "file"): string {
  // Pass fallbackSlug as slugify's default so it overrides slugify's built-in "page" when `prefix` sanitizes to empty.
  const slug = slugify(prefix, fallbackSlug);
  const fname = `${slug}-${shortId()}${ext}`;
  return path.posix.join(dir, yearMonthUtc(), fname);
}
