import { mkdir, readFile, realpath } from "fs/promises";
import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../id.js";
import { writeFileAtomic } from "./atomic.js";
import { yearMonthUtc } from "./naming.js";
import { resolveWithinRoot } from "./safe.js";

const IMAGES_DIR = WORKSPACE_PATHS.images;

// resolveWithinRoot needs a realpath as its root so symlinks resolve correctly.
let imagesDirReal: string | null = null;

async function ensureImagesDir(): Promise<string> {
  if (imagesDirReal) return imagesDirReal;
  await mkdir(IMAGES_DIR, { recursive: true });
  imagesDirReal = await realpath(IMAGES_DIR);
  return imagesDirReal;
}

// Throws on traversal. Strips a leading "images/" so callers can pass either the stored form or bare filename.
async function safeResolve(relativePath: string): Promise<string> {
  const root = await ensureImagesDir();
  const name = relativePath.replace(new RegExp(`^${WORKSPACE_DIRS.images}/`), "");
  const result = resolveWithinRoot(root, name);
  if (!result) {
    throw new Error(`path traversal rejected: ${relativePath}`);
  }
  return result;
}

// #764 sharded under images/YYYY/MM/ (UTC). Buffer pass-through avoids re-encoding the PNG bytes.
export async function saveImage(base64Data: string): Promise<string> {
  await ensureImagesDir();
  const partition = yearMonthUtc();
  const filename = `${shortId()}.png`;
  const absPath = path.join(IMAGES_DIR, partition, filename);
  await writeFileAtomic(absPath, Buffer.from(base64Data, "base64"));
  return path.posix.join(WORKSPACE_DIRS.images, partition, filename);
}

export async function overwriteImage(relativePath: string, base64Data: string): Promise<void> {
  const absPath = await safeResolve(relativePath);
  await writeFileAtomic(absPath, Buffer.from(base64Data, "base64"));
}

export async function loadImageBase64(relativePath: string): Promise<string> {
  const absPath = await safeResolve(relativePath);
  const buf = await readFile(absPath);
  return buf.toString("base64");
}

export function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:image\/[^;]+;base64,/, "");
}

// Reject `.` / `..` segments split on either `/` or `\` so a
// traversal-shaped value can't slip past the prefix/suffix gate
// (Codex review on PR #1084 follow-up to #1052).
function hasTraversalSegment(value: string): boolean {
  return value.split(/[/\\]/).some((segment) => segment === ".." || segment === ".");
}

// Accepts arbitrary depth so saveImage's images/YYYY/MM/abc.png still validates.
export function isImagePath(value: string): boolean {
  if (!value.startsWith(`${WORKSPACE_DIRS.images}/`)) return false;
  if (!value.endsWith(".png")) return false;
  if (hasTraversalSegment(value)) return false;
  return true;
}
