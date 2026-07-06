// Preview conversions for Office Open XML formats. Read the file from
// disk, convert with the same libraries the attachment converter uses
// (mammoth / xlsx / libreoffice), and return a shape that the client
// can render inline (#1985).
//
// Deliberately separated from `server/agent/attachmentConverter.ts`
// because attachment conversion is turn-scoped (feed data into Claude's
// context) whereas preview is UI-scoped and needs to hit an on-disk
// path — the two call signatures don't overlap cleanly enough to share
// a common function.

import { readFile, mkdtemp, stat, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { SUBPROCESS_PROBE_TIMEOUT_MS, SUBPROCESS_WORK_TIMEOUT_MS } from "./time.js";
import { log } from "../system/logger/index.js";
import { errorMessage } from "./errors.js";

const execFileAsync = promisify(execFile);
const LOG_PREFIX = "office-preview";

export interface XlsxSheetPreview {
  name: string;
  /** CSV representation of the sheet (SheetJS `sheet_to_csv`). */
  csv: string;
}

export async function previewXlsx(absPath: string): Promise<XlsxSheetPreview[] | null> {
  try {
    const buf = await readFile(absPath);
    const workbook = XLSX.read(buf, { type: "buffer" });
    return workbook.SheetNames.map((name) => ({
      name,
      csv: XLSX.utils.sheet_to_csv(workbook.Sheets[name]),
    }));
  } catch (err) {
    log.warn(LOG_PREFIX, "xlsx preview failed", { path: absPath, error: errorMessage(err) });
    return null;
  }
}

export async function previewDocx(absPath: string): Promise<string | null> {
  try {
    const buf = await readFile(absPath);
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value;
  } catch (err) {
    log.warn(LOG_PREFIX, "docx preview failed", { path: absPath, error: errorMessage(err) });
    return null;
  }
}

// ── PPTX → PDF via LibreOffice (cached) ─────────────────────────

async function hasNativeLibreOffice(): Promise<boolean> {
  try {
    await execFileAsync("libreoffice", ["--version"], { timeout: SUBPROCESS_PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

// Cache converted PDFs by (path + mtime + size). LibreOffice takes 2-5s
// per conversion; caching makes re-opening the same slide instant. The
// cache lives under the OS tmp dir so it clears between reboots.
const CACHE_DIR = path.join(tmpdir(), "mulmoclaude-office-preview");

async function ensureCacheDir(): Promise<void> {
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });
}

function cacheKey(absPath: string, mtimeMs: number, size: number): string {
  // SHA-256 rather than SHA-1: this is only a cache path, not a
  // security guarantee, but sonarjs/hashing bans SHA-1 project-wide.
  return createHash("sha256").update(`${absPath}|${mtimeMs}|${size}`).digest("hex");
}

/** Convert a `.pptx` to PDF via LibreOffice, cached on disk keyed by
 *  path+mtime+size. Returns the absolute PDF path on success, `null`
 *  when LibreOffice is unavailable or conversion fails — callers fall
 *  back to the "open in OS" UI. */
export async function previewPptxAsPdf(absPath: string): Promise<string | null> {
  if (!(await hasNativeLibreOffice())) return null;

  let fileStat;
  try {
    fileStat = await stat(absPath);
  } catch (err) {
    log.warn(LOG_PREFIX, "pptx stat failed", { path: absPath, error: errorMessage(err) });
    return null;
  }

  await ensureCacheDir();
  const key = cacheKey(absPath, fileStat.mtimeMs, fileStat.size);
  const cachedPdf = path.join(CACHE_DIR, `${key}.pdf`);
  if (existsSync(cachedPdf)) return cachedPdf;

  // Convert into a per-conversion temp dir, then move to the cache.
  // Doing the conversion straight into the cache dir would let a
  // concurrent request see a half-written PDF.
  const tmp = await mkdtemp(path.join(tmpdir(), "mc-pptx-"));
  try {
    // LibreOffice reads the file in place; write nothing extra.
    await execFileAsync("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", tmp, absPath], { timeout: SUBPROCESS_WORK_TIMEOUT_MS });
    const baseName = path.basename(absPath, path.extname(absPath));
    const convertedPdf = path.join(tmp, `${baseName}.pdf`);
    if (!existsSync(convertedPdf)) {
      log.warn(LOG_PREFIX, "pptx conversion produced no output", { path: absPath, expected: convertedPdf });
      return null;
    }
    await copyFile(convertedPdf, cachedPdf);
    return cachedPdf;
  } catch (err) {
    log.warn(LOG_PREFIX, "pptx conversion failed", { path: absPath, error: errorMessage(err) });
    return null;
  }
}

/** Classify an office file by its extension. `null` for non-office. */
export function officeKind(filename: string): "office-xlsx" | "office-docx" | "office-pptx" | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".xlsx") return "office-xlsx";
  if (ext === ".docx") return "office-docx";
  if (ext === ".pptx") return "office-pptx";
  return null;
}
