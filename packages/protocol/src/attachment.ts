// File attachment schema for chat messages (images, documents, etc.).
//
// One of `data` (inline base64 bytes) or `path` (workspace-relative
// path) MUST be set. The two carriers exist because:
//
//   - Bridge clients (Telegram, LINE, Mastodon, ...) ship raw bytes
//     over the wire, so they populate `data`.
//   - The Vue UI uploads paste/drop and sidebar-pick images to disk
//     before send (so the data layer is path-first), so it populates
//     `path`. The server reads bytes from disk on receipt.
//
// Server-internal normalisation (e.g. `prepareRequestExtras` in the
// agent route) loads bytes for path-only entries before downstream
// consumers see the array, so anything reading `data` after that
// boundary can rely on it being present. Outside that boundary
// (i.e. when first received), readers MUST runtime-check which
// carrier is set and handle the path case explicitly.

export interface Attachment {
  /** IANA media type, e.g. "image/png". Optional when only `path` is
   *  set — the server infers the type from the path extension. */
  mimeType?: string;
  /** Raw base64-encoded payload (no `data:` prefix, no whitespace).
   *  Required when `path` is not set. */
  data?: string;
  /** Workspace-relative path to a file the server can read. Required
   *  when `data` is not set. Must live under one of the allowed roots
   *  (e.g. `artifacts/images/...`, `data/attachments/...`); the
   *  server enforces this with `safeResolve`. */
  path?: string;
  /** Optional original filename. Untrusted — sanitise before use on disk. */
  filename?: string;
}
