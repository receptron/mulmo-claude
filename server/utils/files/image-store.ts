import { mkdir, readFile, realpath, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
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

/** Save raw base64 (no data URI prefix) as a PNG file. Returns the workspace-relative path. */
export async function saveImage(base64Data: string): Promise<string> {
  await ensureImagesDir();
  const imageId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const filename = `${imageId}.png`;
  const absPath = path.join(IMAGES_DIR, filename);
  await writeFile(absPath, Buffer.from(base64Data, "base64"));
  return path.posix.join(WORKSPACE_DIRS.images, filename);
}

/** Overwrite an existing image file. The relativePath must start with "images/". */
export async function overwriteImage(relativePath: string, base64Data: string): Promise<void> {
  const absPath = await safeResolve(relativePath);
  await writeFile(absPath, Buffer.from(base64Data, "base64"));
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

/** Check if a string is a file reference (not a data URI). */
export function isImagePath(value: string): boolean {
  return value.startsWith(`${WORKSPACE_DIRS.images}/`) && value.endsWith(".png");
}

/** Build the workspace-relative image path for a filename, or null
 *  if the derived path wouldn't satisfy `isImagePath` (e.g. empty
 *  name, wrong extension). Keeps route handlers from reaching for
 *  `WORKSPACE_DIRS.images` directly — the images/ convention lives
 *  in exactly one place. */
export function imagePathFromFilename(filename: string): string | null {
  if (!filename) return null;
  const relativePath = path.posix.join(WORKSPACE_DIRS.images, filename);
  return isImagePath(relativePath) ? relativePath : null;
}
