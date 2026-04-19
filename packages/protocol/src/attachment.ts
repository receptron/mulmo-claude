// File attachment schema for chat messages (images, documents, etc.).

export interface Attachment {
  /** IANA media type, e.g. "image/png". */
  mimeType: string;
  /** Raw base64-encoded payload (no `data:` prefix, no whitespace). */
  data: string;
  /** Optional original filename. Untrusted — sanitise before use on disk. */
  filename?: string;
}
