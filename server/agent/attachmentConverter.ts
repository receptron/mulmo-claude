// Converts non-native attachment types into content blocks that
// Claude can consume. Called by `buildUserMessageLine` before
// assembling the JSON message line.
//
// Supported conversions:
//   text/*           → decode UTF-8 → text block
//   application/json, .xml, .yaml, .toml, .csv → same (text)
//   application/vnd...wordprocessingml (docx) → mammoth → text block
//   application/vnd...spreadsheetml (xlsx) → xlsx → CSV text block
//   application/vnd...presentationml (pptx) → libreoffice → PDF doc block (Docker only)
//
// Each converter returns an array of content blocks (usually one).
// Returns null when the type is not convertible — the caller skips it.

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { execFile } from "child_process";
import { mkdtemp, readFile, writeFile, rm } from "fs/promises";
import path from "path";
import os from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import type { Attachment } from "@mulmobridge/protocol";
import { SUBPROCESS_PROBE_TIMEOUT_MS, SUBPROCESS_WORK_TIMEOUT_MS } from "../utils/time.js";
import { errorMessage } from "../utils/errors.js";

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

// ── Plain text ────────────────────────────────────────────────

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/html",
  "text/xml",
  "text/markdown",
  "text/yaml",
  "text/x-yaml",
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/toml",
]);

function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || TEXT_MIME_TYPES.has(mime);
}

function decodeBase64Text(data: string): string {
  return Buffer.from(data, "base64").toString("utf-8");
}

// ── DOCX ──────────────────────────────────────────────────────

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function convertDocx(data: string): Promise<string> {
  const buf = Buffer.from(data, "base64");
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value;
}

// ── XLSX ──────────────────────────────────────────────────────

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function convertXlsx(data: string): string {
  const buf = Buffer.from(data, "base64");
  const workbook = XLSX.read(buf, { type: "buffer" });
  const parts: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (workbook.SheetNames.length > 1) {
      parts.push(`## Sheet: ${name}\n\n${csv}`);
    } else {
      parts.push(csv);
    }
  }
  return parts.join("\n\n");
}

// ── PPTX (Docker/libreoffice only) ───────────────────────────

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// LibreOffice runs inside the Docker sandbox image, not on the host.
// We spin up a temporary container to do the conversion, mounting a
// temp directory for input/output. On non-Docker hosts where
// libreoffice is installed natively, the direct path also works.

async function tryNativeLibreOffice(): Promise<boolean> {
  try {
    await execFileAsync("libreoffice", ["--version"], {
      timeout: SUBPROCESS_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

async function tryDockerLibreOffice(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["image", "inspect", "mulmoclaude-sandbox"], {
      timeout: SUBPROCESS_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

async function convertPptxToPdf(data: string): Promise<Buffer | null> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "pptx-"));
  const inputPath = path.join(tmpDir, "input.pptx");
  const outputPath = path.join(tmpDir, "input.pdf");

  try {
    await writeFile(inputPath, Buffer.from(data, "base64"));

    if (await tryNativeLibreOffice()) {
      // Host has libreoffice installed natively
      await execFileAsync("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", tmpDir, inputPath], { timeout: SUBPROCESS_WORK_TIMEOUT_MS });
    } else if (await tryDockerLibreOffice()) {
      // Use the sandbox Docker image for conversion
      await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${tmpDir}:/data`,
          "mulmoclaude-sandbox",
          "libreoffice",
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          "/data",
          "/data/input.pptx",
        ],
        { timeout: SUBPROCESS_WORK_TIMEOUT_MS },
      );
    } else {
      return null;
    }

    return await readFile(outputPath);
  } catch {
    return null;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ── Public API ────────────────────────────────────────────────

export type ConversionResult = { kind: "converted"; blocks: ContentBlock[] } | { kind: "skipped"; reason: string };

function textBlocks(att: Attachment, content: string): ContentBlock[] {
  const label = att.filename ? `[File: ${att.filename}]\n\n` : "";
  return [{ type: "text", text: `${label}${content}` }];
}

async function tryConvertDocx(att: Attachment): Promise<ConversionResult> {
  try {
    return {
      kind: "converted",
      blocks: textBlocks(att, await convertDocx(att.data)),
    };
  } catch (err) {
    return {
      kind: "skipped",
      reason: `DOCX conversion failed: ${errorMessage(err)}`,
    };
  }
}

function tryConvertXlsx(att: Attachment): ConversionResult {
  try {
    return {
      kind: "converted",
      blocks: textBlocks(att, convertXlsx(att.data)),
    };
  } catch (err) {
    return {
      kind: "skipped",
      reason: `XLSX conversion failed: ${errorMessage(err)}`,
    };
  }
}

async function tryConvertPptx(att: Attachment): Promise<ConversionResult> {
  const pdfBuf = await convertPptxToPdf(att.data);
  if (!pdfBuf) {
    const name = att.filename ?? "presentation.pptx";
    return {
      kind: "converted",
      blocks: [
        {
          type: "text",
          text: `[PPTX file "${name}" attached but cannot be converted — LibreOffice is not available. Run in Docker sandbox mode for PPTX support.]`,
        },
      ],
    };
  }
  return {
    kind: "converted",
    blocks: [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: pdfBuf.toString("base64"),
        },
      },
    ],
  };
}

/**
 * Convert an attachment into content blocks Claude can consume.
 * Returns `{ kind: "converted", blocks }` on success, or
 * `{ kind: "skipped", reason }` when conversion fails or the
 * MIME type is not convertible — so the caller can distinguish
 * "unsupported type" from "conversion error" in logs.
 */
export async function convertAttachment(att: Attachment): Promise<ConversionResult> {
  if (isTextMime(att.mimeType)) {
    return {
      kind: "converted",
      blocks: textBlocks(att, decodeBase64Text(att.data)),
    };
  }
  if (att.mimeType === DOCX_MIME) return tryConvertDocx(att);
  if (att.mimeType === XLSX_MIME) return tryConvertXlsx(att);
  if (att.mimeType === PPTX_MIME) return tryConvertPptx(att);
  return { kind: "skipped", reason: `unsupported MIME type: ${att.mimeType}` };
}

/** MIME types that can be converted (for UI accept list).
 *  Must stay aligned with isTextMime() + the office constants. */
export const CONVERTIBLE_MIME_TYPES = [
  // Text
  "text/plain",
  "text/csv",
  "text/html",
  "text/xml",
  "text/markdown",
  "text/yaml",
  "text/x-yaml",
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/toml",
  // Office
  DOCX_MIME,
  XLSX_MIME,
  PPTX_MIME,
] as const;

export function isConvertibleMime(mime: string): boolean {
  return isTextMime(mime) || mime === DOCX_MIME || mime === XLSX_MIME || mime === PPTX_MIME;
}
