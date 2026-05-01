// File store for chat attachments (paste / drop / file picker).
// Mirrors the shape of image-store.ts but keeps the original MIME's
// extension instead of forcing `.png`, since attachments cover PDF,
// DOCX, XLSX, PPTX, text/* and JSON/XML/YAML/TOML in addition to
// images. PPTX uploads also save a converted `.pdf` companion under
// the same YYYY/MM partition (and ID prefix) so the agent loop can
// hand Claude the PDF path directly.
//
// Layout:
//   data/attachments/YYYY/MM/<id>.<ext>            (original, always)
//   data/attachments/YYYY/MM/<id>.pdf              (companion, PPTX only — same <id>)

import { mkdir, readFile, realpath, writeFile } from "fs/promises";
import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../id.js";
import { writeFileAtomic } from "./atomic.js";
import { yearMonthUtc } from "./naming.js";
import { resolveWithinRoot } from "./safe.js";

const ATTACHMENTS_DIR = WORKSPACE_PATHS.attachments;

let attachmentsDirReal: string | null = null;

async function ensureAttachmentsDir(): Promise<string> {
  if (attachmentsDirReal) return attachmentsDirReal;
  await mkdir(ATTACHMENTS_DIR, { recursive: true });
  attachmentsDirReal = await realpath(ATTACHMENTS_DIR);
  return attachmentsDirReal;
}

async function safeResolve(relativePath: string): Promise<string> {
  const root = await ensureAttachmentsDir();
  const name = relativePath.replace(new RegExp(`^${WORKSPACE_DIRS.attachments}/`), "");
  const result = resolveWithinRoot(root, name);
  if (!result) {
    throw new Error(`path traversal rejected: ${relativePath}`);
  }
  return result;
}

// MIME ↔ extension mapping. Kept narrow on purpose — anything not
// in this table falls back to `.bin` so we don't have to guess.
// `inferMimeFromExtension()` is the inverse, used when reading a
// stored file back to build a Claude content block.
const MIME_EXT: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "application/xml": ".xml",
  "application/x-yaml": ".yaml",
  "application/toml": ".toml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/html": ".html",
  "text/markdown": ".md",
  "text/xml": ".xml",
  "text/yaml": ".yaml",
  "text/x-yaml": ".yaml",
};

// Inverse of MIME_EXT — enough to round-trip everything we save.
// Not a complete extension → MIME table; only entries we produce
// when storing files (so reading back is unambiguous).
const EXT_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".toml": "application/toml",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".md": "text/markdown",
};

export function extensionForMime(mimeType: string): string {
  return MIME_EXT[mimeType] ?? ".bin";
}

export function inferMimeFromExtension(filename: string): string | undefined {
  const ext = path.extname(filename).toLowerCase();
  return EXT_MIME[ext];
}

export interface SavedAttachment {
  /** Workspace-relative path of the file written to disk. */
  relativePath: string;
  /** MIME type stored on disk (matches the input — conversions are
   *  reported separately via `companions`). */
  mimeType: string;
}

/** Save a single attachment under data/attachments/YYYY/MM/. The
 *  caller picks the ID; companions (e.g. PPTX → PDF) reuse it via
 *  `saveCompanion()` so they share the same numeric prefix. */
export async function saveAttachment(base64Data: string, mimeType: string): Promise<SavedAttachment> {
  await ensureAttachmentsDir();
  const partition = yearMonthUtc();
  const ext = extensionForMime(mimeType);
  const filename = `${shortId()}${ext}`;
  const absPath = path.join(ATTACHMENTS_DIR, partition, filename);
  await writeFileAtomic(absPath, Buffer.from(base64Data, "base64"));
  return {
    relativePath: path.posix.join(WORKSPACE_DIRS.attachments, partition, filename),
    mimeType,
  };
}

/** Save a companion file (e.g. PPTX → PDF) alongside an existing
 *  attachment, reusing its `<id>` so both filenames share a prefix
 *  and the same partition directory. Used by the upload route to
 *  store conversion artefacts next to their originals. Accepts a
 *  raw Buffer — the converter already has bytes in hand and base64
 *  re-encoding would be wasted work. */
export async function saveCompanion(originalRelativePath: string, buf: Buffer, ext: string): Promise<string> {
  await ensureAttachmentsDir();
  const dir = path.posix.dirname(originalRelativePath);
  const base = path.posix.basename(originalRelativePath, path.posix.extname(originalRelativePath));
  const filename = `${base}${ext}`;
  const relativePath = path.posix.join(dir, filename);
  const absPath = await safeResolve(relativePath);
  // mkdir-p inside safeResolve's confined root.
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buf);
  return relativePath;
}

export async function loadAttachmentBase64(relativePath: string): Promise<string> {
  const absPath = await safeResolve(relativePath);
  const buf = await readFile(absPath);
  return buf.toString("base64");
}

export async function loadAttachmentBytes(relativePath: string): Promise<Buffer> {
  const absPath = await safeResolve(relativePath);
  return readFile(absPath);
}

// Reject `.` and `..` segments split on either `/` or `\` so a
// traversal-shaped value (`data/attachments/../secrets/key.pem`,
// `data/attachments\..\foo.pdf`) doesn't pass the prefix check
// and reach `[Attached file: ...]` markers / chat surface
// (Codex review on PR #1084 follow-up to #1052).
function hasTraversalSegment(value: string): boolean {
  return value.split(/[/\\]/).some((segment) => segment === ".." || segment === ".");
}

export function isAttachmentPath(value: string): boolean {
  if (!value.startsWith(`${WORKSPACE_DIRS.attachments}/`)) return false;
  if (hasTraversalSegment(value)) return false;
  return true;
}

export function stripDataUri(dataUri: string): { mimeType: string; base64: string } | undefined {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUri);
  if (!match) return undefined;
  const [, mimeType, isBase64, payload] = match;
  if (!isBase64) {
    // URL-encoded inline form — convert to base64 for storage.
    return { mimeType, base64: Buffer.from(decodeURIComponent(payload), "utf-8").toString("base64") };
  }
  return { mimeType, base64: payload };
}
