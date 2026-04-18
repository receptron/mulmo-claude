// Shared MIME type helpers used by both bridges and the server.
// Pure functions — no I/O, no deps.

const EXT_TO_MIME: Record<string, string> = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  avif: "image/avif",
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Video / audio
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
};

/** Infer MIME type from a file extension (case-insensitive).
 *  Returns the fallback if the extension is not recognised. */
export function mimeFromExtension(
  ext: string,
  fallback = "application/octet-stream",
): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? fallback;
}

/** True when the MIME type is an image Claude can see via vision. */
export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/** True when the MIME type is a PDF document Claude can read natively
 *  via `type: "document"` content blocks. */
export function isPdfMime(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

/** True when the attachment can be sent to Claude as a content block
 *  (image vision or PDF document). */
export function isSupportedAttachmentMime(mimeType: string): boolean {
  return isImageMime(mimeType) || isPdfMime(mimeType);
}

export interface ParsedDataUrl {
  mimeType: string;
  data: string; // base64
}

/** Parse a `data:<mime>;base64,<data>` string. Returns null if the
 *  format doesn't match. Also handles parameterised data URLs like
 *  `data:image/png;charset=binary;base64,…`. */
export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/** Build a `data:<mime>;base64,<data>` string from components. */
export function buildDataUrl(mimeType: string, base64Data: string): string {
  return `data:${mimeType};base64,${base64Data}`;
}
