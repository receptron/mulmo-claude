import path from "node:path";
import { shortId } from "../id.js";
import { slugify } from "../slug.js";

// #764 partitioning. UTC (not local) so a workspace synced across timezones still groups into the same bucket.
export function yearMonthUtc(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

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
