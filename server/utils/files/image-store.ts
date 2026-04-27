import { mkdir, readFile, realpath } from "fs/promises";
import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../id.js";
import { writeFileAtomic } from "./atomic.js";
import { yearMonthUtc } from "./naming.js";
import { resolveWithinRoot } from "./safe.js";

const IMAGES_DIR = WORKSPACE_PATHS.images;

// Cached realpath of the images directory. resolveWithinRoot requires
// its root argument to be a realpath so symlinks are handled correctly.
let imagesDirReal: string | null = null;

async function ensureImagesDir(): Promise<string> {
  if (imagesDirReal) return imagesDirReal;
  await mkdir(IMAGES_DIR, { recursive: true });
  imagesDirReal = await realpath(IMAGES_DIR);
  return imagesDirReal;
}

// Resolve a workspace-relative image path (e.g. "images/abc123.png")
// into an absolute path that is guaranteed to be inside the images
// directory. Throws on traversal attempts or non-existent files.
async function safeResolve(relativePath: string): Promise<string> {
  const root = await ensureImagesDir();
  // Strip the leading "images/" prefix so the caller can pass either
  // "images/abc.png" (the stored form) or just "abc.png".
  const name = relativePath.replace(new RegExp(`^${WORKSPACE_DIRS.images}/`), "");
  const result = resolveWithinRoot(root, name);
  if (!result) {
    throw new Error(`path traversal rejected: ${relativePath}`);
  }
  return result;
}

/** Save raw base64 (no data URI prefix) as a PNG file. New files
 *  land under `images/YYYY/MM/` (UTC) so the dir doesn't accumulate
 *  unbounded — see #764. Returns the workspace-relative path.
 *  Atomic: a crashed write can't leave a half-written PNG on disk
 *  (#881 v1). `writeFileAtomic` accepts Buffer directly, so the raw
 *  PNG bytes pass through without re-encoding. */
export async function saveImage(base64Data: string): Promise<string> {
  await ensureImagesDir();
  const partition = yearMonthUtc();
  const filename = `${shortId()}.png`;
  const absPath = path.join(IMAGES_DIR, partition, filename);
  await writeFileAtomic(absPath, Buffer.from(base64Data, "base64"));
  return path.posix.join(WORKSPACE_DIRS.images, partition, filename);
}

/** Overwrite an existing image file. The relativePath must start with "images/".
 *  Atomic — see {@link saveImage}. */
export async function overwriteImage(relativePath: string, base64Data: string): Promise<void> {
  const absPath = await safeResolve(relativePath);
  await writeFileAtomic(absPath, Buffer.from(base64Data, "base64"));
}

/** Read an image file and return raw base64 (no data URI prefix). */
export async function loadImageBase64(relativePath: string): Promise<string> {
  const absPath = await safeResolve(relativePath);
  const buf = await readFile(absPath);
  return buf.toString("base64");
}

/** Convert a data URI to raw base64. */
export function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:image\/[^;]+;base64,/, "");
}

/** Check if a string is a file reference (not a data URI). Accepts
 *  arbitrary depth under `images/` (e.g. `images/2026/04/abc.png`)
 *  so the per-month sharded paths from `saveImage` still validate. */
export function isImagePath(value: string): boolean {
  return value.startsWith(`${WORKSPACE_DIRS.images}/`) && value.endsWith(".png");
}
