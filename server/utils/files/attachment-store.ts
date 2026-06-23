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

import { mkdir, readFile, realpath } from "fs/promises";
import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../id.js";
import { writeFileAtomic } from "./atomic.js";
import { yearMonthUtc } from "./naming.js";
import { resolveWithinRoot } from "./safe.js";

// Cache the real-path resolution per workspace root so test setups
// that override `WORKSPACE_PATHS.attachments` mid-run still work —
// reading the path at call time (instead of capturing it at module
// load) means a test that points the workspace at a tmp dir
// recomputes everything from there.
const attachmentsDirRealByRoot = new Map<string, string>();

async function ensureAttachmentsDir(): Promise<string> {
  const root = WORKSPACE_PATHS.attachments;
  const cached = attachmentsDirRealByRoot.get(root);
  if (cached) return cached;
  await mkdir(root, { recursive: true });
  const real = await realpath(root);
  attachmentsDirRealByRoot.set(root, real);
  return real;
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
  // HEIC / HEIF — iOS default capture format. Without these
  // entries, an iPhone upload was getting saved as `<id>.bin` and
  // looked broken in the Files panel even though the bytes were
  // intact (#1222 PR-A follow-up). The EXIF reader treats both
  // MIMEs as supported, so the upload pipeline must too.
  "image/heic": ".heic",
  "image/heif": ".heif",
  // TIFF — exifr can read it, and the photo plugin enumerates it
  // as a supported source format. Same rationale as HEIC.
  "image/tiff": ".tif",
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
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
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

/** Post-save hook fired after every successful `saveAttachment`.
 *  Receives the absolute on-disk path, the workspace-relative path
 *  (the same one returned to the caller), and the MIME type the
 *  bytes were saved with. Hooks must NEVER throw — the upload is
 *  already on disk by the time the hook runs, so a failure should
 *  log and return, not propagate. Multiple hooks fan out via
 *  `Promise.allSettled` so one slow / failing hook can't block or
 *  break the others. (#1222 PR-A.) */
export type SaveAttachmentHook = (absPath: string, relativePath: string, mimeType: string) => Promise<void>;

const saveAttachmentHooks: SaveAttachmentHook[] = [];

/** Register a hook that runs after every saved attachment. Returns
 *  an unregister function so test setups can install + tear down a
 *  hook without leaking state into the next test. Production
 *  registrations live in `server/index.ts` boot. */
export function registerSaveAttachmentHook(hook: SaveAttachmentHook): () => void {
  saveAttachmentHooks.push(hook);
  return () => {
    const idx = saveAttachmentHooks.indexOf(hook);
    if (idx !== -1) saveAttachmentHooks.splice(idx, 1);
  };
}

async function runSaveAttachmentHooks(absPath: string, relativePath: string, mimeType: string): Promise<void> {
  if (saveAttachmentHooks.length === 0) return;
  // Snapshot the array so a hook that calls `registerSaveAttachmentHook`
  // (or its unregister fn) during this loop doesn't mutate the
  // iteration order. `allSettled` so one failing hook doesn't stop
  // the others — failures are the hook's responsibility to log.
  const snapshot = [...saveAttachmentHooks];
  await Promise.allSettled(snapshot.map((hook) => hook(absPath, relativePath, mimeType)));
}

/** Save a single attachment under data/attachments/YYYY/MM/. The
 *  caller picks the ID; companions (e.g. PPTX → PDF) reuse it via
 *  `saveCompanion()` so they share the same numeric prefix. */
export async function saveAttachment(base64Data: string, mimeType: string): Promise<SavedAttachment> {
  await ensureAttachmentsDir();
  const partition = yearMonthUtc();
  const ext = extensionForMime(mimeType);
  const filename = `${shortId()}${ext}`;
  const absPath = path.join(WORKSPACE_PATHS.attachments, partition, filename);
  await writeFileAtomic(absPath, Buffer.from(base64Data, "base64"));
  const relativePath = path.posix.join(WORKSPACE_DIRS.attachments, partition, filename);
  // Hooks (e.g. photo-EXIF capture) are awaited so callers can rely
  // on the sidecar existing by the time `saveAttachment` resolves —
  // simplifies test assertions and removes a class of race conditions
  // for downstream tools that read sidecars right after upload.
  await runSaveAttachmentHooks(absPath, relativePath, mimeType);
  return { relativePath, mimeType };
}

/** Save a companion file (e.g. PPTX → PDF) alongside an existing
 *  attachment, reusing its `<id>` so both filenames share a prefix
 *  and the same partition directory. Used by the upload route to
 *  store conversion artefacts next to their originals. Accepts a
 *  raw Buffer — the converter already has bytes in hand and base64
 *  re-encoding would be wasted work. */
export async function saveCompanion(originalRelativePath: string, buf: Buffer, ext: string): Promise<string> {
  const root = await ensureAttachmentsDir();
  // Validate the SOURCE path up front, string-only — BEFORE any fs op.
  // The companion doesn't exist yet so it can't go through the
  // realpath-based `safeResolve` (that ENOENTs on the missing leaf and
  // masquerades as a traversal rejection — the bug that broke every
  // PPTX upload). `isAttachmentPath` rejects a bad prefix or any `..`
  // segment, so the `mkdir` below can't escape the root.
  if (!isAttachmentPath(originalRelativePath)) {
    throw new Error(`path traversal rejected: ${originalRelativePath}`);
  }
  const dir = path.posix.dirname(originalRelativePath);
  const base = path.posix.basename(originalRelativePath, path.posix.extname(originalRelativePath));
  const filename = `${base}${ext}`;
  const relativePath = path.posix.join(dir, filename);
  const dirName = dir.replace(new RegExp(`^${WORKSPACE_DIRS.attachments}/`), "");
  await mkdir(path.join(root, dirName), { recursive: true });
  // Defense-in-depth: realpath the now-existing dir to catch symlink
  // escapes, and keep the leaf separator-free.
  const dirReal = resolveWithinRoot(root, dirName);
  if (!dirReal || hasTraversalSegment(filename) || /[/\\]/.test(filename)) {
    throw new Error(`path traversal rejected: ${relativePath}`);
  }
  const absPath = path.join(dirReal, filename);
  await writeFileAtomic(absPath, buf);
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
