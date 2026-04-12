import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { workspacePath } from "../workspace.js";

const IMAGES_DIR = path.join(workspacePath, "images");

/** Save raw base64 (no data URI prefix) as a PNG file. Returns the workspace-relative path. */
export async function saveImage(base64Data: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const filename = `${id}.png`;
  const absPath = path.join(IMAGES_DIR, filename);
  await fs.writeFile(absPath, Buffer.from(base64Data, "base64"));
  return `images/${filename}`;
}

/** Overwrite an existing image file. The relativePath must start with "images/". */
export async function overwriteImage(
  relativePath: string,
  base64Data: string,
): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await fs.writeFile(absPath, Buffer.from(base64Data, "base64"));
}

/** Read an image file and return raw base64 (no data URI prefix). */
export async function loadImageBase64(relativePath: string): Promise<string> {
  const absPath = path.join(workspacePath, relativePath);
  const buf = await fs.readFile(absPath);
  return buf.toString("base64");
}

/** Convert a data URI to raw base64. */
export function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:image\/[^;]+;base64,/, "");
}

/** Check if a string is a file reference (not a data URI). */
export function isImagePath(value: string): boolean {
  return value.startsWith("images/") && value.endsWith(".png");
}
